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
  for (const k of kospiArr) kospiByDate.set(String(k.date), Number(k.close) || 0);

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

    // BigInt 안전: Number() 캐스팅
    const safeNum = safe.map((r) => ({
      code: r.code,
      p1: r.p1 != null ? Number(r.p1) : null,
      p2: r.p2 != null ? Number(r.p2) : null,
    }));

    // 가중치 적용 재랭킹 (7팩터)
    const scored = top.map((t) => {
      const s = safeNum.find((r) => r.code === t.code);
      const p1 = s?.p1;
      const p2 = s?.p2;
      let ret = null;
      if (p1 && p2 && p1 > 0) ret = (p2 - p1) / p1;
      return {
        code: t.code,
        score: (Number(t.value_score) || 0) * wv + (Number(t.momentum_score) || 0) * wm +
               (Number(t.quality_score) || 0) * wq + (Number(t.volatility_score) || 0) * wlv +
               (Number(t.growth_score) || 0) * wg + (Number(t.liquidity_score) || 0) * wliq +
               (Number(t.supply_score) || 0) * wsup,
        ret,
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

// 사전 계산된 백테스트 (factor_scores 누적 없이 daily_prices 직접 사용)
// EXPORT_ONLY에서 daily_prices historical monthly 시뮬레이션
async function backtestFromDailyPrices({ strategy = null, topN = TOP_N, months = 14 } = {}) {
  const { all } = require('../db/connection');
  const { getIndexHistory } = require('../data/indices');
  const strategies = require('../strategies');

  // KOSPI 일봉 (BigInt → Number)
  const kospiArr = await getIndexHistory('KOSPI', { days: 800 });
  const kospiByDate = new Map();
  for (const k of kospiArr) kospiByDate.set(String(k.date).slice(0, 10), Number(k.close) || 0);

  // 월말 시점
  const dates = await all(`
    SELECT strftime(date, '%Y-%m') AS ym, MAX(date) AS last_date
    FROM daily_prices GROUP BY ym ORDER BY ym DESC LIMIT ?
  `, [months + 1]);
  const monthEnds = dates.map((d) => String(d.last_date).slice(0, 10)).reverse();

  // 시총 상위 KOSPI 종목 (ETF/레버리지/인버스/SPAC 제외)
  const universe = await all(`
    SELECT code, name FROM stocks
    WHERE market = 'KOSPI'
      AND (code IN (SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) > 100))
      AND name NOT LIKE '%KODEX%' AND name NOT LIKE '%TIGER%' AND name NOT LIKE '%KBSTAR%'
      AND name NOT LIKE '%ARIRANG%' AND name NOT LIKE '%KINDEX%' AND name NOT LIKE '%SOL %'
      AND name NOT LIKE '%ACE %' AND name NOT LIKE '%RISE %' AND name NOT LIKE '%WOORI %'
      AND name NOT LIKE '%KIWOOM %' AND name NOT LIKE '%PLUS %'
      AND name NOT LIKE '%레버리지%' AND name NOT LIKE '%인버스%' AND name NOT LIKE '%선물%'
      AND name NOT LIKE '%ETN%' AND name NOT LIKE '%액티브%' AND name NOT LIKE '%합성%'
      AND name NOT LIKE '%스팩%' AND name NOT LIKE '%기업인수목적%'
    ORDER BY code LIMIT 300
  `);

  // 매월 팩터 계산
  const monthly = [];
  for (const date of monthEnds) {
    const snap = await computeFactorsAtDate(date, universe);
    if (snap.stocks.length > 0) monthly.push(snap);
  }

  // 시뮬레이션
  const W = (strategy || strategies.get('balanced')).weights;
  const factorKeys = [
    { key: 'value_score',     w: W.value || 0 },
    { key: 'momentum_score',  w: W.momentum || 0 },
    { key: 'quality_score',   w: W.quality || 0 },
    { key: 'volatility_score', w: W.volatility || 0 },
    { key: 'growth_score',    w: W.growth || 0 },
    { key: 'liquidity_score', w: W.liquidity || 0 },
    { key: 'supply_score',    w: W.supply || 0 },
  ];
  const totalW = factorKeys.reduce((a, k) => a + k.w, 0) || 100;

  const monthlyReturns = [];
  for (let i = 0; i < monthly.length - 1; i++) {
    const d1 = String(monthly[i].date);
    const d2 = String(monthly[i + 1].date);
    const nextByCode = new Map();
    for (const s of monthly[i + 1].stocks) nextByCode.set(s.code, Number(s.last_close) || 0);
    const scored = monthly[i].stocks
      .filter((s) => nextByCode.has(s.code))
      .map((s) => {
        const lastClose = Number(s.last_close) || 0;
        const nextClose = Number(nextByCode.get(s.code)) || 0;
        const ret = lastClose > 0 ? (nextClose / lastClose) - 1 : 0;
        const score = factorKeys.reduce((a, k) => a + (Number(s[k.key]) || 0) * k.w, 0) / totalW;
        return { code: s.code, score, ret };
      });
    if (scored.length === 0) { monthlyReturns.push({ from: d1, to: d2, strategy: 0, kospi: 0, count: 0 }); continue; }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topN);
    const sRet = top.reduce((a, b) => a + b.ret, 0) / top.length;
    const k1 = kospiByDate.get(d1);
    const k2 = kospiByDate.get(d2);
    const kRet = (k1 && k2 && k1 > 0) ? (k2 - k1) / k1 : 0;
    monthlyReturns.push({ from: d1, to: d2, strategy: sRet, kospi: kRet, count: top.length });
  }
  if (monthlyReturns.length === 0) return { ok: false, error: '시뮬 가능 구간 없음' };

  const stratNav = [1], kospiNav = [1];
  for (const m of monthlyReturns) {
    stratNav.push(stratNav[stratNav.length - 1] * (1 + m.strategy));
    kospiNav.push(kospiNav[kospiNav.length - 1] * (1 + m.kospi));
  }
  const totalReturn = stratNav[stratNav.length - 1] - 1;
  const kospiTotal = kospiNav[kospiNav.length - 1] - 1;
  const m = monthlyReturns.length;
  const cagr = Math.pow(1 + totalReturn, 12 / m) - 1;
  const meanR = monthlyReturns.reduce((a, b) => a + b.strategy, 0) / m;
  const stdR = Math.sqrt(monthlyReturns.reduce((a, b) => a + (b.strategy - meanR) ** 2, 0) / m);
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(12) : 0;
  let peak = 1, mdd = 0;
  for (const v of stratNav) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  const winMonths = monthlyReturns.filter((x) => x.strategy > 0).length;
  const winRate = m > 0 ? winMonths / m : 0;
  const grossProfit = monthlyReturns.filter((x) => x.strategy > 0).reduce((a, b) => a + b.strategy, 0);
  const grossLoss = Math.abs(monthlyReturns.filter((x) => x.strategy < 0).reduce((a, b) => a + b.strategy, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);
  // Beta / IR
  let beta = 0, informationRatio = 0;
  const validRet = monthlyReturns.filter((x) => x.kospi !== null);
  if (validRet.length >= 3) {
    const kMean = validRet.reduce((a, b) => a + b.kospi, 0) / validRet.length;
    const sMean = validRet.reduce((a, b) => a + b.strategy, 0) / validRet.length;
    let cov = 0, varK = 0;
    for (const x of validRet) {
      cov += (x.strategy - sMean) * (x.kospi - kMean);
      varK += (x.kospi - kMean) ** 2;
    }
    cov /= validRet.length; varK /= validRet.length;
    beta = varK > 0 ? cov / varK : 0;
    const alpha = sMean - kMean;
    let te = 0;
    for (const x of validRet) te += (x.strategy - x.kospi - alpha) ** 2;
    te = Math.sqrt(te / validRet.length);
    informationRatio = te > 0 ? (alpha / te) * Math.sqrt(12) : 0;
  }
  // 연도별
  const yearlyMap = new Map();
  for (const m of monthlyReturns) {
    const y = String(m.from).slice(0, 4);
    if (!yearlyMap.has(y)) yearlyMap.set(y, { year: y, strategy: 0, kospi: 0, count: 0 });
    const ye = yearlyMap.get(y);
    ye.strategy = (1 + ye.strategy) * (1 + m.strategy) - 1;
    ye.kospi = (1 + ye.kospi) * (1 + m.kospi) - 1;
    ye.count++;
  }
  const yearlyReturns = [...yearlyMap.values()].map((y) => ({
    year: y.year, strategy: round4(y.strategy), kospi: round4(y.kospi), months: y.count,
  }));
  // 월별 그리드
  const monthGrid = {};
  for (const m of monthlyReturns) {
    const y = String(m.from).slice(0, 4);
    const mo = Number(String(m.from).slice(5, 7));
    if (!monthGrid[y]) monthGrid[y] = new Array(12).fill(null);
    monthGrid[y][mo - 1] = m.strategy;
  }

  return {
    ok: true,
    computedAt: new Date().toISOString(),
    topN, months: m,
    strategy: (strategy || strategies.get('balanced')).name,
    weights: W,
    nDays: monthly.length,
    fromDate: String(monthly[0].date),
    toDate: String(monthly[monthly.length - 1].date),
    totalReturn: round4(totalReturn),
    kospiTotal: round4(kospiTotal),
    cagr: round4(cagr),
    sharpe: round4(sharpe),
    mdd: round4(mdd),
    winRate: round4(winRate),
    winMonths,
    profitFactor: round4(Math.min(profitFactor, 99)),
    beta: round4(beta),
    informationRatio: round4(informationRatio),
    nav: stratNav.map((v, i) => ({ idx: i, value: round4(v) })),
    kospiNav: kospiNav.map((v, i) => ({ idx: i, value: round4(v) })),
    monthlyReturns: monthlyReturns.map((m) => ({
      from: String(m.from), to: String(m.to),
      strategy: round4(m.strategy), kospi: round4(m.kospi), count: m.count,
    })),
    yearlyReturns,
    monthGrid,
  };
}

async function computeFactorsAtDate(date, universe) {
  const { all } = require('../db/connection');
  const codes = universe.map((u) => u.code);
  if (codes.length === 0) return { date, stocks: [] };

  // 각 종목의 date까지의 가격 + 팩터 계산
  const stocks = [];
  for (const code of codes) {
    const arr = await all(`
      SELECT date, close, volume FROM daily_prices
      WHERE code = ? AND date <= ? ORDER BY date
    `, [code, date]);
    if (arr.length < 30) continue;
    const last = arr[arr.length - 1];
    const yearIdx = Math.max(0, arr.length - 252);
    const monthIdx = Math.max(0, arr.length - 21);
    const yearOld = arr[yearIdx].close;
    const monthOld = arr[monthIdx].close;
    const ret12 = yearOld > 0 ? (last.close - yearOld) / yearOld : null;
    const ret1 = monthOld > 0 ? (last.close - monthOld) / monthOld : null;
    const momentum = (ret12 !== null && ret1 !== null) ? ret12 - ret1 : null;

    // 60일 변동성
    const tail = arr.slice(-60);
    const rets = [];
    for (let i = 1; i < tail.length; i++) {
      if (tail[i - 1].close > 0 && tail[i].close > 0) rets.push(Math.log(tail[i].close / tail[i - 1].close));
    }
    let vol = null;
    if (rets.length >= 20) {
      const m = rets.reduce((a, b) => a + b, 0) / rets.length;
      const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length;
      vol = Math.sqrt(v);
    }

    // 20일 거래대금
    const liqTail = arr.slice(-20);
    const turnover = liqTail.reduce((a, b) => a + b.volume * b.close, 0) / liqTail.length;

    // 다음 달 가격
    const dateIdx = new Date(date);
    const nextMonth = new Date(dateIdx);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const nextMonthStr = nextMonth.toISOString().slice(0, 10);
    const next = arr.find((p) => String(p.date).slice(0, 10) > date && String(p.date).slice(0, 10) <= nextMonthStr);
    const nextClose = next ? next.close : null;

    // fundamentals (최신)
    const fund = await all(`SELECT per, pbr, roe, debt_ratio, revenue, net_profit FROM fundamentals WHERE code = ? AND period <= ? ORDER BY period DESC LIMIT 1`, [code, date]);
    const prevFund = await all(`SELECT revenue, net_profit FROM fundamentals WHERE code = ? AND period <= ? ORDER BY period DESC LIMIT 1 OFFSET 4`, [code, date]);

    let growth = null;
    if (fund[0] && prevFund[0] && fund[0].revenue && prevFund[0].revenue) {
      growth = (Number(fund[0].revenue) - Number(prevFund[0].revenue)) / Number(prevFund[0].revenue);
    }

    stocks.push({
      code,
      last_close: last.close,
      next_close: nextClose,
      per: fund[0]?.per && fund[0].per > 0 && fund[0].per < 100 ? Number(fund[0].per) : null,
      pbr: fund[0]?.pbr && fund[0].pbr > 0 && fund[0].pbr < 20 ? Number(fund[0].pbr) : null,
      roe: fund[0]?.roe !== null && fund[0]?.roe !== undefined ? Number(fund[0].roe) : null,
      debt_ratio: fund[0]?.debt_ratio && fund[0].debt_ratio > 0 ? Number(fund[0].debt_ratio) : null,
      growth_raw: growth,
      momentum_raw: momentum,
      vol_raw: vol,
      liquidity_raw: turnover > 0 ? turnover : null,
    });
  }
  if (stocks.length === 0) return { date, stocks: [] };

  // 백분위 계산
  const pct = (key, higherIsBetter) => {
    const valid = stocks.filter((s) => s[key] !== null);
    if (valid.length === 0) return new Map();
    const sorted = [...valid].sort((a, b) => higherIsBetter ? b[key] - a[key] : a[key] - b[key]);
    const m = new Map();
    sorted.forEach((v, i) => m.set(v.code, ((sorted.length - i) / sorted.length) * 99));
    return m;
  };
  const valuePct = pct('per', false);
  const valuePctB = pct('pbr', false);
  const momPct = pct('momentum_raw', true);
  const roePct = pct('roe', true);
  const debtPct = pct('debt_ratio', false);
  const volPct = pct('vol_raw', false);
  const growthPct = pct('growth_raw', true);
  const liqPct = pct('liquidity_raw', true);

  for (const s of stocks) {
    const v1 = valuePct.get(s.code) || 50;
    const v2 = valuePctB.get(s.code) || 50;
    s.value_score = (v1 + v2) / 2;
    s.momentum_score = momPct.get(s.code) || 50;
    s.quality_score = (roePct.get(s.code) || 50 + (100 - (debtPct.get(s.code) || 50))) / 2;
    s.volatility_score = volPct.get(s.code) || 50;
    s.growth_score = growthPct.get(s.code) || 50;
    s.liquidity_score = liqPct.get(s.code) || 50;
    s.supply_score = 50;
  }
  return { date, stocks: stocks.filter((s) => s.next_close !== null) };
}

module.exports = { backtest, backtestFromDailyPrices };
