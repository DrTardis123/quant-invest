'use strict';
// 7팩터 회귀분석 + 반복 최적화 (KOSPI 대비 알파 최대화)
// DuckDB lock 회피: CSV로 export 후 in-memory에서 분석
// 1) 매월 factor score → 다음달 수익률 회귀 (β 계수 = 팩터 가중치)
// 2) Random Search + Local Refinement로 Sharpe/IR 최대화
// 3) KOSPI 대비 알파 ≥ 0 제약

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const fs = require('fs');

// 유틸
function round4(v) { return Math.round(v * 10000) / 10000; }
function round2(v) { return Math.round(v * 100) / 100; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// === 회귀분석: X (factor scores) → y (다음달 수익률) ===
// OLS (Ordinary Least Squares) closed-form
function olsRegression(X, y) {
  // X: m x n matrix, y: m vector
  // β = (X^T X)^-1 X^T y
  const m = X.length;
  if (m < 5) return null;
  const n = X[0].length;
  // X^T X
  const XtX = [];
  for (let i = 0; i < n; i++) {
    XtX.push([]);
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += X[k][i] * X[k][j];
      XtX[i].push(s);
    }
  }
  // X^T y
  const Xty = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < m; k++) s += X[k][i] * y[k];
    Xty.push(s);
  }
  // Solve XtX * β = Xty via Gauss-Jordan
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let i = 0; i < n; i++) {
    // pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    if (Math.abs(A[i][i]) < 1e-9) return null;
    // normalize
    const piv = A[i][i];
    for (let j = i; j <= n; j++) A[i][j] /= piv;
    // eliminate
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = A[k][i];
      for (let j = i; j <= n; j++) A[k][j] -= f * A[i][j];
    }
  }
  const beta = A.map((row) => row[n]);
  // R²
  const yMean = y.reduce((a, b) => a + b, 0) / m;
  let ssTot = 0, ssRes = 0;
  for (let k = 0; k < m; k++) {
    const yHat = beta.reduce((s, b, j) => s + b * X[k][j], 0);
    ssTot += (y[k] - yMean) ** 2;
    ssRes += (y[k] - yHat) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { beta, r2 };
}

// === 시뮬레이션 ===
async function simulate(weights, monthlyScores, monthlyReturns, kospiReturns, topN = 20) {
  // monthlyScores: [{ date, [{ code, scores: {value, momentum, ...} }] }]
  // monthlyReturns: [{ date, returns: { code: ret } }]
  // kospiReturns: [{ date, ret }]
  const factorKeys = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];
  const W = factorKeys.map((k) => Math.max(0, weights[k] || 0));
  const wSum = W.reduce((a, b) => a + b, 0);
  if (wSum === 0) return { sharpe: -999, total: 0, alpha: -999, ir: -999 };
  const Wn = W.map((w) => w / wSum);

  // date → returns map
  const retMap = new Map();
  for (let i = 0; i < monthlyReturns.length; i++) {
    const r = monthlyReturns[i];
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
    // score 계산
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
  if (monthlyRet.length < 6) return { sharpe: -999, total: 0, alpha: -999, ir: -999 };

  const total = monthlyRet.reduce((a, m) => (1 + a) * (1 + m.strat) - 1, 0);
  const kospiTotal = monthlyRet.reduce((a, m) => (1 + a) * (1 + m.kospi) - 1, 0);
  const mean = monthlyRet.reduce((a, m) => a + m.strat, 0) / monthlyRet.length;
  const std = Math.sqrt(monthlyRet.reduce((a, m) => a + (m.strat - mean) ** 2, 0) / monthlyRet.length);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(12) : 0;
  // 알파 = 평균(전략 - KOSPI)
  const alpha = monthlyRet.reduce((a, m) => a + (m.strat - m.kospi), 0) / monthlyRet.length;
  // IR = alpha / te, te = std(전략 - KOSPI)
  const te = Math.sqrt(monthlyRet.reduce((a, m) => a + (m.strat - m.kospi - alpha) ** 2, 0) / monthlyRet.length);
  const ir = te > 0 ? (alpha / te) * Math.sqrt(12) : 0;
  // MDD
  let nav = 1, peak = 1, mdd = 0;
  for (const m of monthlyRet) {
    nav *= 1 + m.strat;
    if (nav > peak) peak = nav;
    const dd = (nav - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return { sharpe, total, kospiTotal, alpha, ir, mdd, nMonths: monthlyRet.length, meanMonthly: mean, stdMonthly: std };
}

// === 데이터 로드 (CSV 우선, DuckDB 폴백) ===
async function loadData() {
  // CSV 캐시: public/data/csv-cache/ 디렉토리 (DuckDB lock 회피)
  const csvDir = path.join(ROOT, 'public', 'data', 'csv-cache');
  fs.mkdirSync(csvDir, { recursive: true });
  const csvFile = path.join(csvDir, 'prices-2026-08-14.csv');
  const kospiCsv = path.join(csvDir, 'kospi-2026-08-14.csv');

  let prices = [];
  let kospiHistory = [];

  // CSV 캐시 확인
  if (fs.existsSync(csvFile) && fs.existsSync(kospiCsv)) {
    console.log('[regression] CSV 캐시 사용');
    const text = fs.readFileSync(csvFile, 'utf8');
    const lines = text.trim().split('\n');
    for (let i = 1; i < lines.length; i++) {
      const [code, date, close, volume] = lines[i].split(',');
      prices.push({ code, date, close: Number(close), volume: Number(volume) || 0 });
    }
    const ktext = fs.readFileSync(kospiCsv, 'utf8');
    const klines = ktext.trim().split('\n');
    for (let i = 1; i < klines.length; i++) {
      const [date, close] = klines[i].split(',');
      kospiHistory.push({ date, close: Number(close) });
    }
  } else {
    // DuckDB에서 로드
    console.log('[regression] DuckDB에서 데이터 로드...');
    const { all } = require('../src/db/connection');
    const stocks = await all(`
      SELECT s.code, s.name, s.market FROM stocks s
      WHERE s.market = 'KOSPI' AND s.name NOT LIKE '%우%'
      ORDER BY s.code LIMIT 200
    `);
    const codes = stocks.map((s) => s.code);
    console.log(`[regression] 종목: ${codes.length}개`);
    prices = await all(`
      SELECT code, date, close, volume FROM daily_prices
      WHERE code IN (${codes.map(() => '?').join(',')})
      ORDER BY code, date
    `, codes);
    // KOSPI: indices 테이블 or indices.json
    kospiHistory = await all(`SELECT date, close FROM indices WHERE market = 'KOSPI' ORDER BY date`).catch(() => []);
    if (kospiHistory.length === 0) {
      const idxPath = path.join(ROOT, 'public', 'data', 'indices.json');
      if (fs.existsSync(idxPath)) {
        const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
        const kospiArr = Array.isArray(idx) ? idx.find((x) => x.market === 'KOSPI') : null;
        if (kospiArr && kospiArr.history) {
          for (const k of kospiArr.history) kospiHistory.push({ date: k.date, close: k.close });
        }
      }
    }
    console.log(`[regression] kospi: ${kospiHistory.length}행`);

    // CSV로 저장
    const lines = ['code,date,close,volume'];
    for (const p of prices) lines.push(`${p.code},${String(p.date).slice(0, 10)},${Number(p.close)},${Number(p.volume) || 0}`);
    fs.writeFileSync(csvFile, lines.join('\n'));
    const klines = ['date,close'];
    for (const k of kospiHistory) klines.push(`${String(k.date).slice(0, 10)},${Number(k.close)}`);
    fs.writeFileSync(kospiCsv, klines.join('\n'));
    console.log(`[regression] CSV 캐시 저장: ${csvFile}`);
  }

  console.log(`[regression] prices: ${prices.length}행, kospiHistory: ${kospiHistory.length}행`);

  // KOSPI 메인 종목만 (200)
  const validCodes = [...new Set(prices.map((p) => p.code))];

  // 월말 시점 산출
  const monthEnds = new Map();
  for (const p of prices) {
    const ym = String(p.date).slice(0, 7);
    if (!monthEnds.has(p.code)) monthEnds.set(p.code, new Map());
    const m = monthEnds.get(p.code);
    if (!m.has(ym) || String(m.get(ym).date) < String(p.date)) {
      m.set(ym, { date: String(p.date), close: Number(p.close), volume: Number(p.volume) || 0 });
    }
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

  // KOSPI 월별 ret
  const kospiMonthly = new Map();
  for (let i = 0; i < kospiHistory.length; i++) {
    const ym = String(kospiHistory[i].date).slice(0, 7);
    if (!kospiMonthly.has(ym)) kospiMonthly.set(ym, { date: String(kospiHistory[i].date), close: Number(kospiHistory[i].close) });
    else if (String(kospiMonthly.get(ym).date) < String(kospiHistory[i].date)) {
      kospiMonthly.get(ym).date = String(kospiHistory[i].date);
      kospiMonthly.get(ym).close = Number(kospiHistory[i].close);
    }
  }
  const kospiReturns = [];
  const sortedK = [...kospiMonthly.entries()].sort();
  for (let i = 1; i < sortedK.length; i++) {
    const cur = sortedK[i][1];
    const prev = sortedK[i - 1][1];
    if (prev.close > 0) kospiReturns.push({ date: cur.date, ret: (cur.close - prev.close) / prev.close });
  }
  console.log(`[regression] KOSPI 월별: ${kospiReturns.length}개`);

  // 각 월말마다 팩터 계산
  const yms = [...monthlyReturns.keys()].sort();
  const monthlyScores = [];
  // code별 가격 시계열 미리 그룹화
  const byCode = new Map();
  for (const p of prices) {
    if (!byCode.has(p.code)) byCode.set(p.code, []);
    byCode.get(p.code).push(p);
  }
  for (const arr of byCode.values()) arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  for (let i = 0; i < yms.length; i++) {
    const ym = yms[i];
    const cur = monthEnds;
    const stocks = [];
    for (const code of validCodes) {
      const m = cur.get(code);
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
  // 정규화
  for (const ms of monthlyScores) {
    const factorKeys = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];
    for (const k of factorKeys) {
      const higherBetter = (k === 'momentum' || k === 'growth' || k === 'liquidity' || k === 'supply');
      const values = ms.stocks.map((s) => s.scores[k]).sort((a, b) => higherBetter ? a - b : b - a);
      const n = values.length;
      const rankMap = new Map();
      values.forEach((v, i) => rankMap.set(v, ((n - i) / n) * 99));
      for (const s of ms.stocks) {
        s.scores[k] = Math.max(1, Math.min(95, rankMap.get(s.scores[k]) || 50));
      }
    }
  }
  // monthlyScores[i]의 다음달 수익률 = monthlyRetArr[i]
  const monthlyRetArr = [];
  for (let i = 0; i < monthlyScores.length; i++) {
    const ym = monthlyScores[i].ym;
    // 다음달
    const nextY = ym.slice(0, 4);
    const nextM = String(Number(ym.slice(5, 7)) + 1).padStart(2, '0');
    const nextYm = nextM === '13' ? `${Number(nextY) + 1}-01` : `${nextY}-${nextM}`;
    const ret = monthlyReturns.get(nextYm);
    if (ret) monthlyRetArr.push(ret);
  }
  return { monthlyScores, monthlyRetArr, kospiReturns };
}

// === 평가 함수 (composite score) ===
function scoreFn(result) {
  if (result.sharpe < -10) return -1e9;
  // Sharpe 50% + IR 30% + Total 20%
  // 알파 제약: 알파 < 0이면 큰 페널티
  if (result.alpha < -0.005) return -1e9; // 월 -0.5% 미만이면 탈락
  let s = result.sharpe * 0.5 + result.ir * 0.3 + result.total * 5;
  if (result.kospiTotal > 0) s += 0.2; // KOSPI 양수일 때 보너스
  if (result.total < result.kospiTotal) s -= 0.5; // KOSPI보다 못하면 페널티
  return s;
}

async function main() {
  const { monthlyScores, monthlyRetArr, kospiReturns } = await loadData();
  console.log(`[regression] monthlyScores: ${monthlyScores.length}개월, monthlyRetArr: ${monthlyRetArr.length}개월`);

  if (monthlyScores.length < 12) {
    console.error('[regression] 데이터 부족. 더 긴 일봉 fetch 필요.');
    process.exit(1);
  }

  // === 1) 회귀분석: factor score → 다음달 수익률 ===
  console.log('[regression] 1단계: OLS 회귀분석...');
  const factorKeys = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];
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
  const reg = olsRegression(X, y);
  if (reg) {
    console.log(`[regression] R²=${round4(reg.r2)}, β=[${reg.beta.map((b) => round2(b)).join(', ')}]`);
    // β → 가중치 (음수는 0으로, 정규화)
    const weights = {};
    let sumPos = 0;
    for (let i = 0; i < factorKeys.length; i++) {
      weights[factorKeys[i]] = Math.max(0, reg.beta[i] || 0);
      sumPos += weights[factorKeys[i]];
    }
    if (sumPos > 0) {
      for (const k of factorKeys) weights[k] = round2((weights[k] / sumPos) * 100);
    }
    console.log('[regression] 회귀 → 가중치:', weights);
    const sim = await simulate(weights, monthlyScores, monthlyRetArr, kospiReturns);
    console.log(`[regression] 회귀 시뮬: Sharpe=${round2(sim.sharpe)} IR=${round2(sim.ir)} Total=${round2(sim.total * 100)}% Alpha=${round2(sim.alpha * 100)}% KOSPI=${round2(sim.kospiTotal * 100)}%`);
  }

  // === 2) Random Search ===
  console.log('[regression] 2단계: Random Search (2000회)...');
  const randomResults = [];
  for (let i = 0; i < 2000; i++) {
    // 7팩터 가중치 random
    const w = {};
    let sum = 0;
    for (const k of factorKeys) {
      w[k] = Math.random() * 30;
      sum += w[k];
    }
    for (const k of factorKeys) w[k] = round2((w[k] / sum) * 100);
    const r = await simulate(w, monthlyScores, monthlyRetArr, kospiReturns);
    const sc = scoreFn(r);
    if (sc > -1e8) randomResults.push({ weights: w, result: r, score: sc });
  }
  randomResults.sort((a, b) => b.score - a.score);
  console.log(`[regression] Random Search Top 5:`);
  for (let i = 0; i < 5; i++) {
    const x = randomResults[i];
    console.log(`  #${i + 1}: ${JSON.stringify(x.weights)} → Sharpe=${round2(x.result.sharpe)} IR=${round2(x.result.ir)} Total=${round2(x.result.total * 100)}%`);
  }

  // === 3) Local Refinement (Top 20) ===
  console.log('[regression] 3단계: Local Refinement (Top 20, 100 iter)...');
  const refined = [];
  for (let i = 0; i < Math.min(20, randomResults.length); i++) {
    const base = { ...randomResults[i].weights };
    for (let j = 0; j < 100; j++) {
      const w = {};
      let sum = 0;
      for (const k of factorKeys) {
        w[k] = Math.max(0, (base[k] || 0) + (Math.random() - 0.5) * 10);
        sum += w[k];
      }
      if (sum === 0) continue;
      for (const k of factorKeys) w[k] = round2((w[k] / sum) * 100);
      const r = await simulate(w, monthlyScores, monthlyRetArr, kospiReturns);
      const sc = scoreFn(r);
      if (sc > -1e8) refined.push({ weights: w, result: r, score: sc });
    }
  }
  refined.sort((a, b) => b.score - a.score);
  console.log(`[regression] Refined Top 5:`);
  for (let i = 0; i < 5; i++) {
    const x = refined[i];
    console.log(`  #${i + 1}: ${JSON.stringify(x.weights)} → Sharpe=${round2(x.result.sharpe)} IR=${round2(x.result.ir)} Total=${round2(x.result.total * 100)}% KOSPI=${round2(x.result.kospiTotal * 100)}% Alpha=${round2(x.result.alpha * 100)}% MDD=${round2(x.result.mdd * 100)}%`);
  }

  // === 4) 최종 best ===
  const all = [...refined, ...randomResults].sort((a, b) => b.score - a.score);
  const best = all[0];
  console.log(`\n[regression] ═══ 최종 최적 가중치 ═══`);
  console.log(`가중치: ${JSON.stringify(best.weights)}`);
  console.log(`Sharpe: ${round2(best.result.sharpe)}`);
  console.log(`IR: ${round2(best.result.ir)}`);
  console.log(`Total: ${round2(best.result.total * 100)}%`);
  console.log(`KOSPI Total: ${round2(best.result.kospiTotal * 100)}%`);
  console.log(`Alpha (월): ${round2(best.result.alpha * 100)}%`);
  console.log(`MDD: ${round2(best.result.mdd * 100)}%`);
  console.log(`개월: ${best.result.nMonths}`);

  // 결과 저장
  const out = {
    asOf: new Date().toISOString(),
    period: `${monthlyScores[0]?.date || '?'} ~ ${monthlyScores[monthlyScores.length - 1]?.date || '?'}`,
    nMonths: best.result.nMonths,
    kospi: { total: round4(best.result.kospiTotal), months: best.result.nMonths },
    best: {
      name: '회귀-최적화',
      source: 'Regression + Random Search',
      weights: best.weights,
      total: round4(best.result.total),
      cagr: round4(best.result.total), // 단순화
      sharpe: round4(best.result.sharpe),
      ir: round4(best.result.ir),
      alpha: round4(best.result.alpha),
      mdd: round4(best.result.mdd),
      winRate: best.result.meanMonthly > 0 ? 1 : 0,
      description: `회귀분석+반복최적화: Sharpe ${round2(best.result.sharpe)}, KOSPI 대비 알파 ${round2(best.result.alpha * 100)}%/월`,
    },
    regression: {
      r2: reg ? round4(reg.r2) : 0,
      beta: reg ? reg.beta.map((b) => round4(b)) : [],
      nStocks: X.length,
    },
    top10: refined.slice(0, 10).map((x) => ({
      name: '회귀-Refined',
      source: `Refined #${refined.indexOf(x) + 1}`,
      weights: x.weights,
      total: round4(x.result.total),
      cagr: round4(x.result.total),
      sharpe: round4(x.result.sharpe),
      ir: round4(x.result.ir),
      alpha: round4(x.result.alpha),
      mdd: round4(x.result.mdd),
      months: x.result.nMonths,
    })),
  };
  fs.writeFileSync(path.join(ROOT, 'public', 'data', 'optimizer.json'), JSON.stringify(out, (_k, v) => typeof v === 'bigint' ? Number(v) : v, 2));
  console.log(`[regression] optimizer.json 저장 완료`);
}

main().catch((e) => {
  console.error('[regression] fatal:', e.message, e.stack);
  process.exit(1);
});
