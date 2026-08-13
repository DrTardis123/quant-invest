'use strict';

// 가중치 최적화 백테스트 (단순화)
// - KOSPI200 + ETF ~50개 한정
// - 24개월 매월 시뮬레이션
// - 12개 가중치 × TOP 20 → Sharpe / Total / MDD 비교

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const db = require('../src/db/connection');
const { getIndexHistory } = require('../src/data/indices');
const fs = require('fs');

const TOP_N = 20;

// 12개 가중치 조합
const WEIGHTS_GRID = [
  { name: '균등(7팩터)',     weights: { value: 14, momentum: 14, quality: 14, volatility: 14, growth: 14, liquidity: 15, supply: 15 } },
  { name: '현재(balanced)',  weights: { value: 8,  momentum: 22, quality: 27, volatility: 8,  growth: 20, liquidity: 8,  supply: 7  } },
  { name: 'AQR-Sharpe',      weights: { value: 11, momentum: 32, quality: 23, volatility: 23, growth: 11 } },
  { name: '모멘텀강조',       weights: { value: 5,  momentum: 40, quality: 20, volatility: 5,  growth: 15, liquidity: 8,  supply: 7  } },
  { name: '퀄리티강조',       weights: { value: 10, momentum: 15, quality: 40, volatility: 10, growth: 15, liquidity: 5,  supply: 5  } },
  { name: '삼성증권식',       weights: { value: 6,  momentum: 8,  quality: 27, volatility: 0,  growth: 47, liquidity: 6,  supply: 6  } },
  { name: '재무중시(안정)',   weights: { value: 5,  momentum: 15, quality: 35, volatility: 15, growth: 20, liquidity: 5,  supply: 5  } },
  { name: '균형+수급',        weights: { value: 10, momentum: 20, quality: 20, volatility: 10, growth: 20, liquidity: 10, supply: 10 } },
  { name: '가치+퀄리티',      weights: { value: 25, momentum: 5,  quality: 35, volatility: 10, growth: 15, liquidity: 5,  supply: 5  } },
  { name: '성장+모멘텀',      weights: { value: 5,  momentum: 25, quality: 20, volatility: 5,  growth: 30, liquidity: 8,  supply: 7  } },
  { name: '방어형',          weights: { value: 15, momentum: 5,  quality: 35, volatility: 25, growth: 15, liquidity: 5,  supply: 0  } },
  { name: 'Sharpe-균형',      weights: { value: 10, momentum: 25, quality: 25, volatility: 15, growth: 15, liquidity: 5,  supply: 5  } },
];

(async () => {
  console.log('[optimizer] 가중치 최적화 백테스트');
  const t0 = Date.now();

  // 1) 매월 시점의 일봉 + 재무 로드
  const monthly = await loadMonthlySnapshots();
  if (monthly.length < 6) {
    console.error('[optimizer] 데이터 부족 (', monthly.length, '월)');
    process.exit(1);
  }
  console.log(`  → ${monthly.length}개월 시점 (${monthly[0].date} ~ ${monthly[monthly.length - 1].date})`);

  // 2) KOSPI 월별 수익률
  const kospiRet = await getKospiMonthlyReturns(monthly.map((m) => m.date));
  const kospiTotal = kospiRet.reduce((a, b) => a * (1 + b), 1) - 1;
  const kospiMonths = kospiRet.length;
  const kospiCAGR = kospiMonths >= 1 ? Math.pow(1 + kospiTotal, 12 / kospiMonths) - 1 : 0;
  console.log(`  → KOSPI: ${(kospiTotal * 100).toFixed(1)}% (CAGR ${(kospiCAGR * 100).toFixed(1)}%, ${kospiMonths}월)`);

  // 3) 가중치별 시뮬레이션
  console.log('\n  가중치명          | Total   | CAGR    | Sharpe  | MDD     | Win%   | vs KOSPI');
  console.log('  ------------------|---------|---------|---------|---------|--------|----------');

  const results = [];
  for (const grid of WEIGHTS_GRID) {
    const r = runBacktest(monthly, grid.weights, kospiRet);
    results.push({ ...grid, ...r });
    const sign = r.alpha >= 0 ? '+' : '';
    console.log(
      `  ${grid.name.padEnd(18)} | ${(r.total * 100).toFixed(1).padStart(6)}% | ${(r.cagr * 100).toFixed(1).padStart(6)}% | ${r.sharpe.toFixed(2).padStart(6)} | ${(r.mdd * 100).toFixed(1).padStart(6)}% | ${(r.winRate * 100).toFixed(0).padStart(5)}% | ${sign}${(r.alpha * 100).toFixed(1).padStart(5)}%`,
    );
  }

  // 4) 최적 가중치 추천
  const best = pickBest(results);
  console.log(`\n[optimizer] 🏆 최적 가중치: ${best.name}`);
  console.log('  weights:', JSON.stringify(best.weights));

  // 5) 결과 저장
  fs.writeFileSync(
    path.join(ROOT, 'public', 'data', 'backtest-optimizer.json'),
    JSON.stringify({
      asOf: new Date().toISOString(),
      period: `${monthly[0].date} ~ ${monthly[monthly.length - 1].date}`,
      kospi: { total: kospiTotal, cagr: kospiCAGR, months: kospiMonths },
      results,
      best,
    }, null, 2),
  );
  console.log(`\n[optimizer] 완료. ${(Date.now() - t0) / 1000}s`);
  await db.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

// ====================
// 시점 스냅샷 로드
// ====================

async function loadMonthlySnapshots() {
  // 매월 마지막 거래일 목록
  const dates = await db.all(`
    SELECT strftime(date, '%Y-%m') AS ym, MAX(date) AS last_date
    FROM daily_prices
    GROUP BY ym
    ORDER BY ym
  `);
  const monthEnds = dates.map((d) => String(d.last_date).slice(0, 10));

  // KOSPI200 + ETF만 추출 (시가총액 상위)
  // ETF는 별도 표시 (sector = 'ETF' or name LIKE 'KODEX%' etc)
  const universe = await db.all(`
    SELECT code, name, market
    FROM stocks
    WHERE market IN ('KOSPI', 'KOSDAQ')
      AND (
        code IN (SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) > 200)
        OR name LIKE '%KODEX%' OR name LIKE '%TIGER%' OR name LIKE '%ARIRANG%' OR name LIKE '%KBSTAR%'
      )
  `);

  // 모든 일봉 + 재무를 메모리로
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

  // 코드별 그룹
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

  // 매월 시점별 팩터 점수
  const snapshots = [];
  for (const date of monthEnds) {
    const snap = calcSnapshot(date, pricesByCode, fundByCode);
    if (snap.stocks.length > 0) snapshots.push(snap);
  }
  return snapshots;
}

function calcSnapshot(date, pricesByCode, fundByCode) {
  // date 시점까지의 데이터로 팩터 계산
  const allCodes = new Set([...pricesByCode.keys()]);
  const stocks = [];

  for (const code of allCodes) {
    const arr = (pricesByCode.get(code) || []).filter((p) => p.date <= date);
    if (arr.length < 30) continue;  // 최소 30일 데이터

    const last = arr[arr.length - 1];
    const yearIdx = Math.max(0, arr.length - 252);
    const monthIdx = Math.max(0, arr.length - 21);
    const yearOld = arr[yearIdx].close;
    const monthOld = arr[monthIdx].close;

    // 모멘텀 (12-1)
    const ret12 = yearOld > 0 ? (last.close - yearOld) / yearOld : null;
    const ret1 = monthOld > 0 ? (last.close - monthOld) / monthOld : null;
    const momentum = (ret12 !== null && ret1 !== null) ? ret12 - ret1 : null;

    // 저변동성 (60일 표준편차)
    const tail = arr.slice(-60);
    const rets = [];
    for (let i = 1; i < tail.length; i++) {
      if (tail[i - 1].close > 0 && tail[i].close > 0) {
        rets.push(Math.log(tail[i].close / tail[i - 1].close));
      }
    }
    let vol = null;
    if (rets.length >= 20) {
      const m = rets.reduce((a, b) => a + b, 0) / rets.length;
      const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length;
      vol = Math.sqrt(v);
    }

    // 유동성 (20일 평균 거래대금)
    const liqTail = arr.slice(-20);
    const turnover = liqTail.reduce((a, b) => a + b.volume * b.close, 0) / liqTail.length;

    // 재무 (최신)
    const fundArr = (fundByCode.get(code) || []).filter((f) => f.period <= date);
    const fund = fundArr[0] || null;
    const prevFund = fundArr[4] || null;  // 4분기 전

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

  // 다음 달 가격 (수익률 계산용)
  const dateIdx = new Date(date);
  const nextMonth = new Date(dateIdx);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStr = nextMonth.toISOString().slice(0, 10);

  for (const s of stocks) {
    const arr = pricesByCode.get(s.code) || [];
    const next = arr.find((p) => p.date > date && p.date <= nextMonthStr);
    s.next_close = next ? next.close : null;
  }

  // 5팩터 점수 (percentile)
  const pct = (key, higherIsBetter, min, max) => {
    const valid = stocks.filter((s) => s[key] !== null && s[key] >= (min || -Infinity) && s[key] <= (max || Infinity));
    if (valid.length === 0) return new Map();
    const sorted = [...valid].sort((a, b) => higherIsBetter ? b[key] - a[key] : a[key] - b[key]);
    const m = new Map();
    sorted.forEach((v, i) => m.set(v.code, ((sorted.length - i) / sorted.length) * 100));
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
    s.supply_score = 50;  // 생략
  }

  return { date, stocks: stocks.filter((s) => s.next_close !== null) };
}

// ====================
// KOSPI 벤치마크
// ====================

async function getKospiMonthlyReturns(monthEnds) {
  try {
    const arr = await getIndexHistory('KOSPI', { days: 800 });
    if (!arr || arr.length === 0) return monthEnds.map(() => 0);
    const kospiByDate = new Map(arr.map((k) => [String(k.date).slice(0, 10), k.close]));
    const ret = [];
    for (let i = 1; i < monthEnds.length; i++) {
      const prev = monthEnds[i - 1];
      const curr = monthEnds[i];
      const p1 = kospiByDate.get(prev);
      const p2 = kospiByDate.get(curr);
      if (p1 && p2) ret.push((p2 - p1) / p1);
      else ret.push(0);
    }
    return ret;
  } catch (e) {
    console.error('[optimizer] KOSPI fetch 실패:', e.message);
    return monthEnds.map(() => 0);
  }
}

// ====================
// 백테스트
// ====================

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
    const lastByCode = new Map(snap.stocks.map((s) => [s.code, s.last_close]));

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

  if (stratRet.length === 0) return { total: 0, cagr: 0, sharpe: 0, mdd: 0, winRate: 0, alpha: 0, months: 0 };

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

  return { total, cagr, sharpe, mdd, winRate, alpha, months };
}

function pickBest(results) {
  const scored = results.map((r) => {
    const normSharpe = Math.max(0, Math.min(2, r.sharpe)) / 2;
    const normTotal = Math.max(-0.5, Math.min(2, r.total)) / 1.5 + 0.33;
    const normWin = r.winRate;
    return { ...r, composite: normSharpe * 0.5 + normTotal * 0.3 + normWin * 0.2 };
  });
  scored.sort((a, b) => b.composite - a.composite);
  return scored[0];
}
