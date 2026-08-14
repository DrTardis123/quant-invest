'use strict';
// Out-of-Sample 회귀분석 (과최적화 방지)
// 1) 학습 12개월 / 검증 최근 1~3개월 (rolling)
// 2) Best 가중치의 OOS Sharpe, IR, Total 계산
// 3) CSV 캐시 사용 (DuckDB lock 회피)

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const fs = require('fs');

function round4(v) { return Math.round(v * 10000) / 10000; }
function round2(v) { return Math.round(v * 100) / 100; }

// 시뮬 (regression-optimizer와 동일 로직, 단일 가중치)
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
  if (monthlyRet.length < 3) return { sharpe: -999, total: 0, alpha: -999, ir: -999, mdd: 0, nMonths: 0, meanMonthly: 0, stdMonthly: 0, kospiTotal: 0 };
  const total = monthlyRet.reduce((a, m) => (1 + a) * (1 + m.strat) - 1, 0);
  const kospiTotal = monthlyRet.reduce((a, m) => (1 + a) * (1 + m.kospi) - 1, 0);
  const mean = monthlyRet.reduce((a, m) => a + m.strat, 0) / monthlyRet.length;
  const std = Math.sqrt(monthlyRet.reduce((a, m) => a + (m.strat - mean) ** 2, 0) / monthlyRet.length);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(12) : 0;
  const alpha = monthlyRet.reduce((a, m) => a + (m.strat - m.kospi), 0) / monthlyRet.length;
  const te = Math.sqrt(monthlyRet.reduce((a, m) => a + (m.strat - m.kospi - alpha) ** 2, 0) / monthlyRet.length);
  const ir = te > 0 ? (alpha / te) * Math.sqrt(12) : 0;
  let nav = 1, peak = 1, mdd = 0;
  for (const m of monthlyRet) {
    nav *= 1 + m.strat;
    if (nav > peak) peak = nav;
    const dd = (nav - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return { sharpe, total, kospiTotal, alpha, ir, mdd, nMonths: monthlyRet.length, meanMonthly: mean, stdMonthly: std };
}

async function loadData() {
  const csvDir = path.join(ROOT, 'public', 'data', 'csv-cache');
  // 가장 최근 CSV 자동 탐색
  const files = fs.readdirSync(csvDir).filter((f) => f.startsWith('prices-') && f.endsWith('.csv')).sort().reverse();
  if (files.length === 0) throw new Error('CSV 없음');
  const csvFile = path.join(csvDir, files[0]);
  const kospiFile = path.join(csvDir, files[0].replace('prices-', 'kospi-'));
  if (!fs.existsSync(kospiFile)) throw new Error(`KOSPI CSV 없음: ${kospiFile}`);

  console.log(`[oos] CSV: ${csvFile}`);
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
  console.log(`[oos] prices=${prices.length}행, kospi=${kospiHistory.length}행`);

  // 월말 시점 + 수익률
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
  const kospiMonthly = new Map();
  for (const k of kospiHistory) {
    const ym = String(k.date).slice(0, 7);
    if (!kospiMonthly.has(ym)) kospiMonthly.set(ym, { date: String(k.date), close: Number(k.close) });
    else if (String(kospiMonthly.get(ym).date) < String(k.date)) {
      kospiMonthly.get(ym).date = String(k.date);
      kospiMonthly.get(ym).close = Number(k.close);
    }
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
      for (const s of ms.stocks) {
        s.scores[k] = Math.max(1, Math.min(95, rankMap.get(s.scores[k]) || 50));
      }
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
  console.log(`[oos] monthlyScores: ${monthlyScores.length}개월`);

  if (monthlyScores.length < 10) {
    console.error('[oos] 데이터 부족 (10개월+ 필요)');
    process.exit(1);
  }

  // 5개 베이스라인 가중치 비교
  const strategies = {
    '균등(7팩터)': { value: 14.3, momentum: 14.3, quality: 14.3, volatility: 14.3, growth: 14.3, liquidity: 14.3, supply: 14.3 },
    '밸런스(균형)': { value: 10, momentum: 25, quality: 25, volatility: 15, growth: 15, liquidity: 5, supply: 5 },
    '가치': { value: 50, momentum: 10, quality: 15, volatility: 5, growth: 10, liquidity: 5, supply: 5 },
    '성장': { value: 5, momentum: 20, quality: 15, volatility: 10, growth: 40, liquidity: 5, supply: 5 },
    '모멘텀': { value: 5, momentum: 50, quality: 10, volatility: 5, growth: 15, liquidity: 10, supply: 5 },
    '방어': { value: 15, momentum: 5, quality: 25, volatility: 30, growth: 5, liquidity: 10, supply: 10 },
    '회귀-1차': { value: 0, momentum: 20.23, quality: 8.66, volatility: 22.19, growth: 14.06, liquidity: 20.42, supply: 14.44 },
  };

  // === Rolling OOS: 마지막 N개월을 test로 사용 ===
  const oosResults = [];
  for (let oosMonths = 1; oosMonths <= Math.min(3, monthlyScores.length - 6); oosMonths++) {
    const splitIdx = monthlyScores.length - oosMonths;
    const trainScores = monthlyScores.slice(0, splitIdx);
    const trainRetArr = monthlyRetArr.slice(0, splitIdx - 1);
    // Test: monthlyScores[splitIdx-1] → monthlyRetArr[splitIdx-1] (다음달 ret)
    //       monthlyScores[splitIdx] → monthlyRetArr[splitIdx] (그 다음달 ret)
    // 즉 testScores는 [splitIdx-1, splitIdx, ...]로 하고, testRetArr는 같은 인덱스
    const testScores = monthlyScores.slice(splitIdx - 1);
    const testRetArr = monthlyRetArr.slice(splitIdx - 1);
    const testKospi = kospiReturns.slice(kospiReturns.length - oosMonths);

    console.log(`\n[oos] === Test 최근 ${oosMonths}개월 (split @ idx ${splitIdx}) ===`);
    console.log(`  train: ${trainScores[0]?.ym} ~ ${trainScores[trainScores.length - 1]?.ym}`);
    console.log(`  test:  ${testScores[testScores.length - 1]?.ym}`);

    for (const [name, w] of Object.entries(strategies)) {
      const trainSim = await simulate(w, trainScores, trainRetArr, kospiReturns);
      const testSim = await simulate(w, testScores, testRetArr, testKospi);
      console.log(`  [${name}] train Sharpe=${round2(trainSim.sharpe)} Total=${round2(trainSim.total * 100)}% → test Sharpe=${round2(testSim.sharpe)} Total=${round2(testSim.total * 100)}% KOSPI=${round2(testSim.kospiTotal * 100)}%`);
      oosResults.push({
        oosMonths,
        name,
        weights: w,
        train: { sharpe: round4(trainSim.sharpe), total: round4(trainSim.total), alpha: round4(trainSim.alpha) },
        test: { sharpe: round4(testSim.sharpe), total: round4(testSim.total), alpha: round4(testSim.alpha), mdd: round4(testSim.mdd) },
      });
    }
  }

  // === 평균 OOS ===
  const byStrategy = new Map();
  for (const r of oosResults) {
    if (!byStrategy.has(r.name)) byStrategy.set(r.name, []);
    byStrategy.get(r.name).push(r);
  }
  console.log(`\n[oos] ═══ 평균 OOS (1+2+3개월) ═══`);
  const summary = [];
  for (const [name, arr] of byStrategy) {
    const avgTestSharpe = arr.reduce((a, b) => a + b.test.sharpe, 0) / arr.length;
    const avgTestTotal = arr.reduce((a, b) => a + b.test.total, 0) / arr.length;
    const avgTestAlpha = arr.reduce((a, b) => a + b.test.alpha, 0) / arr.length;
    console.log(`  [${name}] avgTest Sharpe=${round2(avgTestSharpe)} Total=${round2(avgTestTotal * 100)}% Alpha=${round2(avgTestAlpha * 100)}%/월`);
    summary.push({ name, weights: arr[0].weights, avgTestSharpe, avgTestTotal, avgTestAlpha });
  }
  summary.sort((a, b) => b.avgTestSharpe - a.avgTestSharpe);
  const oosBest = summary[0];
  console.log(`\n[oos] ★ OOS 최고: ${oosBest.name}`);
  console.log(`  Sharpe=${round2(oosBest.avgTestSharpe)} Total=${round2(oosBest.avgTestTotal * 100)}% Alpha=${round2(oosBest.avgTestAlpha * 100)}%/월`);

  // 저장
  const out = {
    asOf: new Date().toISOString(),
    period: `${monthlyScores[0]?.ym} ~ ${monthlyScores[monthlyScores.length - 1]?.ym}`,
    nMonths: monthlyScores.length,
    oosResults,
    summary: summary.map((s) => ({
      name: s.name,
      weights: s.weights,
      avgTestSharpe: round4(s.avgTestSharpe),
      avgTestTotal: round4(s.avgTestTotal),
      avgTestAlpha: round4(s.avgTestAlpha),
    })),
    oosBest: { name: oosBest.name, weights: oosBest.weights, ...oosBest },
  };
  fs.writeFileSync(path.join(ROOT, 'public', 'data', 'oos-regression.json'), JSON.stringify(out, null, 2));
  console.log(`[oos] oos-regression.json 저장`);
}

main().catch((e) => {
  console.error('[oos] fatal:', e.message);
  process.exit(1);
});
