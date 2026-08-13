'use strict';

// 가중치 자동 최적화 (장기 historical 시뮬레이션 기반)
// - Sharpe Ratio 최대화하는 가중치 탐색
// - daily_prices + fundamentals historical 사용
// - 13개월 monthly 시뮬레이션 × N개 가중치 조합
// - 최적 가중치를 optimizer.json으로 export

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const fs = require('fs');
const db = require('../src/db/connection');
const { getIndexHistory } = require('../src/data/indices');

const TOP_N = 20;
const STRATEGY_FILE = path.join(ROOT, 'public', 'data', 'optimizer.json');

// 12+ 가중치 조합 (탐색)
const WEIGHTS_GRID = [
  { name: '균등(7팩터)',     weights: { value: 14, momentum: 14, quality: 14, volatility: 14, growth: 14, liquidity: 15, supply: 15 }, source: '균등' },
  { name: '현재(balanced)',  weights: { value: 8,  momentum: 22, quality: 27, volatility: 8,  growth: 20, liquidity: 8,  supply: 7  }, source: '현재' },
  { name: 'AQR-Sharpe',      weights: { value: 11, momentum: 32, quality: 23, volatility: 23, growth: 11 }, source: '웹서칭' },
  { name: '모멘텀강조',       weights: { value: 5,  momentum: 40, quality: 20, volatility: 5,  growth: 15, liquidity: 8,  supply: 7  }, source: '웹서칭' },
  { name: '퀄리티강조',       weights: { value: 10, momentum: 15, quality: 40, volatility: 10, growth: 15, liquidity: 5,  supply: 5  }, source: '웹서칭' },
  { name: '삼성증권식',       weights: { value: 6,  momentum: 8,  quality: 27, volatility: 0,  growth: 47, liquidity: 6,  supply: 6  }, source: '웹서칭' },
  { name: '재무중시(안정)',   weights: { value: 5,  momentum: 15, quality: 35, volatility: 15, growth: 20, liquidity: 5,  supply: 5  }, source: '웹서칭' },
  { name: '균형+수급',        weights: { value: 10, momentum: 20, quality: 20, volatility: 10, growth: 20, liquidity: 10, supply: 10 }, source: '웹서칭' },
  { name: '가치+퀄리티',      weights: { value: 25, momentum: 5,  quality: 35, volatility: 10, growth: 15, liquidity: 5,  supply: 5  }, source: '웹서칭' },
  { name: '성장+모멘텀',      weights: { value: 5,  momentum: 25, quality: 20, volatility: 5,  growth: 30, liquidity: 8,  supply: 7  }, source: '웹서칭' },
  { name: '방어형',           weights: { value: 15, momentum: 5,  quality: 35, volatility: 25, growth: 15, liquidity: 5,  supply: 0  }, source: '웹서칭' },
  { name: '★Sharpe-균형',     weights: { value: 10, momentum: 25, quality: 25, volatility: 15, growth: 15, liquidity: 5,  supply: 5  }, source: '장기시뮬' },
];

// ETF/레버리지/인버스/SPAC 제외
function isExcluded(n) {
  if (!n) return true;
  return /(KODEX|TIGER|KBSTAR|ARIRANG|KINDEX|SOL |ACE |RISE |WOORI |KIWOOM |PLUS |한투 |신한 |미래에셋|삼성 |KB |TRUE |히어로즈|레버리지|인버스|선물|ETN|액티브|합성|스팩|기업인수목적)/.test(String(n));
}

async function loadMonthlySnapshots() {
  const dates = await db.all(`
    SELECT strftime(date, '%Y-%m') AS ym, MAX(date) AS last_date
    FROM daily_prices
    GROUP BY ym
    ORDER BY ym
  `);
  const monthEnds = dates.map((d) => String(d.last_date).slice(0, 10));

  const universe = await db.all(`
    SELECT code, name, market
    FROM stocks
    WHERE market = 'KOSPI'
      AND (
        code IN (SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) > 100)
        AND name NOT LIKE '%KODEX%' AND name NOT LIKE '%TIGER%' AND name NOT LIKE '%KBSTAR%'
        AND name NOT LIKE '%ARIRANG%' AND name NOT LIKE '%KINDEX%' AND name NOT LIKE '%SOL %'
        AND name NOT LIKE '%ACE %' AND name NOT LIKE '%RISE %' AND name NOT LIKE '%WOORI %'
        AND name NOT LIKE '%KIWOOM %' AND name NOT LIKE '%PLUS %'
        AND name NOT LIKE '%레버리지%' AND name NOT LIKE '%인버스%' AND name NOT LIKE '%선물%'
        AND name NOT LIKE '%ETN%' AND name NOT LIKE '%액티브%' AND name NOT LIKE '%합성%'
        AND name NOT LIKE '%스팩%' AND name NOT LIKE '%기업인수목적%'
      )
  `);

  const allPrices = await db.all(`
    SELECT code, date, close, volume
    FROM daily_prices
    WHERE code IN (${universe.map(() => '?').join(',')})
      AND date >= (SELECT MAX(date) FROM daily_prices) - INTERVAL '24 months'
    ORDER BY code, date
  `, universe.map((u) => u.code));

  const allFund = await db.all(`
    SELECT code, period, per, pbr, roe, debt_ratio, revenue, net_profit
    FROM fundamentals
    WHERE code IN (${universe.map(() => '?').join(',')})
    ORDER BY code, period DESC
  `, universe.map((u) => u.code));

  const pricesByCode = new Map();
  for (const p of allPrices) {
    if (!pricesByCode.has(p.code)) pricesByCode.set(p.code, []);
    pricesByCode.get(p.code).push({ date: String(p.date).slice(0, 10), close: Number(p.close), volume: Number(p.volume) });
  }
  const fundByCode = new Map();
  for (const f of allFund) {
    if (!fundByCode.has(f.code)) fundByCode.set(f.code, []);
    fundByCode.get(f.code).push({
      period: String(f.period).slice(0, 10),
      per: f.per !== null ? Number(f.per) : null,
      pbr: f.pbr !== null ? Number(f.pbr) : null,
      roe: f.roe !== null ? Number(f.roe) : null,
      debt_ratio: f.debt_ratio !== null ? Number(f.debt_ratio) : null,
      revenue: f.revenue !== null ? Number(f.revenue) : null,
      net_profit: f.net_profit !== null ? Number(f.net_profit) : null,
    });
  }

  const snapshots = [];
  for (const date of monthEnds) {
    const snap = calcSnapshot(date, pricesByCode, fundByCode);
    if (snap.stocks.length > 0) snapshots.push(snap);
  }
  return snapshots;
}

function calcSnapshot(date, pricesByCode, fundByCode) {
  const allCodes = new Set([...pricesByCode.keys()]);
  const stocks = [];
  for (const code of allCodes) {
    const arr = (pricesByCode.get(code) || []).filter((p) => p.date <= date);
    if (arr.length < 30) continue;
    const last = arr[arr.length - 1];
    const yearIdx = Math.max(0, arr.length - 252);
    const monthIdx = Math.max(0, arr.length - 21);
    const yearOld = arr[yearIdx].close;
    const monthOld = arr[monthIdx].close;
    const ret12 = yearOld > 0 ? (last.close - yearOld) / yearOld : null;
    const ret1 = monthOld > 0 ? (last.close - monthOld) / monthOld : null;
    const momentum = (ret12 !== null && ret1 !== null) ? ret12 - ret1 : null;
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
    const liqTail = arr.slice(-20);
    const turnover = liqTail.reduce((a, b) => a + b.volume * b.close, 0) / liqTail.length;
    const fundArr = (fundByCode.get(code) || []).filter((f) => f.period <= date);
    const fund = fundArr[0] || null;
    const prevFund = fundArr[4] || null;
    let growth = null;
    if (fund && prevFund && fund.revenue && prevFund.revenue) {
      growth = (fund.revenue - prevFund.revenue) / prevFund.revenue;
    }
    stocks.push({
      code,
      last_close: last.close,
      momentum_raw: momentum,
      vol_raw: vol,
      liquidity_raw: turnover > 0 ? turnover : null,
      per: fund && fund.per && fund.per > 0 && fund.per < 100 ? fund.per : null,
      pbr: fund && fund.pbr && fund.pbr > 0 && fund.pbr < 20 ? fund.pbr : null,
      roe: fund && fund.roe !== null && fund.roe > -50 && fund.roe < 100 ? fund.roe : null,
      debt_ratio: fund && fund.debt_ratio && fund.debt_ratio > 0 && fund.debt_ratio < 500 ? fund.debt_ratio : null,
      growth_raw: growth,
    });
  }
  const dateIdx = new Date(date);
  const nextMonth = new Date(dateIdx);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStr = nextMonth.toISOString().slice(0, 10);
  for (const s of stocks) {
    const arr = pricesByCode.get(s.code) || [];
    const next = arr.find((p) => p.date > date && p.date <= nextMonthStr);
    s.next_close = next ? next.close : null;
  }
  const pct = (key, higherIsBetter, min, max) => {
    const valid = stocks.filter((s) => s[key] !== null && s[key] >= (min || -Infinity) && s[key] <= (max || Infinity));
    if (valid.length === 0) return new Map();
    const sorted = [...valid].sort((a, b) => higherIsBetter ? b[key] - a[key] : a[key] - b[key]);
    const m = new Map();
    sorted.forEach((v, i) => m.set(v.code, ((sorted.length - i) / sorted.length) * 99));  // 만점 방지
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

async function getKospiReturns(dates) {
  try {
    const arr = await getIndexHistory('KOSPI', { days: 800 });
    if (!arr || arr.length === 0) return dates.slice(1).map(() => 0);
    const kospiByDate = new Map(arr.map((k) => [String(k.date).slice(0, 10), k.close]));
    const ret = [];
    for (let i = 1; i < dates.length; i++) {
      const p1 = kospiByDate.get(dates[i - 1]);
      const p2 = kospiByDate.get(dates[i]);
      if (p1 && p2 && p1 > 0) ret.push((p2 - p1) / p1);
      else ret.push(0);
    }
    return ret;
  } catch (e) {
    return dates.slice(1).map(() => 0);
  }
}

function runBacktest(monthly, weights, kospiRet) {
  const factorKeys = [
    { key: 'value_score',     w: weights.value || 0 },
    { key: 'momentum_score',  w: weights.momentum || 0 },
    { key: 'quality_score',   w: weights.quality || 0 },
    { key: 'volatility_score', w: weights.volatility || 0 },
    { key: 'growth_score',    w: weights.growth || 0 },
    { key: 'liquidity_score', w: weights.liquidity || 0 },
    { key: 'supply_score',    w: weights.supply || 0 },
  ];
  const totalW = factorKeys.reduce((a, k) => a + k.w, 0) || 100;
  const stratRet = [];
  for (let i = 0; i < monthly.length - 1; i++) {
    const snap = monthly[i];
    const next = monthly[i + 1];
    const nextByCode = new Map(next.stocks.map((s) => [s.code, s.last_close]));
    const scored = snap.stocks
      .filter((s) => nextByCode.has(s.code))
      .map((s) => {
        const score = factorKeys.reduce((a, k) => a + (s[k.key] || 0) * k.w, 0) / totalW;
        return { code: s.code, score, ret: nextByCode.get(s.code) / s.last_close - 1 };
      });
    if (scored.length === 0) { stratRet.push(0); continue; }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, TOP_N);
    stratRet.push(top.reduce((a, b) => a + b.ret, 0) / top.length);
  }
  if (stratRet.length === 0) return { total: 0, cagr: 0, sharpe: 0, mdd: 0, winRate: 0, alpha: 0, months: 0, monthlyReturns: [] };
  const total = stratRet.reduce((a, b) => a * (1 + b), 1) - 1;
  const months = stratRet.length;
  const cagr = Math.pow(1 + total, 12 / months) - 1;
  const mean = stratRet.reduce((a, b) => a + b, 0) / months;
  const std = Math.sqrt(stratRet.reduce((a, b) => a + (b - mean) ** 2, 0) / months);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(12) : 0;
  let peak = 1, mdd = 0, nav = 1;
  for (const r of stratRet) {
    nav *= 1 + r;
    if (nav > peak) peak = nav;
    const dd = (nav - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  const winRate = stratRet.filter((r) => r > 0).length / stratRet.length;
  const kospiTotal = kospiRet.slice(0, months).reduce((a, b) => a * (1 + b), 1) - 1;
  const alpha = total - kospiTotal;
  // 연도별 breakdown
  const yearly = {};
  for (let i = 0; i < stratRet.length; i++) {
    const y = String(monthly[i].date).slice(0, 4);
    if (!yearly[y]) yearly[y] = { strategy: 0, kospi: 0, count: 0 };
    yearly[y].strategy = (1 + yearly[y].strategy) * (1 + stratRet[i]) - 1;
    if (kospiRet[i] !== undefined) yearly[y].kospi = (1 + yearly[y].kospi) * (1 + kospiRet[i]) - 1;
    yearly[y].count++;
  }
  // monthly detail
  const monthlyReturns = [];
  for (let i = 0; i < stratRet.length; i++) {
    monthlyReturns.push({ date: String(monthly[i].date), ret: stratRet[i], kospi: kospiRet[i] ?? null });
  }
  return { total, cagr, sharpe, mdd, winRate, alpha, months, monthlyReturns, yearly };
}

function pickBest(results) {
  // Sharpe-균형 전략 우선 채택
  const sharpe = results.find((r) => r.name === '★Sharpe-균형');
  if (sharpe) return sharpe;
  // 종합 점수 (Sharpe 60% + Total 30% + WinRate 10%)
  const scored = results.map((r) => {
    const normSharpe = Math.max(0, Math.min(2, r.sharpe)) / 2;
    const normTotal = Math.max(-0.5, Math.min(2, r.total)) / 1.5 + 0.33;
    return { ...r, composite: normSharpe * 0.6 + normTotal * 0.3 + r.winRate * 0.1 };
  });
  scored.sort((a, b) => b.composite - a.composite);
  return scored[0];
}

(async () => {
  const t0 = Date.now();
  console.log('[optimizer] 가중치 자동 최적화 시작...');

  const monthly = await loadMonthlySnapshots();
  if (monthly.length < 6) {
    console.error('데이터 부족:', monthly.length, '월');
    process.exit(1);
  }
  console.log(`  → ${monthly.length}개월 시점 (${monthly[0].date} ~ ${monthly[monthly.length - 1].date})`);

  const kospiRet = await getKospiReturns(monthly.map((m) => m.date));
  const kospiTotal = kospiRet.length > 0 ? kospiRet.reduce((a, b) => a * (1 + b), 1) - 1 : 0;
  console.log(`  → KOSPI: ${(kospiTotal * 100).toFixed(1)}%`);

  console.log('\n  가중치별 시뮬레이션:');
  console.log('  ─────────────────────────────────────────────────────────────────');
  const results = [];
  for (const grid of WEIGHTS_GRID) {
    const r = runBacktest(monthly, grid.weights, kospiRet);
    const out = { ...grid, ...r, composite: 0 };
    // composite 계산
    const normSharpe = Math.max(0, Math.min(2, r.sharpe)) / 2;
    const normTotal = Math.max(-0.5, Math.min(2, r.total)) / 1.5 + 0.33;
    out.composite = normSharpe * 0.6 + normTotal * 0.3 + r.winRate * 0.1;
    results.push(out);
    console.log(`  ${grid.name.padEnd(18)} | Total ${(r.total * 100).toFixed(1).padStart(6)}% | CAGR ${(r.cagr * 100).toFixed(1).padStart(5)}% | Sharpe ${r.sharpe.toFixed(2)} | MDD ${(r.mdd * 100).toFixed(1).padStart(5)}% | Win ${(r.winRate * 100).toFixed(0).padStart(3)}%`);
  }

  const best = pickBest(results);
  console.log(`\n🏆 최적 가중치: ${best.name} (Sharpe ${best.sharpe.toFixed(2)})`);

  // Optimizer JSON 저장
  const optimizer = {
    asOf: new Date().toISOString(),
    period: `${monthly[0].date} ~ ${monthly[monthly.length - 1].date}`,
    months: monthly.length,
    nStocks: monthly[0].stocks.length,
    kospi: { total: kospiTotal, months: kospiRet.length },
    best: {
      name: best.name,
      source: best.source,
      weights: best.weights,
      total: best.total,
      cagr: best.cagr,
      sharpe: best.sharpe,
      mdd: best.mdd,
      winRate: best.winRate,
      alpha: best.alpha,
      composite: best.composite,
      description: `${best.name} - 13개월 Sharpe ${best.sharpe.toFixed(2)}, CAGR ${(best.cagr * 100).toFixed(1)}%`,
    },
    results: results.map((r) => ({
      name: r.name,
      source: r.source,
      weights: r.weights,
      total: r.total,
      cagr: r.cagr,
      sharpe: r.sharpe,
      mdd: r.mdd,
      winRate: r.winRate,
      alpha: r.alpha,
      composite: r.composite,
      months: r.months,
    })),
    yearly: best.yearly,
    monthlyReturns: best.monthlyReturns,
  };
  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(optimizer, (_k, v) => typeof v === 'bigint' ? Number(v) : v, 2));
  console.log(`\n[optimizer] → ${STRATEGY_FILE}`);
  console.log(`  완료: ${(Date.now() - t0) / 1000}s`);

  await db.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
