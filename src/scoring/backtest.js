'use strict';

// 백테스트: 4개 차트 + KOSPI 벤치마크
// - 누적 수익률 (전략 vs KOSPI)
// - 연도별 수익률 막대
// - 월별 히트맵 (year × month)
// - 드로우다운 차트
//
// 데이터가 충분치 않으면 친절한 에러 반환.

const { all, one } = require('../db/connection');
const { getIndexHistory } = require('../data/indices');
const strategies = require('../strategies');

const TOP_N = 20;
const DEFAULT_LOOKBACK_MONTHS = 24;

async function fetchKospiDaily() {
  try {
    const arr = await getIndexHistory('KOSPI', { days: 700 });
    return arr;
  } catch (e) {
    console.error('[backtest] KOSPI 히스토리 로드 실패:', e.message);
    return [];
  }
}

function getMonthKey(date) {
  // YYYY-MM
  if (!date) return null;
  const s = String(date);
  return s.length >= 7 ? s.slice(0, 7) : null;
}

function monthDiff(d1, d2) {
  const a = new Date(d1), b = new Date(d2);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function round4(v) { return Math.round(v * 10000) / 10000; }
function round2(v) { return Math.round(v * 100) / 100; }

async function backtest({ topN = TOP_N, lookbackMonths = DEFAULT_LOOKBACK_MONTHS, strategy = null } = {}) {
  // 1) KOSPI daily
  const kospiArr = await fetchKospiDaily();
  const kospiByDate = new Map();
  for (const k of kospiArr) kospiByDate.set(String(k.date), k.close);

  // 2) factor_scores 스냅샷 날짜 목록
  const snapshots = await all(`
    SELECT DISTINCT date FROM factor_scores
    WHERE date >= (SELECT MAX(date) FROM factor_scores) - INTERVAL '${Math.max(3, lookbackMonths)} months'
    ORDER BY date
  `);
  if (snapshots.length < 3) {
    return { ok: false, error: `데이터 부족 (${snapshots.length}일). 매일 갱신되면 자동으로 채워집니다.`, nDays: snapshots.length };
  }

  // 3) 매 스냅샷마다 TOP N → 다음 스냅샷까지 수익률
  const strat = strategy || strategies.get('balanced');
  const W = strat.weights;
  const wv = W.value || 0, wm = W.momentum || 0, wq = W.quality || 0, wlv = W.volatility || 0, wg = W.growth || 0;
  const wliq = W.liquidity || 0, wsup = W.supply || 0;
  const totalWeight = wv + wm + wq + wlv + wg + wliq + wsup || 100;
  const monthlyReturns = [];
  for (let i = 0; i < snapshots.length - 1; i++) {
    const d1 = String(snapshots[i].date);
    const d2 = String(snapshots[i + 1].date);

    const top = await all(`
      SELECT code, value_score, momentum_score, quality_score, volatility_score, growth_score,
             liquidity_score, supply_score
      FROM factor_scores WHERE date = ? ORDER BY rank ASC LIMIT ?
    `, [d1, topN]);
    if (top.length === 0) continue;
    const codes = top.map((r) => r.code);
    const placeholders = codes.map(() => '?').join(',');

    const safe = await all(
      `SELECT code,
              (SELECT close FROM daily_prices WHERE code = dp.code AND date >= ? ORDER BY date ASC LIMIT 1) AS p1,
              (SELECT close FROM daily_prices WHERE code = dp.code AND date <= ? ORDER BY date DESC LIMIT 1) AS p2
       FROM (SELECT DISTINCT code FROM daily_prices WHERE code IN (${placeholders}) AND date BETWEEN ? AND ?) dp`,
      [d1, d2, ...codes, d1, d2],
    );

    // 가중치 적용 재랭킹 (7팩터)
    const scored = top.map((t) => {
      const s = safe.find((r) => r.code === t.code);
      return {
        code: t.code,
        score: (Number(t.value_score) || 0) * wv + (Number(t.momentum_score) || 0) * wm +
               (Number(t.quality_score) || 0) * wq + (Number(t.volatility_score) || 0) * wlv +
               (Number(t.growth_score) || 0) * wg + (Number(t.liquidity_score) || 0) * wliq +
               (Number(t.supply_score) || 0) * wsup,
        ret: (s?.p1 && s?.p2) ? (s.p2 - s.p1) / s.p1 : null,
      };
    }).filter((r) => r.ret !== null);
    if (scored.length === 0) continue;
    scored.sort((a, b) => b.score - a.score);
    const topN2 = scored.slice(0, topN);
    const stratRet = topN2.reduce((a, b) => a + b.ret, 0) / topN2.length;

    // KOSPI 동일 기간 수익률
    const k1 = kospiByDate.get(d1);
    const k2 = kospiByDate.get(d2);
    const kospiRet = (k1 && k2) ? (k2 - k1) / k1 : null;

    monthlyReturns.push({
      from: d1, to: d2,
      strategy: stratRet,
      kospi: kospiRet,
      count: topN2.length,
    });
  }

  if (monthlyReturns.length === 0) {
    return { ok: false, error: '백테스트 가능한 구간 없음' };
  }

  // 4) NAV 계산
  const stratNav = [1], kospiNav = [1];
  for (const m of monthlyReturns) {
    stratNav.push(stratNav[stratNav.length - 1] * (1 + (m.strategy || 0)));
    if (m.kospi !== null) kospiNav.push(kospiNav[kospiNav.length - 1] * (1 + m.kospi));
    else kospiNav.push(kospiNav[kospiNav.length - 1]);
  }

  const totalReturn = stratNav[stratNav.length - 1] - 1;
  const kospiTotal = kospiNav[kospiNav.length - 1] - 1;
  const months = monthlyReturns.length;
  const cagr = months >= 1 ? Math.pow(1 + totalReturn, 12 / months) - 1 : 0;
  const meanR = monthlyReturns.reduce((a, b) => a + b.strategy, 0) / months;
  const stdR = Math.sqrt(monthlyReturns.reduce((a, b) => a + (b.strategy - meanR) ** 2, 0) / months);
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(12) : 0;

  // === 신규 통계: Win Rate, Profit Factor, Beta, Information Ratio ===
  const winMonths = monthlyReturns.filter((m) => m.strategy > 0).length;
  const winRate = months > 0 ? winMonths / months : 0;
  const grossProfit = monthlyReturns.filter((m) => m.strategy > 0).reduce((a, b) => a + b.strategy, 0);
  const grossLoss = Math.abs(monthlyReturns.filter((m) => m.strategy < 0).reduce((a, b) => a + b.strategy, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);
  // Beta: 공분산(strat, kospi) / 분산(kospi)
  const validRet = monthlyReturns.filter((m) => m.kospi !== null);
  let beta = 0;
  let informationRatio = 0;
  if (validRet.length >= 3) {
    const kMean = validRet.reduce((a, b) => a + b.kospi, 0) / validRet.length;
    const sMean = validRet.reduce((a, b) => a + b.strategy, 0) / validRet.length;
    let cov = 0, varK = 0;
    for (const m of validRet) {
      cov += (m.strategy - sMean) * (m.kospi - kMean);
      varK += (m.kospi - kMean) ** 2;
    }
    cov /= validRet.length;
    varK /= validRet.length;
    beta = varK > 0 ? cov / varK : 0;
    // IR: (전략 평균 - KOSPI 평균) / 추적오차
    const alpha = sMean - kMean;
    let trackingErr = 0;
    for (const m of validRet) trackingErr += (m.strategy - m.kospi - alpha) ** 2;
    trackingErr = Math.sqrt(trackingErr / validRet.length);
    informationRatio = trackingErr > 0 ? (alpha / trackingErr) * Math.sqrt(12) : 0;
  }

  // 5) MDD
  let peak = stratNav[0], mdd = 0, mddIdx = 0;
  let curPeak = stratNav[0], curPeakIdx = 0;
  const drawdown = [];
  for (let i = 0; i < stratNav.length; i++) {
    if (stratNav[i] > curPeak) { curPeak = stratNav[i]; curPeakIdx = i; }
    const dd = (stratNav[i] - curPeak) / curPeak;
    drawdown.push({ idx: i, value: dd });
    if (dd < mdd) { mdd = dd; mddIdx = i; peak = curPeak; }
  }
  const recoveryMonths = mddIdx < stratNav.length - 1 ? stratNav.length - 1 - mddIdx : -1;

  // 6) 연도별 수익률
  const yearlyMap = new Map();
  for (let i = 0; i < monthlyReturns.length; i++) {
    const y = String(monthlyReturns[i].from).slice(0, 4);
    if (!yearlyMap.has(y)) yearlyMap.set(y, { year: y, strategy: 0, kospi: 0, count: 0 });
    const yEntry = yearlyMap.get(y);
    yEntry.strategy = (1 + yEntry.strategy) * (1 + monthlyReturns[i].strategy) - 1;
    if (monthlyReturns[i].kospi !== null) {
      yEntry.kospi = (1 + yEntry.kospi) * (1 + monthlyReturns[i].kospi) - 1;
    }
    yEntry.count++;
  }
  const yearlyReturns = [...yearlyMap.values()].map((y) => ({
    year: y.year, strategy: round4(y.strategy), kospi: round4(y.kospi), months: y.count,
  }));

  // 7) 월별 히트맵 (year × month)
  const heatmapMap = new Map(); // key: "YYYY-MM" → return
  for (const m of monthlyReturns) {
    const key = getMonthKey(m.from);
    heatmapMap.set(key, {
      month: key,
      strategy: m.strategy,
      kospi: m.kospi,
    });
  }
  const allMonths = [...heatmapMap.keys()].sort();
  const monthGrid = {}; // year → [12 entries for Jan-Dec]
  for (const k of allMonths) {
    const year = k.slice(0, 4);
    const month = Number(k.slice(5, 7));
    if (!monthGrid[year]) monthGrid[year] = new Array(12).fill(null);
    monthGrid[year][month - 1] = heatmapMap.get(k).strategy;
  }

  return {
    ok: true,
    computedAt: new Date().toISOString(),
    topN, months, strategy: strategy?.name || '밸런스 (기본)',
    weights: W,
    nDays: snapshots.length,
    fromDate: String(snapshots[0].date),
    toDate: String(snapshots[snapshots.length - 1].date),
    totalReturn: round4(totalReturn),
    kospiTotal: round4(kospiTotal),
    cagr: round4(cagr),
    monthlyReturn: round4(meanR),
    monthlyStd: round4(stdR),
    sharpe: round4(sharpe),
    mdd: round4(mdd),
    mddRecoveryMonths: recoveryMonths,
    winRate: round4(winRate),
    winMonths,
    profitFactor: round4(Math.min(profitFactor, 99)),
    beta: round4(beta),
    informationRatio: round4(informationRatio),
    nav: stratNav.map((v, i) => ({ idx: i, value: round4(v) })),
    kospiNav: kospiNav.map((v, i) => ({ idx: i, value: round4(v) })),
    monthlyReturns,
    yearlyReturns,
    monthGrid, // { "2025": [null, 0.05, -0.02, ...], ... }
    drawdown,
  };
}

module.exports = { backtest };
