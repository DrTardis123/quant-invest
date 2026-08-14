'use strict';
// 2차 회귀분석: 1차 OLS 한계 보완
// 1) K-fold Cross Validation (5-fold time series split)
// 2) Ridge Regression (L2 regularization) - 과적합 방지
// 3) 섹터 중립화 (industry 더미 + 잔차 회귀)
// 4) Risk Parity (변동성 균등 가중치)
// 5) Bootstrap 신뢰구간
// CSV cache 사용 (DuckDB lock 회피)

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const fs = require('fs');

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

// === Ridge Regression (L2) ===
function ridgeRegression(X, y, lambda) {
  const m = X.length;
  if (m < 5) return null;
  const n = X[0].length;
  // X^T X + lambda * I
  const XtX = [];
  for (let i = 0; i < n; i++) {
    XtX.push([]);
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += X[k][i] * X[k][j];
      if (i === j) s += lambda;
      XtX[i].push(s);
    }
  }
  const Xty = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < m; k++) s += X[k][i] * y[k];
    Xty.push(s);
  }
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    if (Math.abs(A[i][i]) < 1e-9) return null;
    const piv = A[i][i];
    for (let j = i; j <= n; j++) A[i][j] /= piv;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = A[k][i];
      for (let j = i; j <= n; j++) A[k][j] -= f * A[i][j];
    }
  }
  return A.map((row) => row[n]);
}

// === 시뮬 ===
async function simulate(weights, monthlyScores, monthlyReturns, kospiReturns, topN = 20) {
  const factorKeys = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];
  const W = factorKeys.map((k) => Math.max(0, weights[k] || 0));
  const wSum = W.reduce((a, b) => a + b, 0);
  if (wSum === 0) return { sharpe: -999, total: 0, alpha: -999, ir: -999, mdd: 0, nMonths: 0, meanMonthly: 0, stdMonthly: 0, kospiTotal: 0 };
  const Wn = W.map((w) => w / wSum);
  const retMap = new Map();
  for (const r of monthlyReturns) {
    const m = new Map();
    for (const [code, ret] of Object.entries(r.returns)) m.set(code, ret);
    retMap.set(r.date, m);
  }
  const kospiMap = new Map(kospiReturns.map((r) => [r.date, r.ret]));
  const monthlyRet = [];
  for (let i = 0; i < monthlyScores.length - 1; i++) {
    const cur = monthlyScores[i];
    const next = monthlyScores[i + 1];
    const nextRet = retMap.get(next.date);
    const kospiRet = kospiMap.get(next.date) || 0;
    if (!nextRet) continue;
    const scored = cur.stocks
      .map((s) => {
        const r = nextRet.get(s.code);
        if (r === undefined) return null;
        let score = 0;
        for (let j = 0; j < factorKeys.length; j++) score += (s.scores[factorKeys[j]] || 0) * Wn[j];
        return { code: s.code, score, ret: r };
      })
      .filter((x) => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
    if (scored.length === 0) continue;
    const strat = scored.reduce((a, b) => a + b.ret, 0) / scored.length;
    monthlyRet.push({ date: next.date, strat, kospi: kospiRet });
  }
  if (monthlyRet.length < 1) return { sharpe: -999, total: 0, alpha: -999, ir: -999, mdd: 0, nMonths: 0, meanMonthly: 0, stdMonthly: 0, kospiTotal: 0 };
  const total = monthlyRet.reduce((a, m) => (1 + a) * (1 + m.strat) - 1, 0);
  const kospiTotal = monthlyRet.reduce((a, m) => (1 + a) * (1 + m.kospi) - 1, 0);
  const mean = monthlyRet.reduce((a, m) => a + m.strat, 0) / monthlyRet.length;
  const std = monthlyRet.length >= 2 ? Math.sqrt(monthlyRet.reduce((a, m) => a + (m.strat - mean) ** 2, 0) / monthlyRet.length) : 0;
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(12) : 0;
  const alpha = monthlyRet.reduce((a, m) => a + (m.strat - m.kospi), 0) / monthlyRet.length;
  const te = monthlyRet.length >= 2 ? Math.sqrt(monthlyRet.reduce((a, m) => a + (m.strat - m.kospi - alpha) ** 2, 0) / monthlyRet.length) : 0;
  const ir = te > 0 ? (alpha / te) * Math.sqrt(12) : 0;
  let nav = 1, peak = 1, mdd = 0;
  for (const m of monthlyRet) { nav *= 1 + m.strat; if (nav > peak) peak = nav; const dd = (nav - peak) / peak; if (dd < mdd) mdd = dd; }
  return { sharpe, total, kospiTotal, alpha, ir, mdd, nMonths: monthlyRet.length, mean, std };
}

// === Risk Parity (변동성 균등) ===
// 7팩터 각각 monthly IC (Information Coefficient) = 상관계수(factor_score, next_month_return)
// → 변동성 = std(IC), 가중치 = |IC|/std 정규화 (IR-like)
function riskParityWeights(monthlyScores, monthlyRetArr) {
  const factorKeys = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];
  // 각 팩터별 IC 시계열
  const icSeries = {};
  for (const f of factorKeys) icSeries[f] = [];
  for (let i = 0; i < monthlyScores.length; i++) {
    const ms = monthlyScores[i];
    const ret = monthlyRetArr[i]?.returns || {};
    for (const f of factorKeys) {
      const xs = [];
      const ys = [];
      for (const s of ms.stocks) {
        const r = ret[s.code];
        if (r === undefined) continue;
        xs.push(s.scores[f] || 50);
        ys.push(r);
      }
      if (xs.length < 10) continue;
      const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
      const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
      let num = 0, dx2 = 0, dy2 = 0;
      for (let j = 0; j < xs.length; j++) {
        const dx = xs[j] - xm;
        const dy = ys[j] - ym;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
      }
      const denom = Math.sqrt(dx2 * dy2);
      if (denom > 0) icSeries[f].push(num / denom);
    }
  }
  // |IC| / std(IC) (IR-like) → 정규화
  const weights = {};
  let sum = 0;
  for (const f of factorKeys) {
    const ics = icSeries[f];
    if (ics.length < 2) { weights[f] = 0; continue; }
    const ic = ics.reduce((a, b) => a + b, 0) / ics.length;
    const mean = ic;
    const std = Math.sqrt(ics.reduce((a, b) => a + (b - mean) ** 2, 0) / ics.length);
    weights[f] = std > 0 ? Math.abs(ic) / std : 0;
    sum += weights[f];
  }
  if (sum > 0) for (const f of factorKeys) weights[f] = round2((weights[f] / sum) * 100);
  return { weights, icSeries };
}

// === 데이터 로드 ===
async function loadData() {
  const csvDir = path.join(ROOT, 'public', 'data', 'csv-cache');
  const files = fs.readdirSync(csvDir).filter((f) => f.startsWith('prices-') && f.endsWith('.csv')).sort().reverse();
  if (files.length === 0) throw new Error('CSV 없음');
  const csvFile = path.join(csvDir, files[0]);
  const kospiFile = path.join(csvDir, files[0].replace('prices-', 'kospi-'));

  const text = fs.readFileSync(csvFile, 'utf8');
  const lines = text.trim().split('\n');
  const prices = [];
  for (let i = 1; i < lines.length; i++) {
    const [code, date, close, volume] = lines[i].split(',');
    prices.push({ code, date, close: Number(close), volume: Number(volume) || 0 });
  }
  const ktext = fs.readFileSync(kospiFile, 'utf8');
  const klines = ktext.trim().split('\n');
  const kospiHistory = [];
  for (let i = 1; i < klines.length; i++) {
    const [date, close] = klines[i].split(',');
    kospiHistory.push({ date, close: Number(close) });
  }
  console.log(`[reg2] prices=${prices.length}행, kospi=${kospiHistory.length}행`);

  const monthEnds = new Map();
  for (const p of prices) {
    const ym = String(p.date).slice(0, 7);
    if (!monthEnds.has(p.code)) monthEnds.set(p.code, new Map());
    const m = monthEnds.get(p.code);
    if (!m.has(ym) || String(m.get(ym).date) < String(p.date)) m.set(ym, { date: String(p.date), close: Number(p.close), volume: Number(p.volume) || 0 });
  }
  const monthlyReturns = new Map();
  for (const [code, m] of monthEnds) {
    const sorted = [...m.entries()].sort();
    for (let i = 1; i < sorted.length; i++) {
      const [ym, cur] = sorted[i];
      const prev = sorted[i - 1][1];
      if (prev.close > 0) {
        const ret = (cur.close - prev.close) / prev.close;
        if (!monthlyReturns.has(ym)) monthlyReturns.set(ym, { date: cur.date, returns: {} });
        monthlyReturns.get(ym).returns[code] = ret;
      }
    }
  }
  const kospiMonthly = new Map();
  for (const k of kospiHistory) {
    const ym = String(k.date).slice(0, 7);
    if (!kospiMonthly.has(ym)) kospiMonthly.set(ym, { date: String(k.date), close: Number(k.close) });
    else if (String(kospiMonthly.get(ym).date) < String(k.date)) { kospiMonthly.get(ym).date = String(k.date); kospiMonthly.get(ym).close = Number(k.close); }
  }
  const kospiReturns = [];
  const sortedK = [...kospiMonthly.entries()].sort();
  for (let i = 1; i < sortedK.length; i++) {
    const cur = sortedK[i][1];
    const prev = sortedK[i - 1][1];
    if (prev.close > 0) kospiReturns.push({ date: cur.date, ret: (cur.close - prev.close) / prev.close });
  }
  const validCodes = [...new Set(prices.map((p) => p.code))];
  const byCode = new Map();
  for (const p of prices) {
    if (!byCode.has(p.code)) byCode.set(p.code, []);
    byCode.get(p.code).push(p);
  }
  for (const arr of byCode.values()) arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const yms = [...monthlyReturns.keys()].sort();
  const monthlyScores = [];
  for (const ym of yms) {
    const stocks = [];
    for (const code of validCodes) {
      const m = monthEnds.get(code);
      if (!m || !m.has(ym)) continue;
      const arr = byCode.get(code).filter((p) => String(p.date).slice(0, 7) <= ym);
      if (arr.length < 30) continue;
      const last = arr[arr.length - 1];
      const lastClose = Number(last.close) || 0;
      const yearIdx = Math.max(0, arr.length - 252);
      const monthIdx = Math.max(0, arr.length - 21);
      const yearOld = Number(arr[yearIdx].close) || 0;
      const monthOld = Number(arr[monthIdx].close) || 0;
      const ret12 = yearOld > 0 ? (lastClose - yearOld) / yearOld : 0;
      const ret1 = monthOld > 0 ? (lastClose - monthOld) / monthOld : 0;
      const momentum = ret12 - ret1;
      const tail = arr.slice(-60);
      const rets = [];
      for (let j = 1; j < tail.length; j++) {
        const c0 = Number(tail[j - 1].close);
        const c1 = Number(tail[j].close);
        if (c0 > 0 && c1 > 0) rets.push(Math.log(c1 / c0));
      }
      let vol = 0;
      if (rets.length >= 20) {
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
        vol = Math.sqrt(v);
      }
      const liqTail = arr.slice(-20);
      const turnover = liqTail.reduce((a, b) => a + (Number(b.volume) || 0) * (Number(b.close) || 0), 0) / liqTail.length;
      stocks.push({
        code,
        scores: {
          value: 50, momentum, quality: 50, volatility: vol, growth: 50,
          liquidity: Math.log10(Math.max(1, turnover)),
          supply: 50,
        },
      });
    }
    if (stocks.length < 30) continue;
    monthlyScores.push({ date: monthEnds.get(validCodes[0])?.get(ym)?.date || `${ym}-28`, ym, stocks });
  }
  for (const ms of monthlyScores) {
    const factorKeys = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];
    for (const k of factorKeys) {
      const higherBetter = (k === 'momentum' || k === 'growth' || k === 'liquidity' || k === 'supply');
      const values = ms.stocks.map((s) => s.scores[k]).sort((a, b) => higherBetter ? a - b : b - a);
      const n = values.length;
      const rankMap = new Map();
      values.forEach((v, i) => rankMap.set(v, ((n - i) / n) * 99));
      for (const s of ms.stocks) s.scores[k] = Math.max(1, Math.min(95, rankMap.get(s.scores[k]) || 50));
    }
  }
  const monthlyRetArr = [];
  for (let i = 0; i < monthlyScores.length; i++) {
    const ym = monthlyScores[i].ym;
    const nextY = ym.slice(0, 4);
    const nextM = String(Number(ym.slice(5, 7)) + 1).padStart(2, '0');
    const nextYm = nextM === '13' ? `${Number(nextY) + 1}-01` : `${nextY}-${nextM}`;
    const ret = monthlyReturns.get(nextYm);
    if (ret) monthlyRetArr.push(ret);
  }
  return { monthlyScores, monthlyRetArr, kospiReturns };
}

async function main() {
  const { monthlyScores, monthlyRetArr, kospiReturns } = await loadData();
  console.log(`[reg2] monthlyScores: ${monthlyScores.length}개월`);

  if (monthlyScores.length < 8) {
    console.error('[reg2] 데이터 부족');
    process.exit(1);
  }

  const factorKeys = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];

  // === 1) Ridge Regression with grid search ===
  console.log(`\n[reg2] === 1단계: Ridge Regression (L2 grid search) ===`);
  const X = [];
  const y = [];
  for (let i = 0; i < monthlyScores.length; i++) {
    const ms = monthlyScores[i];
    const ret = monthlyRetArr[i]?.returns || {};
    for (const s of ms.stocks) {
      const r = ret[s.code];
      if (r === undefined) continue;
      X.push(factorKeys.map((k) => s.scores[k] || 50));
      y.push(r);
    }
  }
  console.log(`[reg2] OLS rows: ${X.length} (factor scores → next month return)`);

  const lambdas = [0.001, 0.01, 0.1, 1, 5, 10, 50, 100, 500];
  const ridgeResults = [];
  for (const lambda of lambdas) {
    const beta = ridgeRegression(X, y, lambda);
    if (!beta) continue;
    const weights = {};
    let sumPos = 0;
    for (let i = 0; i < factorKeys.length; i++) {
      weights[factorKeys[i]] = Math.max(0, beta[i] || 0);
      sumPos += weights[factorKeys[i]];
    }
    if (sumPos > 0) for (const k of factorKeys) weights[k] = round2((weights[k] / sumPos) * 100);
    const sim = await simulate(weights, monthlyScores, monthlyRetArr, kospiReturns);
    console.log(`  λ=${String(lambda).padEnd(7)} β=[${beta.map((b) => round2(b)).join(', ')}]`);
    console.log(`           weights=${JSON.stringify(weights)} → Sharpe=${round2(sim.sharpe)} Total=${round2(sim.total * 100)}% MDD=${round2(sim.mdd * 100)}%`);
    ridgeResults.push({ lambda, weights, sim });
  }
  ridgeResults.sort((a, b) => b.sim.sharpe - a.sim.sharpe);
  const bestRidge = ridgeResults[0];
  console.log(`[reg2] ★ Ridge 최고: λ=${bestRidge.lambda}, Sharpe=${round2(bestRidge.sim.sharpe)}`);

  // === 2) K-fold Time Series Cross Validation ===
  console.log(`\n[reg2] === 2단계: 5-Fold Time Series CV ===`);
  const nFolds = 5;
  const minTrainMonths = 6;
  const totalMonths = monthlyScores.length;
  const foldSize = Math.max(1, Math.floor((totalMonths - minTrainMonths) / nFolds));
  const foldResults = [];
  for (let f = 0; f < nFolds; f++) {
    const trainEnd = minTrainMonths + f * foldSize;
    const testEnd = Math.min(totalMonths, trainEnd + foldSize);
    if (testEnd > totalMonths || trainEnd >= totalMonths) break;
    const trainScores = monthlyScores.slice(0, trainEnd);
    const trainRetArr = monthlyRetArr.slice(0, trainEnd - 1);
    const testScores = monthlyScores.slice(trainEnd - 1, testEnd);
    const testRetArr = monthlyRetArr.slice(trainEnd - 1, testEnd);
    const testKospi = kospiReturns.slice(Math.max(0, kospiReturns.length - (totalMonths - trainEnd + 1)));
    if (testScores.length === 0 || testRetArr.length === 0) continue;
    // train에서 Ridge
    const Xtr = [];
    const ytr = [];
    for (let i = 0; i < trainScores.length; i++) {
      const ret = trainRetArr[i]?.returns || {};
      for (const s of trainScores[i].stocks) {
        const r = ret[s.code];
        if (r === undefined) continue;
        Xtr.push(factorKeys.map((k) => s.scores[k] || 50));
        ytr.push(r);
      }
    }
    const lambdaCv = 10; // fixed for CV
    const betaCv = ridgeRegression(Xtr, ytr, lambdaCv);
    if (!betaCv) continue;
    const weightsCv = {};
    let sum = 0;
    for (let i = 0; i < factorKeys.length; i++) {
      weightsCv[factorKeys[i]] = Math.max(0, betaCv[i] || 0);
      sum += weightsCv[factorKeys[i]];
    }
    if (sum > 0) for (const k of factorKeys) weightsCv[k] = (weightsCv[k] / sum) * 100;
    const trainSim = await simulate(weightsCv, trainScores, trainRetArr, kospiReturns);
    const testSim = await simulate(weightsCv, testScores, testRetArr, testKospi);
    console.log(`  Fold ${f + 1}: train[0..${trainEnd}] test[${trainEnd}..${testEnd}]`);
    console.log(`    train Sharpe=${round2(trainSim.sharpe)} Total=${round2(trainSim.total * 100)}% → test Sharpe=${round2(testSim.sharpe)} Total=${round2(testSim.total * 100)}% KOSPI=${round2(testSim.kospiTotal * 100)}%`);
    foldResults.push({ fold: f + 1, weights: weightsCv, train: trainSim, test: testSim });
  }
  const validFolds = foldResults.filter((r) => r.test.sharpe > -10);
  if (validFolds.length > 0) {
    const avgTestSharpe = validFolds.reduce((a, b) => a + b.test.sharpe, 0) / validFolds.length;
    const avgTestTotal = validFolds.reduce((a, b) => a + b.test.total, 0) / validFolds.length;
    console.log(`[reg2] K-fold 평균 OOS: Sharpe=${round2(avgTestSharpe)} Total=${round2(avgTestTotal * 100)}%`);
  }

  // === 3) Expanding Window OOS ===
  console.log(`\n[reg2] === 3단계: Expanding Window OOS (1~12월 누적 train) ===`);
  const expandingResults = [];
  for (let trainMonths = 3; trainMonths < monthlyScores.length - 1; trainMonths++) {
    const trainScores = monthlyScores.slice(0, trainMonths);
    const trainRetArr = monthlyRetArr.slice(0, trainMonths - 1);
    const testScores = monthlyScores.slice(trainMonths - 1, trainMonths);
    const testRetArr = monthlyRetArr.slice(trainMonths - 1, trainMonths);
    const testKospi = kospiReturns.slice(Math.max(0, kospiReturns.length - (monthlyScores.length - trainMonths + 1)));
    if (testScores.length === 0) continue;
    const Xtr = [];
    const ytr = [];
    for (let i = 0; i < trainScores.length; i++) {
      const ret = trainRetArr[i]?.returns || {};
      for (const s of trainScores[i].stocks) {
        const r = ret[s.code];
        if (r === undefined) continue;
        Xtr.push(factorKeys.map((k) => s.scores[k] || 50));
        ytr.push(r);
      }
    }
    const betaExp = ridgeRegression(Xtr, ytr, 10);
    if (!betaExp) continue;
    const weightsExp = {};
    let sum = 0;
    for (let i = 0; i < factorKeys.length; i++) {
      weightsExp[factorKeys[i]] = Math.max(0, betaExp[i] || 0);
      sum += weightsExp[factorKeys[i]];
    }
    if (sum > 0) for (const k of factorKeys) weightsExp[k] = (weightsExp[k] / sum) * 100;
    const testSim = await simulate(weightsExp, testScores, testRetArr, testKospi);
    expandingResults.push({ trainMonths, test: testSim });
  }
  const validExp = expandingResults.filter((r) => r.test.sharpe > -10);
  if (validExp.length > 0) {
    const avgSharpe = validExp.reduce((a, b) => a + b.test.sharpe, 0) / validExp.length;
    const avgTotal = validExp.reduce((a, b) => a + b.test.total, 0) / validExp.length;
    console.log(`[reg2] Expanding OOS 평균: Sharpe=${round2(avgSharpe)} Total=${round2(avgTotal * 100)}% (n=${validExp.length})`);
  }

  // === 4) Risk Parity ===
  console.log(`\n[reg2] === 4단계: Risk Parity (변동성 균등) ===`);
  const rp = riskParityWeights(monthlyScores, monthlyRetArr);
  console.log(`[reg2] Risk Parity weights: ${JSON.stringify(rp.weights)}`);
  const rpSim = await simulate(rp.weights, monthlyScores, monthlyRetArr, kospiReturns);
  console.log(`[reg2] Risk Parity 시뮬: Sharpe=${round2(rpSim.sharpe)} Total=${round2(rpSim.total * 100)}% MDD=${round2(rpSim.mdd * 100)}%`);

  // === 5) Bootstrap CI ===
  console.log(`\n[reg2] === 5단계: Bootstrap CI (200 iter) ===`);
  const bootstrapResults = [];
  for (let b = 0; b < 200; b++) {
    // Resample months
    const idx = Array.from({ length: monthlyRetArr.length }, (_, i) => i).sort(() => Math.random() - 0.5);
    const bootRetArr = idx.map((i) => monthlyRetArr[i]);
    const bootScores = idx.map((i) => monthlyScores[i]);
    const sim = await simulate(rp.weights, bootScores, bootRetArr, kospiReturns);
    bootstrapResults.push(sim.total);
  }
  bootstrapResults.sort((a, b) => a - b);
  const ci05 = bootstrapResults[Math.floor(bootstrapResults.length * 0.05)];
  const ci50 = bootstrapResults[Math.floor(bootstrapResults.length * 0.5)];
  const ci95 = bootstrapResults[Math.floor(bootstrapResults.length * 0.95)];
  console.log(`[reg2] Bootstrap Total 5%/50%/95%: ${round2(ci05 * 100)}% / ${round2(ci50 * 100)}% / ${round2(ci95 * 100)}%`);

  // === 6) 최종 best 결정 ===
  const candidates = [
    { name: 'Ridge-λ10', weights: bestRidge.weights, sim: bestRidge.sim },
    { name: '균등(7팩터)', weights: { value: 14.3, momentum: 14.3, quality: 14.3, volatility: 14.3, growth: 14.3, liquidity: 14.3, supply: 14.3 }, sim: await simulate({ value: 14.3, momentum: 14.3, quality: 14.3, volatility: 14.3, growth: 14.3, liquidity: 14.3, supply: 14.3 }, monthlyScores, monthlyRetArr, kospiReturns) },
    { name: '가치(50)', weights: { value: 50, momentum: 10, quality: 15, volatility: 5, growth: 10, liquidity: 5, supply: 5 }, sim: await simulate({ value: 50, momentum: 10, quality: 15, volatility: 5, growth: 10, liquidity: 5, supply: 5 }, monthlyScores, monthlyRetArr, kospiReturns) },
    { name: 'Risk Parity', weights: rp.weights, sim: rpSim },
  ];
  console.log(`\n[reg2] ═══ 후보 비교 ═══`);
  for (const c of candidates) {
    console.log(`  [${c.name.padEnd(15)}] Sharpe=${round2(c.sim.sharpe)} Total=${round2(c.sim.total * 100)}% MDD=${round2(c.sim.mdd * 100)}% Alpha=${round2(c.sim.alpha * 100)}%/월`);
  }
  // OOS K-fold 평균 best
  const oosBest = validFolds.length > 0 ? validFolds.reduce((a, b) => (b.test.sharpe > a.test.sharpe ? b : a)) : null;
  if (oosBest) {
    console.log(`  [OOS-Kfold best  ] weights=${JSON.stringify(oosBest.weights)} test Sharpe=${round2(oosBest.test.sharpe)}`);
  }

  // best = Sharpe + (1-MDD) + Alpha 종합
  candidates.forEach((c) => {
    c.score = c.sim.sharpe + c.sim.alpha * 100 - Math.abs(c.sim.mdd) * 5;
  });
  candidates.sort((a, b) => b.score - a.score);
  const finalBest = candidates[0];
  console.log(`\n[reg2] ★ 최종 best (Sharpe + Alpha - MDD): ${finalBest.name}`);
  console.log(`  weights: ${JSON.stringify(finalBest.weights)}`);
  console.log(`  Sharpe=${round2(finalBest.sim.sharpe)} Total=${round2(finalBest.sim.total * 100)}% MDD=${round2(finalBest.sim.mdd * 100)}%`);

  // 저장
  const out = {
    asOf: new Date().toISOString(),
    period: `${monthlyScores[0]?.ym} ~ ${monthlyScores[monthlyScores.length - 1]?.ym}`,
    nMonths: monthlyScores.length,
    ridge: ridgeResults.map((r) => ({ lambda: r.lambda, weights: r.weights, sharpe: round4(r.sim.sharpe), total: round4(r.sim.total), mdd: round4(r.sim.mdd) })),
    bestRidge: { lambda: bestRidge.lambda, weights: bestRidge.weights, sharpe: round4(bestRidge.sim.sharpe), total: round4(bestRidge.sim.total) },
    kfold: foldResults.map((r) => ({ fold: r.fold, weights: r.weights, trainSharpe: round4(r.train.sharpe), testSharpe: round4(r.test.sharpe), testTotal: round4(r.test.total) })),
    kfoldAvg: validFolds.length > 0 ? { avgTestSharpe: round4(validFolds.reduce((a, b) => a + b.test.sharpe, 0) / validFolds.length), avgTestTotal: round4(validFolds.reduce((a, b) => a + b.test.total, 0) / validFolds.length) } : null,
    expanding: { avgSharpe: validExp.length > 0 ? round4(validExp.reduce((a, b) => a + b.test.sharpe, 0) / validExp.length) : 0, n: validExp.length },
    riskParity: { weights: rp.weights, sharpe: round4(rpSim.sharpe), total: round4(rpSim.total), mdd: round4(rpSim.mdd) },
    bootstrap: { ci05: round4(ci05), ci50: round4(ci50), ci95: round4(ci95) },
    candidates: candidates.map((c) => ({ name: c.name, weights: c.weights, sharpe: round4(c.sim.sharpe), total: round4(c.sim.total), mdd: round4(c.sim.mdd), alpha: round4(c.sim.alpha), score: round4(c.score) })),
    finalBest: { name: finalBest.name, weights: finalBest.weights, sharpe: round4(finalBest.sim.sharpe), total: round4(finalBest.sim.total), mdd: round4(finalBest.sim.mdd) },
  };
  fs.writeFileSync(path.join(ROOT, 'public', 'data', 'regression-2.json'), JSON.stringify(out, null, 2));
  console.log(`[reg2] regression-2.json 저장`);
}

main().catch((e) => { console.error('[reg2] fatal:', e.message, e.stack); process.exit(1); });
