'use strict';
// 신호 추적 백필 — calculateSignals 활성 신호의 +5/+10/+20일 후 실제 수익률 추적
// usage: DUCKDB_READ_ONLY=1 node scripts/backfill-signal-performance.js [--days=100] [--market=KOSPI]
process.chdir('C:/Users/LG/Documents/quant_invest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');
const { calculateSignals } = require('../src/data/signals');
const { lightIsExcludedProduct } = require('../src/data/filters');

const HORIZONS = [5, 10, 20];
const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith('--days='));
const marketArg = args.find((a) => a.startsWith('--market='));
const LOOKBACK_DAYS = daysArg ? Number(daysArg.split('=')[1]) : 100;
const MARKET_ARG = marketArg ? marketArg.split('=')[1] : 'KOSPI';
// 'all'이면 KOSPI+KOSDAQ 둘 다, 아니면 단일 마켓
const MARKETS = MARKET_ARG === 'all' ? ['KOSPI', 'KOSDAQ'] : [MARKET_ARG];

function dateToStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'bigint') return new Date(Number(d) * 86400000).toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function mean(arr) {
  const v = arr.filter((x) => x !== null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

(async () => {
  const t0 = Date.now();
  console.log(`[signal-tracker] 시작 (lookback=${LOOKBACK_DAYS}일, markets=${MARKETS.join(',')})`);

  // 1) 대상 종목 (KOSPI ~800개, ETF/ETN/리츠/우선주/SPAC 자동 제외)
  const marketClause = MARKETS.map((m) => `'${m}'`).join(',');
  const stocksAll = await db.all(`SELECT code, name, market FROM stocks WHERE market IN (${marketClause})`);
  const stocks = stocksAll.filter((s) => !lightIsExcludedProduct(s.name));
  const excludedCount = stocksAll.length - stocks.length;
  console.log(`  대상 종목: ${stocks.length}개 (제외: ${excludedCount}개)`);

  // 2) daily_prices 마지막 LOOKBACK_DAYS + 25 (20일 후 평가용 마진) 일
  const priceRows = await db.all(`
    SELECT code, date, close, volume
    FROM daily_prices
    WHERE date >= (SELECT MAX(date) FROM daily_prices) - INTERVAL '${LOOKBACK_DAYS + 30} days'
      AND code IN (SELECT code FROM stocks WHERE market IN (${marketClause}))
    ORDER BY code, date
  `);
  console.log(`  가격 데이터: ${priceRows.length}행`);

  // 3) 종목별 가격 그룹화
  const pricesByCode = {};
  for (const r of priceRows) {
    if (!pricesByCode[r.code]) pricesByCode[r.code] = [];
    pricesByCode[r.code].push({ date: dateToStr(r.date), close: Number(r.close), volume: Number(r.volume) || 0 });
  }

  // 4) 각 종목 × 각 날짜 슬라이딩 윈도우 → 신호 계산
  const signals = [];
  let calcCount = 0;
  const t1 = Date.now();
  for (const code of Object.keys(pricesByCode)) {
    const prices = pricesByCode[code];
    if (prices.length < 70) continue; // MA60 + 평가 마진
    for (let i = 60; i < prices.length - 20; i++) {
      // 마지막 20일은 평가용 (미래 가격 필요)
      const window = prices.slice(Math.max(0, i - 60), i + 1);
      const sig = calculateSignals(window, null);
      if (!sig) continue;
      calcCount++;
      const sigDate = prices[i].date;
      // 신호별 매수가 분리: buy1=ma5, buy2=ma20 (1차매수 > 2차매수 가격, 분할 매수 효과)
      if (sig.buy1.active) signals.push({ code, type: 'buy1', date: sigDate, price: sig.buy1.price, score: sig.buy1.score });
      if (sig.buy2.active) signals.push({ code, type: 'buy2', date: sigDate, price: sig.buy2.price, score: sig.buy2.score });
      if (sig.sell1.active) signals.push({ code, type: 'sell1', date: sigDate, price: sig.sell1.price, score: sig.sell1.score });
      if (sig.sell2.active) signals.push({ code, type: 'sell2', date: sigDate, price: sig.sell2.price, score: sig.sell2.score });
    }
  }
  console.log(`  신호 계산: ${calcCount}건, 활성 신호: ${signals.length}건 (${Date.now() - t1}ms)`);

  // 5) 각 신호의 +5/+10/+20일 후 가격 → 수익률
  for (const s of signals) {
    const prices = pricesByCode[s.code];
    if (!prices) continue;
    const idx = prices.findIndex((p) => p.date === s.date);
    for (const h of HORIZONS) {
      const futureIdx = idx + h;
      if (futureIdx < prices.length) {
        const futurePrice = prices[futureIdx].close;
        s[`ret${h}d`] = (futurePrice - s.price) / s.price * 100;
      } else {
        s[`ret${h}d`] = null;
      }
    }
  }

  // 6) 신호 종류별 KPI 계산
  const types = ['buy1', 'buy2', 'sell1', 'sell2'];
  const summary = {};
  for (const t of types) {
    const sigs = signals.filter((s) => s.type === t);
    const rets5 = sigs.map((s) => s.ret5d).filter((v) => v !== null && !isNaN(v));
    const rets10 = sigs.map((s) => s.ret10d).filter((v) => v !== null && !isNaN(v));
    const rets20 = sigs.map((s) => s.ret20d).filter((v) => v !== null && !isNaN(v));
    const isBuy = t.startsWith('buy');
    summary[t] = {
      total: sigs.length,
      evaluated5d: rets5.length,
      evaluated10d: rets10.length,
      evaluated20d: rets20.length,
      avgReturn5d: mean(rets5),
      avgReturn10d: mean(rets10),
      avgReturn20d: mean(rets20),
      medianReturn10d: rets10.length ? (() => {
        const sorted = [...rets10].sort((a, b) => a - b);
        const m = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
      })() : null,
      maxProfit: rets20.length ? Math.max(...rets20) : null,
      maxLoss: rets20.length ? Math.min(...rets20) : null,
      // 매수 신호: +5% 이상이면 성공
      // 매도 신호: -5% 이상이면 회피 성공 (손절 잘함) / +5% 이상이면 익절 회피 (아쉬움)
      winRate5d: isBuy && rets5.length ? rets5.filter((r) => r >= 1).length / rets5.length : null,
      winRate10d: isBuy && rets10.length ? rets10.filter((r) => r >= 2).length / rets10.length : null,
      winRate20d: isBuy && rets20.length ? rets20.filter((r) => r >= 3).length / rets20.length : null,
    };
  }

  // 7) 최근 30개 신호 (코드 + 종목명 매핑)
  const codeToName = {};
  for (const s of stocks) codeToName[s.code] = s.name;
  const recent = signals.slice(-30).reverse().map((s) => ({
    code: s.code,
    name: codeToName[s.code] || s.code,
    type: s.type,
    date: s.date,
    price: Math.round(s.price),
    score: s.score,
    ret5d: s.ret5d !== null ? Math.round(s.ret5d * 100) / 100 : null,
    ret10d: s.ret10d !== null ? Math.round(s.ret10d * 100) / 100 : null,
    ret20d: s.ret20d !== null ? Math.round(s.ret20d * 100) / 100 : null,
  }));

  // 8) 신호 종류별 시계열 (월별 집계)
  const monthly = {};
  for (const s of signals) {
    const ym = s.date.slice(0, 7);
    if (!monthly[ym]) monthly[ym] = { buy1: [], buy2: [], sell1: [], sell2: [] };
    if (s.ret10d !== null) monthly[ym][s.type].push(s.ret10d);
  }
  const monthlyAgg = {};
  for (const ym of Object.keys(monthly).sort()) {
    const m = monthly[ym];
    monthlyAgg[ym] = {};
    for (const t of types) {
      const rets = m[t];
      monthlyAgg[ym][t] = rets.length ? {
        count: rets.length,
        avgReturn: mean(rets),
      } : null;
    }
  }

  // 9) JSON 저장
  const lastDateRow = await db.one(`SELECT MAX(date) AS d FROM daily_prices`);
  const lastDate = dateToStr(lastDateRow.d);
  const out = {
    asOf: new Date().toISOString(),
    priceDate: lastDate,
    lookbackDays: LOOKBACK_DAYS,
    markets: MARKETS,
    summary,
    recent,
    monthly: monthlyAgg,
    notes: {
      buy: 'BUY1/BUY2 신호 후 +5/+10/+20일 후 수익률. 승률은 +1%/+2%/+3% 기준',
      sell: 'SELL1 손절 신호 후 -5%↓ 추가 하락 비율 (= 회피 성공). SELL2 익절 신호 후 +5%↑ 추가 상승 비율 (= 놓친 수익)',
    },
  };
  const outPath = path.join(__dirname, '..', 'public', 'data', MARKETS.length === 1 ? `signal-performance${MARKETS[0] !== 'KOSPI' ? '-' + MARKETS[0].toLowerCase() : ''}.json` : 'signal-performance.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 0));
  console.log(`\n=== KPI 요약 (${MARKETS.join('+')}) ===`);
  for (const t of types) {
    const s = summary[t];
    console.log(`  ${t}: total=${s.total} 5d=${s.evaluated5d} 10d=${s.evaluated10d} 20d=${s.evaluated20d}  avg10d=${s.avgReturn10d?.toFixed(2)}%  max20d=${s.maxProfit?.toFixed(2)}% / ${s.maxLoss?.toFixed(2)}%`);
  }
  console.log(`\n  저장: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)}KB, ${Date.now() - t0}ms)`);
  await db.close();
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
