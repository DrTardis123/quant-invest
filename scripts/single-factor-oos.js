'use strict';
// 단일 팩터 OOS 시뮬레이션: 어떤 팩터가 가장 효과적인지 확인
// 7팩터 각각 단일로 사용한 12개월 시뮬 + 7팩터 균등/가중 평균

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const fs = require('fs');

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

async function simulateSingle(factorKey, monthlyScores, monthlyReturns, kospiReturns, topN = 20) {
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
        return { code: s.code, score: s.scores[factorKey] || 50, ret: r };
      })
      .filter((x) => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
    if (scored.length === 0) continue;
    const strat = scored.reduce((a, b) => a + b.ret, 0) / scored.length;
    monthlyRet.push({ date: next.date, strat, kospi: kospiRet });
  }
  if (monthlyRet.length < 6) return null;
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
  return { sharpe, total, kospiTotal, alpha, ir, mdd, nMonths: monthlyRet.length, mean, std };
}

// 2팩터 조합 시뮬
async function simulateDual(factorA, factorB, weightA, monthlyScores, monthlyReturns, kospiReturns, topN = 20) {
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
        return { code: s.code, score: (s.scores[factorA] || 50) * weightA + (s.scores[factorB] || 50) * (1 - weightA), ret: r };
      })
      .filter((x) => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
    if (scored.length === 0) continue;
    const strat = scored.reduce((a, b) => a + b.ret, 0) / scored.length;
    monthlyRet.push({ date: next.date, strat, kospi: kospiRet });
  }
  if (monthlyRet.length < 1) return null;
  const total = monthlyRet.reduce((a, m) => (1 + a) * (1 + m.strat) - 1, 0);
  const kospiTotal = monthlyRet.reduce((a, m) => (1 + a) * (1 + m.kospi) - 1, 0);
  const mean = monthlyRet.reduce((a, m) => a + m.strat, 0) / monthlyRet.length;
  const std = monthlyRet.length >= 2 ? Math.sqrt(monthlyRet.reduce((a, m) => a + (m.strat - mean) ** 2, 0) / monthlyRet.length) : 0;
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(12) : 0;
  const alpha = monthlyRet.reduce((a, m) => a + (m.strat - m.kospi), 0) / monthlyRet.length;
  let nav = 1, peak = 1, mdd = 0;
  for (const m of monthlyRet) { nav *= 1 + m.strat; if (nav > peak) peak = nav; const dd = (nav - peak) / peak; if (dd < mdd) mdd = dd; }
  return { sharpe, total, kospiTotal, alpha, mdd };
}

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
  return { monthlyScores, kospiReturns, monthlyReturns };
}

async function main() {
  const { monthlyScores, kospiReturns, monthlyReturns } = await loadData();
  const monthlyRetArr = [];
  for (let i = 0; i < monthlyScores.length; i++) {
    const ym = monthlyScores[i].ym;
    const nextY = ym.slice(0, 4);
    const nextM = String(Number(ym.slice(5, 7)) + 1).padStart(2, '0');
    const nextYm = nextM === '13' ? `${Number(nextY) + 1}-01` : `${nextY}-${nextM}`;
    const ret = monthlyReturns.get(nextYm);
    if (ret) monthlyRetArr.push(ret);
  }
  console.log(`[single] monthlyScores: ${monthlyScores.length}개월`);

  // 1) 단일 팩터
  const factors = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];
  console.log(`\n[single] === 단일 팩터 시뮬 (12개월) ===`);
  const single = [];
  for (const f of factors) {
    const r = await simulateSingle(f, monthlyScores, monthlyRetArr, kospiReturns);
    if (r) {
      single.push({ factor: f, ...r });
      console.log(`  [${f.padEnd(10)}] Sharpe=${round2(r.sharpe)} Total=${round2(r.total * 100)}% Alpha=${round2(r.alpha * 100)}%/월 MDD=${round2(r.mdd * 100)}% KOSPI=${round2(r.kospiTotal * 100)}%`);
    }
  }
  single.sort((a, b) => b.sharpe - a.sharpe);
  console.log(`\n[single] ★ 최고 단일 팩터: ${single[0].factor} (Sharpe ${round2(single[0].sharpe)})`);

  // 2) 2팩터 조합 (상위 5개)
  console.log(`\n[single] === 2팩터 조합 (50:50, 70:30) ===`);
  const dual = [];
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      for (const wA of [0.5, 0.7]) {
        const r = await simulateDual(factors[i], factors[j], wA, monthlyScores, monthlyRetArr, kospiReturns);
        if (r) dual.push({ a: factors[i], b: factors[j], wA, ...r });
      }
    }
  }
  dual.sort((a, b) => b.sharpe - a.sharpe);
  console.log(`[single] 상위 10개:`);
  for (let i = 0; i < Math.min(10, dual.length); i++) {
    const x = dual[i];
    console.log(`  #${i + 1}: ${x.a}*${x.wA} + ${x.b}*${(1 - x.wA).toFixed(1)} → Sharpe=${round2(x.sharpe)} Total=${round2(x.total * 100)}% Alpha=${round2(x.alpha * 100)}%/월 MDD=${round2(x.mdd * 100)}%`);
  }

  // 3) OOS 검증 (best 5개 2팩터)
  console.log(`\n[single] === OOS 검증 (3개월 test) ===`);
  const oosResults = [];
  const splitIdx = monthlyScores.length - 3;
  const trainScores = monthlyScores.slice(0, splitIdx);
  const trainRetArr = monthlyRetArr.slice(0, splitIdx - 1);
  const testScores = monthlyScores.slice(splitIdx - 1);
  const testRetArr = monthlyRetArr.slice(splitIdx - 1);
  const testKospi = kospiReturns.slice(kospiReturns.length - 3);
  for (let i = 0; i < Math.min(10, dual.length); i++) {
    const x = dual[i];
    const trainR = await simulateDual(x.a, x.b, x.wA, trainScores, trainRetArr, kospiReturns);
    const testR = await simulateDual(x.a, x.b, x.wA, testScores, testRetArr, testKospi);
    if (trainR && testR) {
      oosResults.push({ a: x.a, b: x.b, wA: x.wA, train: trainR, test: testR });
      console.log(`  [${x.a}*${x.wA}+${x.b}*${(1 - x.wA).toFixed(1)}] train Sharpe=${round2(trainR.sharpe)} Total=${round2(trainR.total * 100)}% → test Sharpe=${round2(testR.sharpe)} Total=${round2(testR.total * 100)}% KOSPI=${round2(testR.kospiTotal * 100)}%`);
    }
  }

  // best OOS
  const validOos = oosResults.filter((r) => r.test.sharpe > -100);
  if (validOos.length > 0) {
    validOos.sort((a, b) => b.test.sharpe - a.test.sharpe);
    const best = validOos[0];
    console.log(`\n[single] ★ OOS 최고 2팩터: ${best.a}*${best.wA}+${best.b}*${(1 - best.wA).toFixed(1)} (test Sharpe ${round2(best.test.sharpe)})`);
  }

  // 저장
  const out = {
    asOf: new Date().toISOString(),
    period: `${monthlyScores[0]?.ym} ~ ${monthlyScores[monthlyScores.length - 1]?.ym}`,
    nMonths: monthlyScores.length,
    single: single.map((s) => ({ factor: s.factor, sharpe: round4(s.sharpe), total: round4(s.total), alpha: round4(s.alpha), mdd: round4(s.mdd) })),
    dual: dual.slice(0, 30).map((d) => ({ a: d.a, b: d.b, wA: d.wA, sharpe: round4(d.sharpe), total: round4(d.total), alpha: round4(d.alpha), mdd: round4(d.mdd) })),
    oosBest: validOos.length > 0 ? { a: validOos[0].a, b: validOos[0].b, wA: validOos[0].wA, testSharpe: round4(validOos[0].test.sharpe), testTotal: round4(validOos[0].test.total) } : null,
  };
  fs.writeFileSync(path.join(ROOT, 'public', 'data', 'single-factor.json'), JSON.stringify(out, null, 2));
  console.log(`[single] single-factor.json 저장`);
}

main().catch((e) => { console.error(e); process.exit(1); });
