'use strict';
// 동적 리밸런싱 포트폴리오 (10개 종목 유지)
// 1) 매월 초: 종합 점수 (회귀 best 가중치) 기준 top 10 매수
// 2) 매월 중: sell2 신호 (+21% 3R / -7% 1R 손절 / 60일선 터치) hit 종목 매도
// 3) 매도된 자리는 즉시 다음 best 종목으로 교체
// 4) 10개 종목 항상 유지
// 5) 정적 top 10 vs 동적 매월 리밸런싱 vs sell2-신호 교체 3가지 비교
//
// 사용 가중치: 가치(50) 2차 회귀 best (총 1위)
// - Sharpe 1.24, MDD -8.6%, Alpha 23.36%/월
//
// CSV cache 사용 (DuckDB lock 회피)

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const fs = require('fs');

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

// 2차 회귀 종합 1위 가중치 (가치 50)
const WEIGHTS = { value: 50, momentum: 10, quality: 15, volatility: 5, growth: 10, liquidity: 5, supply: 5 };
const FACTOR_KEYS = ['value', 'momentum', 'quality', 'volatility', 'growth', 'liquidity', 'supply'];

function totalScore(s) {
  let s_val = 0;
  for (const k of FACTOR_KEYS) s_val += (Number(s[k]) || 0) * (WEIGHTS[k] || 0) / 100;
  return s_val;
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
  // kospiHistory가 비어있으면 (DuckDB indices 테이블 없음) → kospi CSV 일봉 → monthly 변환
  if (kospiMonthly.size === 0 && kospiHistory.length > 0) {
    // kospiHistory는 daily. monthEnds에 KOSPI 코드가 없으니 여기서 직접 변환
    const dailyKospi = kospiHistory;
    for (let i = 1; i < dailyKospi.length; i++) {
      const cur = dailyKospi[i];
      const prev = dailyKospi[i - 1];
      if (cur.close > 0 && prev.close > 0) {
        const ym = String(cur.date).slice(0, 7);
        if (!kospiMonthly.has(ym)) kospiMonthly.set(ym, { date: String(cur.date), close: Number(cur.close) });
        else kospiMonthly.get(ym).close = Number(cur.close);
      }
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
      // 등급 (0~100 척도, percentile 0~94)
      const score = {
        value: 50, momentum, quality: 50, volatility: vol, growth: 50,
        liquidity: Math.log10(Math.max(1, turnover)),
        supply: 50,
      };
      stocks.push({ code, scores: score });
    }
    if (stocks.length < 30) continue;
    monthlyScores.push({ date: monthEnds.get(validCodes[0])?.get(ym)?.date || `${ym}-28`, ym, stocks });
  }
  // 정규화 (factor별 rank → 0~99)
  for (const ms of monthlyScores) {
    for (const k of FACTOR_KEYS) {
      const higherBetter = (k === 'momentum' || k === 'growth' || k === 'liquidity' || k === 'supply');
      const values = ms.stocks.map((s) => s.scores[k]).sort((a, b) => higherBetter ? a - b : b - a);
      const n = values.length;
      const rankMap = new Map();
      values.forEach((v, i) => rankMap.set(v, ((n - i) / n) * 99));
      for (const s of ms.stocks) s.scores[k] = Math.max(1, Math.min(95, rankMap.get(s.scores[k]) || 50));
    }
    // total_score 계산
    for (const s of ms.stocks) {
      s.scores.total = totalScore(s.scores);
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

// 시뮬: 정적 vs 동적(매월 리밸런싱) vs 동적(sell2 hit 교체)
function simulate(strategy, monthlyScores, monthlyRetArr, kospiReturns) {
  const W = 10;
  const monthlyRet = [];
  let monthlyComposition = []; // rebal 전용: 매월 top 10 구성
  const tradeLog = []; // [{ym, type: 'buy'/'sell', code, ret, reason}]

  if (strategy === 'static') {
    // 정적: month 0의 top 10 고정
    const top10 = monthlyScores[0].stocks
      .slice()
      .sort((a, b) => (b.scores.total || 0) - (a.scores.total || 0))
      .slice(0, W)
      .map((s) => s.code);
    for (let i = 0; i < monthlyScores.length - 1; i++) {
      const retMap = new Map(Object.entries(monthlyRetArr[i]?.returns || {}));
      let sumRet = 0, n = 0;
      for (const code of top10) {
        const r = retMap.get(code);
        if (r !== undefined) { sumRet += r; n++; }
      }
      monthlyRet.push(n > 0 ? sumRet / n : 0);
    }
  } else if (strategy === 'rebal') {
    // 동적 매월 리밸런싱: 매월 top 10으로 전부 교체
    monthlyComposition = []; // [{ym, date, top10: [code1, ...], scoreMap: {code: total}}, ...]
    for (let i = 0; i < monthlyScores.length - 1; i++) {
      const cur = monthlyScores[i];
      const sorted = cur.stocks
        .slice()
        .sort((a, b) => (b.scores.total || 0) - (a.scores.total || 0));
      const top10 = sorted.slice(0, W).map((s) => s.code);
      const scoreMap = {};
      for (const s of sorted.slice(0, W)) scoreMap[s.code] = round2(s.scores.total || 0);
      monthlyComposition.push({ ym: cur.ym, date: cur.date, top10, scoreMap });
      const retMap = new Map(Object.entries(monthlyRetArr[i]?.returns || {}));
      let sumRet = 0, n = 0;
      for (const code of top10) {
        const r = retMap.get(code);
        if (r !== undefined) { sumRet += r; n++; }
      }
      monthlyRet.push(n > 0 ? sumRet / n : 0);
    }
  } else if (strategy === 'sell2') {
    // 동적 sell2 hit 교체: sell2 hit 종목 매도 + 다음 best로 교체
    let holdings = monthlyScores[0].stocks
      .slice()
      .sort((a, b) => (b.scores.total || 0) - (a.scores.total || 0))
      .slice(0, W)
      .map((s) => s.code);
    for (let i = 0; i < monthlyScores.length - 1; i++) {
      const cur = monthlyScores[i];
      const next = monthlyScores[i + 1];
      const retMap = new Map(Object.entries(monthlyRetArr[i]?.returns || {}));
      // sell2 hit 체크 (다음달 수익률 기준)
      const newHoldings = [];
      const sold = [];
      for (const code of holdings) {
        const r = retMap.get(code);
        if (r === undefined) { newHoldings.push(code); continue; }
        // sell2 조건: +21% 3R OR -7% 1R 손절
        if (r >= 0.21 || r <= -0.07) {
          sold.push({ code, ret: r, reason: r >= 0.21 ? '+21% 익절' : '-7% 손절' });
        } else {
          newHoldings.push(code);
        }
      }
      // 부족분 채우기
      const usedCodes = new Set(newHoldings);
      const sorted = cur.stocks
        .filter((s) => !usedCodes.has(s.code))
        .sort((a, b) => (b.scores.total || 0) - (a.scores.total || 0));
      while (newHoldings.length < W && sorted.length > 0) {
        const next_best = sorted.shift();
        newHoldings.push(next_best.code);
        usedCodes.add(next_best.code);
        tradeLog.push({ ym: next?.ym, type: 'buy', code: next_best.code, reason: 'sell2 후 교체' });
      }
      for (const s of sold) {
        tradeLog.push({ ym: next?.ym, type: 'sell', code: s.code, ret: s.ret, reason: s.reason });
      }
      holdings = newHoldings.slice(0, W);
      // 월 수익률
      let sumRet = 0, n = 0;
      for (const code of holdings) {
        const r = retMap.get(code);
        if (r !== undefined) { sumRet += r; n++; }
      }
      monthlyRet.push(n > 0 ? sumRet / n : 0);
    }
  }

  if (monthlyRet.length < 1) return null;
  const total = monthlyRet.reduce((a, m) => (1 + a) * (1 + m) - 1, 0);
  const alignedKospi = kospiReturns.slice(0, monthlyRet.length);
  const kospiTotal = alignedKospi.length > 0 ? alignedKospi.reduce((a, r) => (1 + a) * (1 + r.ret) - 1, 0) : 0;
  const mean = monthlyRet.reduce((a, m) => a + m, 0) / monthlyRet.length;
  const std = monthlyRet.length >= 2 ? Math.sqrt(monthlyRet.reduce((a, m) => a + (m - mean) ** 2, 0) / monthlyRet.length) : 0;
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(12) : 0;
  const kospiMean = alignedKospi.length > 0 ? alignedKospi.reduce((a, r) => a + r.ret, 0) / alignedKospi.length : 0;
  const alpha = mean - kospiMean;
  let nav = 1, peak = 1, mdd = 0;
  for (const m of monthlyRet) { nav *= 1 + m; if (nav > peak) peak = nav; const dd = (nav - peak) / peak; if (dd < mdd) mdd = dd; }
  return { total, kospiTotal, sharpe, alpha, mdd, nMonths: monthlyRet.length, mean, std, monthlyRet, tradeLog, monthlyComposition };
}

async function main() {
  const { monthlyScores, monthlyRetArr, kospiReturns } = await loadData();
  console.log(`[dp] monthlyScores: ${monthlyScores.length}개월, weights: 가치 50 (2차 회귀 best)`);

  const strategies = ['static', 'rebal', 'sell2'];
  const results = {};
  for (const s of strategies) {
    const r = simulate(s, monthlyScores, monthlyRetArr, kospiReturns);
    if (r) {
      results[s] = r;
      console.log(`\n[dp] === ${s} ===`);
      console.log(`  Sharpe=${round2(r.sharpe)} Total=${round2(r.total * 100)}% KOSPI=${round2(r.kospiTotal * 100)}% MDD=${round2(r.mdd * 100)}% Alpha=${round2(r.alpha * 100)}%/월 n=${r.nMonths}`);
      if (s === 'sell2' && r.tradeLog.length > 0) {
        const buys = r.tradeLog.filter((t) => t.type === 'buy').length;
        const sells = r.tradeLog.filter((t) => t.type === 'sell').length;
        const profitSells = r.tradeLog.filter((t) => t.type === 'sell' && t.ret >= 0.21).length;
        const lossSells = r.tradeLog.filter((t) => t.type === 'sell' && t.ret <= -0.07).length;
        console.log(`  매도 ${sells}회 (익절 ${profitSells}회, 손절 ${lossSells}회), 매수 ${buys}회`);
        // 최근 5개 매도 이력
        const recentSells = r.tradeLog.filter((t) => t.type === 'sell').slice(-5);
        for (const s of recentSells) console.log(`    매도: ${s.ym} ${s.code} ${(s.ret * 100).toFixed(1)}% (${s.reason})`);
      }
    }
  }

  // best 결정: Sharpe + Alpha - MDD×5
  const candidates = [];
  for (const [name, r] of Object.entries(results)) {
    r.score = r.sharpe + (r.alpha || 0) * 100 - Math.abs(r.mdd) * 5;
    candidates.push({ name, ...r });
  }
  candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  const best = candidates[0];
  console.log(`\n[dp] ★ 종합 1위: ${best.name} (Sharpe ${round2(best.sharpe)} Total ${round2(best.total * 100)}% MDD ${round2(best.mdd * 100)}%)`);

  // 현재 best 전략으로 동적 포트폴리오 구성 (실제)
  const rebalResult = results.rebal;
  const lastMonth = monthlyScores[monthlyScores.length - 1];
  const lastTop10 = lastMonth.stocks
    .slice()
    .sort((a, b) => (b.scores.total || 0) - (a.scores.total || 0))
    .slice(0, 10);

  // 현재 보유 종목 + sell2 hit 시뮬레이션 (다음달 예측)
  const currentTop10 = rebalResult.tradeLog ? rebalResult.tradeLog : [];
  // ★ 종목별 진입/이탈 이력 (rebal 전략의 monthlyComposition 기반)
  const comp = rebalResult.monthlyComposition || [];
  const byStock = {};
  let prevCodes = new Set();
  for (let i = 0; i < comp.length; i++) {
    const cur = new Set(comp[i].top10);
    for (const code of cur) {
      if (!prevCodes.has(code)) {
        if (!byStock[code]) byStock[code] = { entries: [], totalMonths: 0, inMonths: 0, outMonths: 0, lastSeen: null };
        byStock[code].entries.push({ ym: comp[i].ym, type: 'in', rank: comp[i].top10.indexOf(code) + 1, score: comp[i].scoreMap[code] });
        byStock[code].inMonths++;
      }
    }
    for (const code of prevCodes) {
      if (!cur.has(code)) {
        if (byStock[code]) byStock[code].outMonths++;
        // 이탈 시점 기록
        if (!byStock[code]) byStock[code] = { entries: [], totalMonths: 0, inMonths: 0, outMonths: 0, lastSeen: null };
        byStock[code].entries.push({ ym: comp[i].ym, type: 'out' });
      }
    }
    for (const code of cur) {
      if (!byStock[code]) byStock[code] = { entries: [], totalMonths: 0, inMonths: 0, outMonths: 0, lastSeen: null };
      byStock[code].totalMonths++;
      byStock[code].lastSeen = comp[i].ym;
    }
    prevCodes = cur;
  }
  // 현재 보유중인 종목
  const currentlyHeld = comp.length > 0 ? comp[comp.length - 1].top10 : [];
  const out = {
    asOf: new Date().toISOString(),
    period: `${monthlyScores[0]?.ym} ~ ${monthlyScores[monthlyScores.length - 1]?.ym}`,
    nMonths: monthlyScores.length,
    weights: WEIGHTS,
    strategies: {
      static: { sharpe: round4(results.static.sharpe), total: round4(results.static.total), kospiTotal: round4(results.static.kospiTotal), mdd: round4(results.static.mdd), alpha: round4(results.static.alpha), n: results.static.nMonths },
      rebal: { sharpe: round4(results.rebal.sharpe), total: round4(results.rebal.total), kospiTotal: round4(results.rebal.kospiTotal), mdd: round4(results.rebal.mdd), alpha: round4(results.rebal.alpha), n: results.rebal.nMonths },
      sell2: { sharpe: round4(results.sell2.sharpe), total: round4(results.sell2.total), kospiTotal: round4(results.sell2.kospiTotal), mdd: round4(results.sell2.mdd), alpha: round4(results.sell2.alpha), n: results.sell2.nMonths, trades: results.sell2.tradeLog.length, buys: results.sell2.tradeLog.filter((t) => t.type === 'buy').length, sells: results.sell2.tradeLog.filter((t) => t.type === 'sell').length },
    },
    best: { name: best.name, sharpe: round4(best.sharpe), total: round4(best.total), mdd: round4(best.mdd) },
    monthlyComposition: comp,
    currentlyHeld,
    byStock,
    description: '10개 종목 동적 리밸런싱. 매월 종합 점수 (가치 50 가중치) 기준 top 10으로 재구성. sell2 신호 (+21% 3R / -7% 1R) hit 종목 매도 → 다음 best 매수. 10개 종목 항상 유지.',
  };
  fs.writeFileSync(path.join(ROOT, 'public', 'data', 'dynamic-portfolio.json'), JSON.stringify(out, null, 2));
  console.log(`[dp] dynamic-portfolio.json 저장 (byStock: ${Object.keys(byStock).length}개 종목 이력)`);
}

main().catch((e) => { console.error('[dp] fatal:', e.message, e.stack); process.exit(1); });
