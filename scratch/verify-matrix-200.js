'use strict';
// TOP N 종목 × 200일 일봉 → 매트릭스 계산 → 강신호 top 20 추출
process.chdir('C:/Users/LG/Documents/quant_invest');
process.env.DUCKDB_READ_ONLY = '1';
process.env.EXPORT_ONLY = '1';
const db = require('../src/db/connection');
const { calculateSignals } = require('../src/data/signals');
const { lightIsExcludedProduct } = require('../src/data/filters');

const N = parseInt(process.argv.find((a) => a.startsWith('--n='))?.split('=')[1] || '200', 10);
const MARKET = process.argv.find((a) => a.startsWith('--market='))?.split('=')[1] || 'KOSPI';

function dateToStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'bigint') return new Date(Number(d) * 86400000).toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

(async () => {
  const t0 = Date.now();
  console.log(`[verify-matrix] 시작 (N=${N}, market=${MARKET})`);

  // 1) TOP N 종목 (factor_scores 최신 total_score 기준, KOSPI 우선)
  const stocks = await db.all(`
    SELECT s.code, s.name, s.market, s.sector, fs.total_score
    FROM factor_scores fs
    JOIN stocks s ON fs.code = s.code
    JOIN (SELECT MAX(date) as max_date FROM factor_scores) m ON fs.date = m.max_date
    WHERE s.market = '${MARKET}' AND fs.total_score IS NOT NULL
    ORDER BY fs.total_score DESC
    LIMIT ${N}
  `);
  console.log(`  TOP ${stocks.length}개 종목 로드`);

  // 2) 일봉 fetch (코드 200개 + 200일치)
  const codes = stocks.map((s) => s.code);
  const codeList = codes.map((c) => `'${c}'`).join(',');
  const priceRows = await db.all(`
    SELECT code, date, open, high, low, close, volume
    FROM daily_prices
    WHERE code IN (${codeList})
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

  // 4) 매트릭스 계산 + 강신호 추출
  const results = [];
  let calcCount = 0;
  let excludedCount = 0;
  for (const stock of stocks) {
    // ETF/ETN/리츠/인버스/SPAC/우선주 자동 제외
    if (lightIsExcludedProduct(stock.name)) {
      excludedCount++;
      continue;
    }
    const prices = pricesByCode[stock.code];
    if (!prices || prices.length < 60) continue;
    const sig = calculateSignals(prices, null);
    if (!sig) continue;
    calcCount++;
    // 활성 신호 카운트
    const activeSignals = [
      sig.buy1.active && 'buy1',
      sig.buy2.active && 'buy2',
      sig.sell1.active && 'sell1',
      sig.sell2.active && 'sell2',
    ].filter(Boolean);
    results.push({
      code: stock.code,
      name: stock.name,
      market: stock.market,
      sector: stock.sector,
      total_score: stock.total_score,
      currentPrice: sig.currentPrice,
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
      stopLoss: sig.matrix.stopLoss.final,
      activeCount: activeSignals.length,
      activeSignals: activeSignals,
      ma20: Math.round(sig.ma.ma20),
      ma60: Math.round(sig.ma.ma60),
      isAligned: sig.context.isAligned,
    });
  }

  console.log(`  매트릭스 계산: ${calcCount}건 (제외: ${excludedCount}건, ${Date.now() - t0}ms)`);

  // 5) 정렬 + 통계
  results.sort((a, b) => (b.buy1Score + (b.buy1Active ? 50 : 0)) - (a.buy1Score + (a.buy1Active ? 50 : 0)));

  console.log('\n=== 📊 매트릭스 통계 (TOP 200) ===');
  const aligned = results.filter((r) => r.isAligned).length;
  const buy1Active = results.filter((r) => r.buy1Active).length;
  const buy2Active = results.filter((r) => r.buy2Active).length;
  const bothActive = results.filter((r) => r.buy1Active && r.buy2Active).length;
  console.log(`정배열: ${aligned}/${results.length} (${(aligned / results.length * 100).toFixed(1)}%)`);
  console.log(`1차매수 활성: ${buy1Active}/${results.length} (${(buy1Active / results.length * 100).toFixed(1)}%)`);
  console.log(`2차매수 활성: ${buy2Active}/${results.length} (${(buy2Active / results.length * 100).toFixed(1)}%)`);
  console.log(`1차+2차 동시 활성: ${bothActive}/${results.length} (${(bothActive / results.length * 100).toFixed(1)}%)`);

  console.log('\n=== 🏆 강신호 top 20 (1차매수 점수 + 활성 가산 50점) ===');
  console.log('순위 | 코드 | 이름 | 시장 | 점수 | 활성 | 매수가 | 매도가 | 손절가 | MA20/60 | 비고');
  console.log('---');
  results.slice(0, 20).forEach((r, i) => {
    const buy = r.buy1Active ? '🟢' : '⚪';
    const buy2 = r.buy2Active ? '🟡' : '⚪';
    const note = [
      r.isAligned ? '정배열' : '역배열',
      r.buy1Active && r.buy2Active ? '1차+2차' : '',
    ].filter(Boolean).join(' ');
    console.log(`${(i + 1).toString().padStart(2)} | ${r.code} | ${r.name} | ${r.market} | ${r.buy1Score} | ${buy}${buy2} | ${r.buy1Price.toLocaleString()} | ${r.sell1Price.toLocaleString()} | ${Math.round(r.stopLoss).toLocaleString()} | ${r.ma20.toLocaleString()}/${r.ma60.toLocaleString()} | ${note}`);
  });

  // 6) JSON 저장
  const out = {
    asOf: new Date().toISOString(),
    market: MARKET,
    count: results.length,
    stats: { aligned, buy1Active, buy2Active, bothActive },
    top: results.slice(0, 30),
  };
  require('fs').writeFileSync(
    'public/data/matrix-verify-top200.json',
    JSON.stringify(out, null, 2)
  );
  console.log(`\n[저장] public/data/matrix-verify-top200.json (${results.length}건)`);
  console.log(`[완료] ${Date.now() - t0}ms`);

  await db.close();
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
