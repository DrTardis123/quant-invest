'use strict';

// 가중치 최적화기
// 1) Cross-sectional OLS 회귀분석 → ADSP 스타일 가중치 학습
// 2) Random grid search → 다양한 가중치 시도 후 최고 수익률 탐색
// 3) 사전정의 5개 전략 모두 평가
//
// GitHub Actions 6시간 제한 고려:
// - grid search: 80개로 제한
// - OLS: 가우시안 소거법 직접 구현 (의존성 없음)
// - 데이터 < 30일이면 친절한 에러 반환

const { all, one } = require('../db/connection');
const strategies = require('../strategies');

const MIN_DAYS = 30;        // 최소 필요 일수
const N_COMBINATIONS = 80;  // grid search 상한
const TOP_N = 20;           // 백테스트 시 매월 매수 종목 수

// ============= OLS Solver (Gaussian elimination) =============
function solveOLS(X, y) {
  // X: N×p matrix (with intercept column 0), y: N×1 vector
  // Returns: coefficients p×1
  const n = X.length;
  if (n < 2) return null;
  const p = X[0].length;

  // X'X, X'y
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }

  // Gaussian elimination with partial pivoting
  const M = XtX.map((row, i) => [...row, Xty[i]]);
  for (let i = 0; i < p; i++) {
    // pivot
    let maxRow = i;
    for (let k = i + 1; k < p; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    if (Math.abs(M[i][i]) < 1e-10) continue; // skip singular
    for (let k = i + 1; k < p; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= p; j++) M[k][j] -= f * M[i][j];
    }
  }
  // Back substitution
  const w = new Array(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-10) { w[i] = 0; continue; }
    let sum = M[i][p];
    for (let j = i + 1; j < p; j++) sum -= M[i][j] * w[j];
    w[i] = sum / M[i][i];
  }
  return w;
}

function pearsonCorr(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i];
    sxx += xs[i] * xs[i]; syy += ys[i] * ys[i];
    sxy += xs[i] * ys[i];
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den === 0 ? 0 : num / den;
}

// ============= Data fetch =============
async function getOptimizationData() {
  // factor_scores 의 각 (date, code) 에 대해 21 거래일 후 수익률 매칭
  // DuckDB LATERAL JOIN 으로 처리 (각 row 마다 다음 close 찾기)
  const rows = await all(`
    WITH score_dates AS (
      SELECT DISTINCT date FROM factor_scores
      WHERE date >= (SELECT MAX(date) FROM factor_scores) - INTERVAL '24 months'
      ORDER BY date
    ),
    stock_universe AS (
      SELECT code FROM stocks WHERE market IN ('KOSPI','KOSDAQ')
    )
    SELECT
      fs.date AS date,
      fs.code AS code,
      fs.value_score, fs.momentum_score, fs.quality_score,
      fs.volatility_score, fs.growth_score,
      dp_now.close AS price_now,
      (
        SELECT close FROM daily_prices
        WHERE code = fs.code AND date > fs.date
        ORDER BY date ASC LIMIT 1
      ) AS price_next
    FROM factor_scores fs
    JOIN stock_universe su ON su.code = fs.code
    JOIN daily_prices dp_now ON dp_now.code = fs.code AND dp_now.date = fs.date
    WHERE fs.date IN (SELECT date FROM score_dates)
  `);

  const data = [];
  for (const r of rows) {
    if (r.price_now && r.price_next && r.price_now > 0) {
      data.push({
        date: String(r.date),
        code: r.code,
        value: Number(r.value_score) || 0,
        momentum: Number(r.momentum_score) || 0,
        quality: Number(r.quality_score) || 0,
        volatility: Number(r.volatility_score) || 0,
        growth: Number(r.growth_score) || 0,
        fwdReturn: (r.price_next - r.price_now) / r.price_now,
      });
    }
  }
  return data;
}

// ============= Regression =============
function regressionWeights(data) {
  // 날짜별 그룹 → OLS → 가중치 평균
  const byDate = new Map();
  for (const r of data) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }

  const W = { value: 0, momentum: 0, quality: 0, volatility: 0, growth: 0 };
  const r2List = [];
  const icList = [];
  let nDates = 0;

  for (const [, rows] of byDate) {
    if (rows.length < 30) continue; // 충분한 데이터 없으면 스킵
    nDates++;
    // Build X (with intercept), y
    const X = rows.map((r) => [1, r.value, r.momentum, r.quality, r.volatility, r.growth]);
    const y = rows.map((r) => r.fwdReturn);
    const coef = solveOLS(X, y);
    if (!coef) continue;

    // R²
    const yMean = y.reduce((a, b) => a + b, 0) / y.length;
    let ssRes = 0, ssTot = 0;
    const preds = [];
    for (let i = 0; i < y.length; i++) {
      const pred = coef[0] + coef[1] * rows[i].value + coef[2] * rows[i].momentum +
                    coef[3] * rows[i].quality + coef[4] * rows[i].volatility + coef[5] * rows[i].growth;
      preds.push(pred);
      ssRes += (y[i] - pred) ** 2;
      ssTot += (y[i] - yMean) ** 2;
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    r2List.push(r2);
    icList.push(pearsonCorr(preds, y));

    // 가중치 누적 (절대값으로)
    W.value += Math.max(0, coef[1]);
    W.momentum += Math.max(0, coef[2]);
    W.quality += Math.max(0, coef[3]);
    W.volatility += Math.max(0, coef[4]);
    W.growth += Math.max(0, coef[5]);
  }

  if (nDates === 0) return { weights: null, r2: 0, ic: 0, nDates: 0 };

  // 정규화: 합 = 100
  const total = W.value + W.momentum + W.quality + W.volatility + W.growth;
  if (total === 0) return { weights: null, r2: 0, ic: 0, nDates };
  const norm = {
    value: Math.round((W.value / total) * 100),
    momentum: Math.round((W.momentum / total) * 100),
    quality: Math.round((W.quality / total) * 100),
    volatility: Math.round((W.volatility / total) * 100),
    growth: Math.round((W.growth / total) * 100),
  };
  return {
    weights: norm,
    r2: round4(avg(r2List)),
    ic: round4(avg(icList)),
    nDates,
  };
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function round4(v) { return Math.round(v * 10000) / 10000; }
function round2(v) { return Math.round(v * 100) / 100; }

// ============= Backtest single strategy =============
function backtestStrategy(data, weights) {
  // 각 월: 가중치로 점수 계산 → 상위 20 매수 → 다음달 평균 수익률
  const byDate = new Map();
  for (const r of data) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return null;

  let nav = 1;
  const monthlyReturns = [];
  for (let i = 0; i < dates.length - 1; i++) {
    const rows = byDate.get(dates[i]);
    const scored = rows.map((r) => ({
      code: r.code,
      score: r.value * weights.value + r.momentum * weights.momentum +
             r.quality * weights.quality + r.volatility * weights.volatility +
             r.growth * weights.growth,
      fwdReturn: r.fwdReturn,
    })).filter((r) => Number.isFinite(r.score));
    scored.sort((a, b) => b.score - a.score);
    const topN = scored.slice(0, TOP_N);
    if (topN.length === 0) continue;
    const ret = topN.reduce((a, b) => a + b.fwdReturn, 0) / topN.length;
    nav *= (1 + ret);
    monthlyReturns.push(ret);
  }

  if (monthlyReturns.length === 0) return null;

  const totalReturn = nav - 1;
  const meanR = avg(monthlyReturns);
  const stdR = Math.sqrt(monthlyReturns.reduce((a, b) => a + (b - meanR) ** 2, 0) / monthlyReturns.length);
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(12) : 0;
  let peak = 1, mdd = 0;
  let running = 1;
  for (const r of monthlyReturns) {
    running *= (1 + r);
    if (running > peak) peak = running;
    const dd = (running - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  const cagr = monthsCAGR(monthlyReturns.length, totalReturn);
  return { totalReturn, sharpe: round4(sharpe), mdd: round4(mdd), cagr: round4(cagr), months: monthlyReturns.length };
}

function monthsCAGR(months, total) {
  if (months < 1) return 0;
  return Math.pow(1 + total, 12 / months) - 1;
}

// ============= Main export =============
async function exportOptimizer() {
  const data = await getOptimizationData();
  const dates = [...new Set(data.map((d) => d.date))].sort();
  const stocks = [...new Set(data.map((d) => d.code))].length;

  if (data.length < 100 || dates.length < MIN_DAYS) {
    return {
      ok: false,
      error: `데이터 부족 (현재 ${dates.length}일치). 최소 ${MIN_DAYS}일 필요. 매일 갱신되면 자동으로 채워집니다.`,
      nDays: dates.length,
      nStocks: stocks,
      computedAt: new Date().toISOString(),
    };
  }

  // 1) 회귀분석
  const regression = regressionWeights(data);

  // 2) 5개 사전정의 전략
  const predefined = strategies.list().map((s) => ({
    name: s.name,
    source: 'predefined',
    weights: s.weights,
    description: s.description,
    ...backtestStrategy(data, s.weights) || { totalReturn: 0, sharpe: 0, mdd: 0, cagr: 0, months: 0 },
  }));

  // 3) 회귀 가중치
  let all = [...predefined];
  if (regression.weights) {
    all.push({
      name: '📊 회귀분석 추천',
      source: 'regression',
      weights: regression.weights,
      description: `OLS 기반. R²=${(regression.r2 * 100).toFixed(2)}%, IC=${(regression.ic * 100).toFixed(2)}%`,
      ...backtestStrategy(data, regression.weights) || { totalReturn: 0, sharpe: 0, mdd: 0, cagr: 0, months: 0 },
    });
  }

  // 4) Grid search
  const grid = [];
  // seed (재현성)
  let seed = 42;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < N_COMBINATIONS; i++) {
    const w = {
      value: rand() * 100, momentum: rand() * 100, quality: rand() * 100,
      volatility: rand() * 100, growth: rand() * 100,
    };
    const total = w.value + w.momentum + w.quality + w.volatility + w.growth;
    if (total === 0) continue;
    Object.keys(w).forEach((k) => (w[k] = (w[k] / total) * 100));
    const bt = backtestStrategy(data, w);
    if (bt) {
      grid.push({
        name: `Grid #${i + 1}`,
        source: 'grid',
        weights: roundWeights(w),
        description: '',
        ...bt,
      });
    }
  }

  // 전체 합치고 정렬
  all = [...all, ...grid].filter((x) => x.totalReturn !== undefined);
  all.sort((a, b) => b.totalReturn - a.totalReturn);

  return {
    ok: true,
    computedAt: new Date().toISOString(),
    nDays: dates.length,
    nStocks: stocks,
    fromDate: dates[0],
    toDate: dates[dates.length - 1],
    best: all[0] || null,
    top10: all.slice(0, 10),
    regression: regression.weights ? {
      weights: regression.weights,
      r2: regression.r2,
      ic: regression.ic,
      nDates: regression.nDates,
    } : null,
    predefined,
  };
}

function roundWeights(w) {
  const out = {};
  for (const k of Object.keys(w)) out[k] = Math.round(w[k]);
  return out;
}

module.exports = { exportOptimizer, regressionWeights, backtestStrategy, solveOLS, pearsonCorr };
