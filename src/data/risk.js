// 리스크 관리: position sizing + circuit breaker + portfolio gate
// — Kelly fraction (half-Kelly, 25% max)
// — vol targeting (inverse-vol, 10% max, 2% min)
// — circuit breaker (MDD -25%, 일일 -8%)
// — "신호는 시스템이, 매매는 사람이" 원칙
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Position sizing
  maxPositionPct: 0.10,        // 단일 종목 최대 비중 10%
  minPositionPct: 0.02,        // 단일 종목 최소 비중 2%
  maxTotalPositions: 10,        // 최대 동시 보유 종목 수

  // Kelly
  kellyFraction: 0.5,           // half-Kelly
  maxKellyFraction: 0.25,       // 25% cap
  kellyMinSharpe: 0.3,          // Sharpe >= 0.3 일 때만 Kelly 활성

  // Vol targeting
  targetVol: 0.15,              // 목표 변동성 15% (연환산)
  lookbackVol: 20,              // 20일 변동성

  // Circuit breaker (공격적)
  mddLimit: -0.25,              // MDD -25% 시 자동 정지
  dailyLimit: -0.08,            // 일일 -8% 시 자동 정지
  consecutiveLossLimit: 5,      // 연속 5일 손실 시 경고
  weeklyLimit: -0.15,           // 주간 -15% 시 경고

  // 데이터 신선도
  maxDataAgeDays: 5,            // 5일 이상 (주말/연휴 고려)
  minUniverseSize: 1000,         // 유니버스 최소 종목 수
};

/**
 * 단일 종목 포지션 사이징
 * @param {Object} stock - {code, name, score, vol20}
 * @param {Object} ctx - {totalEquity, totalPositions, recentSharpe, recentVol}
 * @returns {Object} {shares, weight, cost, kellyPct, volPct, reason}
 */
function positionSize(stock, ctx = {}) {
  const { totalEquity, totalPositions = 1, recentSharpe = 0, recentVol = 0.15 } = ctx;
  if (!totalEquity || totalEquity <= 0) {
    return { shares: 0, weight: 0, reason: 'no_equity' };
  }
  // 1) Kelly fraction
  let kellyPct = 0;
  if (recentSharpe >= DEFAULTS.kellyMinSharpe) {
    kellyPct = recentSharpe * 0.1 * DEFAULTS.kellyFraction;
    kellyPct = Math.min(kellyPct, DEFAULTS.maxKellyFraction);
  }
  // 2) Vol targeting (inverse-vol)
  let volPct = 0;
  if (stock.vol20 && stock.vol20 > 0) {
    volPct = DEFAULTS.targetVol / stock.vol20;
    volPct = Math.max(DEFAULTS.minPositionPct, Math.min(volPct, DEFAULTS.maxPositionPct));
  } else {
    volPct = DEFAULTS.minPositionPct;
  }
  // 3) min(켈리, vol, max) + max(0)
  let weight = Math.min(kellyPct || volPct, volPct, DEFAULTS.maxPositionPct);
  weight = Math.max(weight, DEFAULTS.minPositionPct);

  // 4) 총 보유 종목 수로 분할 (10종목이면 각 10%)
  const perSlotCap = 1 / Math.max(totalPositions, 1);
  weight = Math.min(weight, perSlotCap * 1.2);  // 20% 여유

  const cost = totalEquity * weight;
  const shares = stock.price ? Math.floor(cost / stock.price) : 0;

  return {
    shares,
    weight,
    cost,
    kellyPct,
    volPct,
    reason: 'ok',
  };
}

/**
 * 포트폴리오 전체 포지션 사이징
 * @param {Array<{code, name, score, price, vol20}>} signals - 정렬된 신호 (high → low)
 * @param {Object} ctx - {totalEquity, recentSharpe, recentVol}
 * @returns {Array<{code, name, shares, weight, cost, ...}>}
 */
function sizePortfolio(signals, ctx = {}) {
  const { totalEquity = 0, recentSharpe = 0, recentVol = 0.15, maxPositions = DEFAULTS.maxTotalPositions } = ctx;
  const top = signals.slice(0, maxPositions);
  const out = [];
  for (const s of top) {
    const sized = positionSize(s, {
      totalEquity,
      totalPositions: top.length,
      recentSharpe,
      recentVol,
    });
    out.push({
      code: s.code,
      name: s.name,
      score: s.score,
      price: s.price,
      ...sized,
    });
  }
  return out;
}

/**
 * Circuit breaker 평가
 * @param {Object} portfolio - {totalEquity, peakEquity, dailyReturn, weeklyReturn, mdd, consecutiveLosses}
 * @returns {Object} {halt, warnings, status, reason}
 */
function circuitBreaker(portfolio = {}) {
  const { totalEquity = 0, peakEquity = 0, dailyReturn = 0, weeklyReturn = 0, mdd = 0, consecutiveLosses = 0 } = portfolio;
  const warnings = [];
  let halt = false;
  let reason = null;

  // 1) MDD 한도 (-25%)
  if (mdd <= DEFAULTS.mddLimit) {
    halt = true;
    reason = `MDD ${(mdd * 100).toFixed(1)}% <= ${(DEFAULTS.mddLimit * 100).toFixed(0)}% 한도`;
  }
  // 2) 일일 한도 (-8%)
  if (dailyReturn <= DEFAULTS.dailyLimit) {
    halt = true;
    reason = `일일 ${(dailyReturn * 100).toFixed(1)}% <= ${(DEFAULTS.dailyLimit * 100).toFixed(0)}% 한도`;
  }
  // 3) 주간 한도 (-15%) - 경고만
  if (weeklyReturn <= DEFAULTS.weeklyLimit) {
    warnings.push(`주간 ${(weeklyReturn * 100).toFixed(1)}% <= ${(DEFAULTS.weeklyLimit * 100).toFixed(0)}% 경고`);
  }
  // 4) 연속 손실 (5일) - 경고
  if (consecutiveLosses >= DEFAULTS.consecutiveLossLimit) {
    warnings.push(`연속 ${consecutiveLosses}일 손실`);
  }

  let status;
  if (halt) status = 'HALT';
  else if (warnings.length > 0) status = 'WARNING';
  else status = 'NORMAL';

  return { halt, warnings, status, reason, thresholds: DEFAULTS };
}

/**
 * Pre-flight 검증: 데이터 신선도, 유니버스 크기
 * @param {Object} db - DuckDB
 * @returns {Promise<Object>} {ok, errors, warnings, stats}
 */
async function preFlight(db) {
  const errors = [];
  const warnings = [];
  const stats = {};
  // 1) 일별 데이터 신선도
  try {
    const r = await db.all(`SELECT MAX(date) as max_d, COUNT(DISTINCT code) as n_code, COUNT(*) as n_row FROM daily_prices`);
    const row = r[0] || {};
    const maxDate = row.max_d ? String(row.max_d).slice(0, 10) : null;
    const nCode = Number(row.n_code) || 0;
    const nRow = Number(row.n_row) || 0;
    stats.lastDataDate = maxDate;
    stats.universeSize = nCode;
    stats.totalRows = nRow;
    const today = new Date().toISOString().slice(0, 10);
    const ageDays = maxDate ? Math.floor((Date.parse(today) - Date.parse(maxDate)) / 86400000) : 999;
    stats.dataAgeDays = ageDays;
    if (ageDays > DEFAULTS.maxDataAgeDays) {
      errors.push(`데이터 ${ageDays}일 오래됨 (한도: ${DEFAULTS.maxDataAgeDays}일)`);
    }
    if (nCode < DEFAULTS.minUniverseSize) {
      errors.push(`유니버스 ${nCode}개 < 최소 ${DEFAULTS.minUniverseSize}개`);
    }
  } catch (e) {
    errors.push(`DB 조회 실패: ${e.message}`);
  }
  // 2) 활성 종목 (KOSPI/KOSDAQ)
  try {
    const r = await db.all(`SELECT COUNT(*) as cnt FROM stocks WHERE market IN ('KOSPI', 'KOSDAQ')`);
    stats.activeStocks = Number(r[0]?.cnt) || 0;
  } catch (e) {
    warnings.push(`stocks 조회 실패: ${e.message}`);
  }
  // 3) 일일 신호 파일
  try {
    const sigPath = path.join(__dirname, '..', '..', 'public', 'data', 'signals.json');
    if (fs.existsSync(sigPath)) {
      const sig = JSON.parse(fs.readFileSync(sigPath, 'utf-8'));
      stats.lastSignalsDate = sig.date || sig.timestamp?.slice(0, 10);
      stats.lastSignalsCount = (sig.signals || []).length;
    } else {
      warnings.push('signals.json 없음');
    }
  } catch (e) {
    warnings.push(`signals 조회 실패: ${e.message}`);
  }
  // 4) ops-status.json (회로차단기 상태)
  try {
    const opsPath = path.join(__dirname, '..', '..', 'public', 'data', 'ops-status.json');
    if (fs.existsSync(opsPath)) {
      const ops = JSON.parse(fs.readFileSync(opsPath, 'utf-8'));
      stats.circuitBreaker = ops.circuitBreaker?.status || 'UNKNOWN';
      if (ops.circuitBreaker?.halt) {
        errors.push(`회로차단기 작동 중: ${ops.circuitBreaker.reason}`);
      }
    }
  } catch (e) {
    warnings.push(`ops-status 조회 실패: ${e.message}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats,
    timestamp: new Date().toISOString(),
    thresholds: { maxDataAgeDays: DEFAULTS.maxDataAgeDays, minUniverseSize: DEFAULTS.minUniverseSize },
  };
}

/**
 * 포트폴리오 일일 손익 추적
 * @param {string} filePath - public/data/portfolio-state.json
 * @param {Object} update - {date, totalEquity, dailyReturn, weeklyReturn, mdd, consecutiveLosses}
 */
function updatePortfolioState(filePath, update) {
  let state = {
    lastDate: null,
    totalEquity: 0,
    initialEquity: 0,
    peakEquity: 0,
    history: [],
  };
  if (fs.existsSync(filePath)) {
    try {
      state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      console.warn(`portfolio-state.json 파싱 실패: ${e.message}`);
    }
  }
  if (state.initialEquity === 0 && update.totalEquity > 0) {
    state.initialEquity = update.totalEquity;
  }
  state.peakEquity = Math.max(state.peakEquity, update.totalEquity);
  state.lastDate = update.date;
  state.totalEquity = update.totalEquity;
  state.dailyReturn = update.dailyReturn;
  state.weeklyReturn = update.weeklyReturn;
  state.mdd = update.mdd;
  state.consecutiveLosses = update.consecutiveLosses;
  state.history.push({
    date: update.date,
    equity: update.totalEquity,
    dailyReturn: update.dailyReturn,
    weeklyReturn: update.weeklyReturn,
    mdd: update.mdd,
  });
  // 90일 이력만 유지
  if (state.history.length > 90) {
    state.history = state.history.slice(-90);
  }
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  return state;
}

/**
 * ops-status.json 갱신 (회로차단기 + 일일 헬스체크)
 * @param {string} filePath
 * @param {Object} update
 */
function updateOpsStatus(filePath, update) {
  let status = {};
  if (fs.existsSync(filePath)) {
    try {
      status = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      console.warn(`ops-status.json 파싱 실패: ${e.message}`);
    }
  }
  Object.assign(status, update);
  status.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(status, null, 2));
  return status;
}

module.exports = {
  DEFAULTS,
  positionSize,
  sizePortfolio,
  circuitBreaker,
  preFlight,
  updatePortfolioState,
  updateOpsStatus,
};
