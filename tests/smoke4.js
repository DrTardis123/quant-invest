'use strict';

// Smoke test 4: 새 기능 검증
// 1) Naver: 외인/기관 매매동향 추출
// 2) Naver: 실시간 시세
// 3) technical.js: MA/RSI/MACD/BB/Volatility
// 4) optimizer: factor importance
// 5) update.js: investor_flow 통합 (mock)

const assert = require('assert');
const naver = require('../src/data/naver');
const technical = require('../src/scoring/technical');
const { analyze } = technical;

let passed = 0, failed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

(async () => {
  console.log('=== Smoke 4: 신규 기능 검증 ===');

  // 1) Naver: 외인/기관 매매
  await t('Naver.listStocks("KOSPI") returns array', async () => {
    const r = await naver.listStocks('KOSPI');
    assert(Array.isArray(r));
    assert(r.length > 100, `expected >100 stocks, got ${r.length}`);
    assert(r[0].code && r[0].name);
  });

  await t('Naver.getInvestorFlow("005930") returns 5 rows', async () => {
    const r = await naver.getInvestorFlow('005930', { days: 5 });
    assert(Array.isArray(r));
    assert(r.length === 5, `expected 5, got ${r.length}`);
    assert(r[0].date && r[0].close != null);
    assert(r[0].foreign_net != null, 'foreign_net should be a number');
    assert(r[0].institution_net != null);
    assert(r[0].foreign_holding_ratio != null);
  });

  await t('Naver.getRealtime("005930") has market_cap', async () => {
    const r = await naver.getRealtime('005930');
    assert(r && r.code === '005930');
    assert(r.close > 0);
    assert(r.market_cap > 0, 'should have market cap');
  });

  await t('Naver.getRealtimeBatch returns array', async () => {
    const r = await naver.getRealtimeBatch(['005930', '000660', '005380']);
    assert(Array.isArray(r));
    assert(r.length === 3);
  });

  // 2) Technical
  await t('technical.analyze returns summary+series', () => {
    const prices = [];
    for (let i = 0; i < 100; i++) {
      prices.push({ date: `2024-01-${String(i % 28 + 1).padStart(2, '0')}`, close: 100 + i * 0.5 + Math.sin(i / 5) * 5, volume: 1000000 });
    }
    const r = analyze(prices);
    assert(r.summary, 'should have summary');
    assert(r.summary.last, 'should have last value');
    assert(r.summary.signals, 'should have signals');
    assert(typeof r.summary.signals.ma_trend === 'string');
    assert(typeof r.summary.signals.rsi_zone === 'string');
  });

  await t('technical: RSI in [0, 100]', () => {
    const closes = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109, 111, 110, 112, 114, 113, 115];
    const rsi = technical.rsi(closes, 14);
    rsi.forEach((v) => {
      if (v != null) assert(v >= 0 && v <= 100, `RSI out of range: ${v}`);
    });
  });

  await t('technical: SMA matches manual', () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sma5 = technical.sma(closes, 5);
    assert(sma5[3] === null, 'should be null before period');
    assert(sma5[4] === 3, 'sma5 at index 4 should be 3');
    assert(sma5[9] === 8, 'sma5 at index 9 should be 8');
  });

  await t('technical: MACD has 3 series', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    const m = technical.macd(closes);
    assert(m.macd.length === 50);
    assert(m.signal.length === 50);
    assert(m.histogram.length === 50);
  });

  // 3) update.js: 모듈 로드 + investor_flow 함수 존재
  await t('update.js exports refreshInvestorFlowForAll', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../scripts/update.js'), 'utf8');
    assert(src.includes('refreshInvestorFlowForAll'), 'should define refreshInvestorFlowForAll');
    assert(src.includes('investor_flow'), 'should reference investor_flow table');
  });

  // 4) Schema
  await t('schema.sql has investor_flow', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../src/db/schema.sql'), 'utf8');
    assert(src.includes('CREATE TABLE IF NOT EXISTS investor_flow'));
    assert(src.includes('institution_net'));
    assert(src.includes('foreign_net'));
  });

  // 5) HTML: 새 탭 존재
  await t('index.html has 새 탭 (수급, 기술, 회귀)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
    assert(src.includes("detailTab==='supply'"), 'should have supply tab');
    assert(src.includes("detailTab==='technical'"), 'should have technical tab');
    assert(src.includes("detailTab==='regression'"), 'should have regression tab');
  });

  // 6) app.js: 새 draw 함수들
  await t('app.js has new chart functions', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
    assert(src.includes('_drawSupplyChart'));
    assert(src.includes('_drawHoldingChart'));
    assert(src.includes('_drawMAChart'));
    assert(src.includes('_drawRSIChart'));
    assert(src.includes('_drawMACDChart'));
    assert(src.includes('_drawBBChart'));
    assert(src.includes('_drawWeightChart'));
    assert(src.includes('_drawContributionChart'));
    assert(src.includes('_drawFactorImportanceChart'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
