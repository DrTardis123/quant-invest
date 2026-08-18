'use strict';
// TOP 200 종목 stock/*.json export (매트릭스 탭용)
process.chdir('C:/Users/LG/Documents/quant_invest');
process.env.DUCKDB_READ_ONLY = '1';
process.env.EXPORT_ONLY = '1';
const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');
const { calculateSignals } = require('../src/data/signals');
const { lightIsExcludedProduct } = require('../src/data/filters');
const technical = require('../src/scoring/technical');

const N = parseInt(process.argv.find((a) => a.startsWith('--n='))?.split('=')[1] || '200', 10);
const MARKET = process.argv.find((a) => a.startsWith('--market='))?.split('=')[1] || null;
const STOCK_DIR = path.join(__dirname, '..', 'public', 'data', 'stock');
const STOCK_HISTORY_DAYS = 90;

function dateToStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'bigint') return new Date(Number(d) * 86400000).toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

(async () => {
  const t0 = Date.now();
  console.log(`[export-top${N}${MARKET ? ' market=' + MARKET : ''}] 시작`);

  if (!fs.existsSync(STOCK_DIR)) fs.mkdirSync(STOCK_DIR, { recursive: true });

  // 1) TOP N 종목 (ETF/ETN/리츠/인버스/우선주/SPAC 제외)
  const marketClause = MARKET ? `AND s.market = '${MARKET}'` : '';
  const stocksAll = await db.all(`
    SELECT s.code, s.name
    FROM factor_scores fs
    JOIN stocks s ON fs.code = s.code
    JOIN (SELECT MAX(date) as max_date FROM factor_scores) m ON fs.date = m.max_date
    WHERE fs.total_score IS NOT NULL ${marketClause}
    ORDER BY fs.total_score DESC
    LIMIT ${N * 2}
  `);
  const stocks = stocksAll.filter((s) => !lightIsExcludedProduct(s.name)).slice(0, N);
  const excludedCount = stocksAll.length - stocks.length;
  console.log(`  대상: ${stocks.length}개 (제외: ${excludedCount}개)`);

  let success = 0, failed = 0;
  for (let i = 0; i < stocks.length; i++) {
    const { code } = stocks[i];
    try {
      const stock = await db.one(`SELECT * FROM stocks WHERE code = ?`, [code]);
      const score = await db.one(`
        SELECT * FROM factor_scores
        WHERE code = ? AND date = (SELECT MAX(date) FROM factor_scores WHERE code = ?)`, [code, code]);
      const fund = await db.all(`SELECT * FROM fundamentals WHERE code = ? ORDER BY period DESC LIMIT 4`, [code]);
      const prices = await db.all(`
        SELECT date, open, high, low, close, volume FROM daily_prices WHERE code = ?
        ORDER BY date DESC LIMIT ?`, [code, 200]); // 200일 (매트릭스 계산용)
      prices.reverse(); // 오래된 → 최신
      const flow = await db.all(`
        SELECT date, close, change, volume, institution_net, foreign_net, foreign_holding_ratio
        FROM investor_flow WHERE code = ?
        ORDER BY date DESC LIMIT 20`, [code]);
      // 기술분석
      const pricesForTech = prices.slice(-90).map((p) => ({ date: dateToStr(p.date), close: Number(p.close), volume: Number(p.volume) || 0 }));
      const tech = technical.analyze(pricesForTech);
      // 매트릭스 (calculateSignals)
      const signals = calculateSignals(prices.map((p) => ({
        date: dateToStr(p.date),
        open: Number(p.open), high: Number(p.high), low: Number(p.low),
        close: Number(p.close), volume: Number(p.volume) || 0,
      })), tech.summary);

      const detail = {
        stock: { ...stock },
        score: score ? {
          code: score.code,
          date: dateToStr(score.date),
          value_score: Number(score.value_score) || 0,
          momentum_score: Number(score.momentum_score) || 0,
          quality_score: Number(score.quality_score) || 0,
          volatility_score: Number(score.volatility_score) || 0,
          growth_score: Number(score.growth_score) || 0,
          liquidity_score: Number(score.liquidity_score) || 0,
          supply_score: Number(score.supply_score) || 0,
          total_score: Number(score.total_score) || 0,
          rank: Number(score.rank) || 0,
        } : null,
        fundamentals: fund,
        prices: prices.slice(-90).map((p) => ({ date: dateToStr(p.date), close: Number(p.close), volume: Number(p.volume) || 0 })),
        investor_flow: flow,
        technical: tech.summary,
        technical_series: tech.indicators,
        signals: signals,
        exportedAt: new Date().toISOString(),
      };

      fs.writeFileSync(
        path.join(STOCK_DIR, `${code}.json`),
        JSON.stringify(detail, (_k, v) => typeof v === 'bigint' ? Number(v) : v)
      );
      success++;

      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${stocks.length} (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${code}: ${e.message}`);
    }
  }

  console.log(`\n[완료] 성공 ${success} / 실패 ${failed} (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  await db.close();
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
