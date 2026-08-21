// 매트릭스 검증 200개 백필 (KOSPI/KOSDAQ)
// 각 200개 × 30일 매일 매트릭스 계산 → 신호 발생 시 +5/+10/+20d 수익률
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');
process.env.DUCKDB_READ_ONLY = '1';
const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');
const { calculateSignals } = require('../src/data/signals');
const { lightIsExcludedProduct } = require('../src/data/filters');

const N = parseInt(process.env.N || '200', 10);
const DAYS = parseInt(process.env.DAYS || '30', 10);
const MARKET = process.env.MARKET || 'BOTH'; // KOSPI | KOSDAQ | BOTH
const LOOKBACK_DAYS = 100; // MA60 (60) + 신호 안정성 (40) = 100
const FETCH_DAYS = LOOKBACK_DAYS + DAYS + 30 + 20; // ret20d 계산 여유

function dateToStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

async function backfillMarket(market) {
  const t0 = Date.now();
  console.log(`\n[backfill-matrix-200] ${market} 시작 (N=${N}, days=${DAYS})`);

  // 1) TOP N 종목 (factor_scores 최신)
  const stocks = await db.all(`
    SELECT s.code, s.name, s.market, s.sector, fs.total_score
    FROM factor_scores fs
    JOIN stocks s ON fs.code = s.code
    WHERE s.market = '${market}' AND fs.total_score IS NOT NULL
    ORDER BY fs.total_score DESC
    LIMIT ${N}
  `);
  console.log(`  TOP ${stocks.length}개 종목 로드`);

  // 2) 일봉 bulk fetch
  const codeList = stocks.map((s) => `'${s.code}'`).join(',');
  const priceRows = await db.all(`
    SELECT code, date, open, high, low, close, volume
    FROM daily_prices
    WHERE code IN (${codeList})
    AND date >= (CURRENT_DATE - INTERVAL '${FETCH_DAYS} days')
    ORDER BY code, date
  `);
  console.log(`  일봉: ${priceRows.length}행`);

  // 3) 종목별 그룹화
  const pricesByCode = {};
  for (const r of priceRows) {
    if (!pricesByCode[r.code]) pricesByCode[r.code] = [];
    pricesByCode[r.code].push({
      date: dateToStr(r.date),
      open: Number(r.open), high: Number(r.high), low: Number(r.low),
      close: Number(r.close), volume: Number(r.volume) || 0,
    });
  }

  // 4) 매트릭스 백필
  const results = [];
  let excluded = 0;
  let processed = 0;
  const startTime = Date.now();

  for (const stock of stocks) {
    // ETF/우선주 등 제외
    if (lightIsExcludedProduct(stock.name)) {
      excluded++;
      continue;
    }
    const prices = pricesByCode[stock.code];
    if (!prices || prices.length < LOOKBACK_DAYS) continue;  // 최소 LOOKBACK_DAYS 필요
    processed++;

    // 각 일자에 대해 백필
    const dayResults = [];
    // 마지막 DAYS일 × LOOKBACK_DAYS 보장
    const endIdx = prices.length;
    // LOOKBACK_DAYS 이전은 시그널 계산 불가, 그 이후 DAYS일
    if (endIdx < LOOKBACK_DAYS + 1) continue;
    const startIdx = Math.max(LOOKBACK_DAYS, endIdx - DAYS);
    for (let i = startIdx; i < endIdx; i++) {
      const slice = prices.slice(0, i);
      if (slice.length < LOOKBACK_DAYS) continue;
      const sig = calculateSignals(slice, null);
      if (!sig) continue;
      const dayData = prices[i];
      // 이후 5/10/20일 수익률 계산
      const ret5d = i + 5 < prices.length ? ((Number(prices[i + 5].close) - dayData.close) / dayData.close) * 100 : null;
      const ret10d = i + 10 < prices.length ? ((Number(prices[i + 10].close) - dayData.close) / dayData.close) * 100 : null;
      const ret20d = i + 20 < prices.length ? ((Number(prices[i + 20].close) - dayData.close) / dayData.close) * 100 : null;
      dayResults.push({
        date: dayData.date,
        close: dayData.close,
        buy1Score: sig.buy1.score,
        buy1Active: sig.buy1.active,
        buy1Price: sig.buy1.price,
        buy2Score: sig.buy2.score,
        buy2Active: sig.buy2.active,
        buy2Price: sig.buy2.price,
        sell1Score: sig.sell1.score,
        sell1Active: sig.sell1.active,
        sell1Price: sig.sell1.price,
        sell2Score: sig.sell2.score,
        sell2Active: sig.sell2.active,
        sell2Price: sig.sell2.price,
        totalScore: sig.buy1.score + sig.buy2.score + sig.sell1.score + sig.sell2.score,
        ret5d: ret5d !== null ? Math.round(ret5d * 100) / 100 : null,
        ret10d: ret10d !== null ? Math.round(ret10d * 100) / 100 : null,
        ret20d: ret20d !== null ? Math.round(ret20d * 100) / 100 : null,
      });
    }
    results.push({
      code: stock.code,
      name: stock.name,
      market: stock.market,
      sector: stock.sector,
      baseScore: stock.total_score,
      days: dayResults,
      stats: {
        totalDays: dayResults.length,
        buy1ActiveDays: dayResults.filter((d) => d.buy1Active).length,
        buy2ActiveDays: dayResults.filter((d) => d.buy2Active).length,
        sell1ActiveDays: dayResults.filter((d) => d.sell1Active).length,
        sell2ActiveDays: dayResults.filter((d) => d.sell2Active).length,
      },
    });
  }
  const elapsed = Date.now() - startTime;
  console.log(`  처리: ${processed}개 (제외: ${excluded}개, ${elapsed}ms, ${(elapsed / processed).toFixed(0)}ms/개)`);

  // 5) 등급별 + 신호별 +5/+10/+20 집계 (quantile 기반)
  // 매트릭스 점수 분포: -50 ~ +60, 등급 기준 quantile
  function quantile(arr, q) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    return sorted[base];
  }
  // 각 신호 점수 quantile 계산
  const quantileBy = {};
  for (const sig of ['buy1', 'buy2', 'sell1', 'sell2']) {
    const allScores = [];
    for (const r of results) for (const d of r.days) allScores.push(d[`${sig}Score`]);
    quantileBy[sig] = {
      p20: quantile(allScores, 0.2),
      p40: quantile(allScores, 0.4),
      p70: quantile(allScores, 0.7),
      p90: quantile(allScores, 0.9),
    };
  }
  function gradeOf(sig, score) {
    const q = quantileBy[sig];
    if (score >= q.p90) return 'A';
    if (score >= q.p70) return 'B';
    if (score >= q.p40) return 'C';
    if (score >= q.p20) return 'D';
    return 'F';
  }
  const gradeBySignal = {};
  for (const sig of ['buy1', 'buy2', 'sell1', 'sell2']) {
    gradeBySignal[sig] = {};
    for (const g of ['A', 'B', 'C', 'D', 'F']) {
      gradeBySignal[sig][g] = { total: 0, ret5d: [], ret10d: [], ret20d: [] };
    }
    for (const r of results) {
      for (const d of r.days) {
        const sigScore = d[`${sig}Score`];
        const g = gradeOf(sig, sigScore);
        const s = gradeBySignal[sig][g];
        if (d[`${sig}Active`]) s.total++;
        if (d.ret5d !== null) s.ret5d.push(d.ret5d);
        if (d.ret10d !== null) s.ret10d.push(d.ret10d);
        if (d.ret20d !== null) s.ret20d.push(d.ret20d);
      }
    }
  }
  // 평균 계산
  const summary = {};
  for (const sig of ['buy1', 'buy2', 'sell1', 'sell2']) {
    summary[sig] = {};
    for (const g of ['A', 'B', 'C', 'D', 'F']) {
      const s = gradeBySignal[sig][g];
      const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      const win = (arr, thr) => arr.length ? arr.filter((v) => v > thr).length / arr.length : null;
      summary[sig][g] = {
        total: s.total,
        avgReturn5d: avg(s.ret5d),
        avgReturn10d: avg(s.ret10d),
        avgReturn20d: avg(s.ret20d),
        winRate5d: win(s.ret5d, 1),
        winRate10d: win(s.ret10d, 2),
        winRate20d: win(s.ret20d, 3),
      };
    }
  }

  // 6) JSON 저장 (items는 상위 200개로 제한 — Vercel deploy throttle 방지)
  const topItems = results.slice(0, 200);
  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    market,
    n: N,
    days: DAYS,
    count: results.length,
    topCount: topItems.length,
    excluded,
    quantile: quantileBy,
    summary,
    items: topItems,
    generatedAt: new Date().toISOString(),
  };
  const outFile = market === 'KOSPI'
    ? 'public/data/matrix-backfill-200.json'
    : 'public/data/matrix-backfill-200-kosdaq.json';
  fs.writeFileSync(path.resolve(outFile), JSON.stringify(out, null, 2), 'utf8');
  console.log(`  [저장] ${outFile} (${(fs.statSync(path.resolve(outFile)).size / 1024).toFixed(0)}KB)`);
  console.log(`[backfill-matrix-200] ${market} 완료 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return out;
}

(async () => {
  if (MARKET === 'KOSPI' || MARKET === 'BOTH') await backfillMarket('KOSPI');
  if (MARKET === 'KOSDAQ' || MARKET === 'BOTH') await backfillMarket('KOSDAQ');
  await db.close();
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
