'use strict';

// 데이터 갱신 스크립트 (GitHub Actions 전용)
// 실행: npm run update
// 동작: 네이버 금융 → DuckDB → 정적 JSON 출력 (public/data/)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const cfg = require('../src/config');
const { initSchema } = require('../src/db/init');
const db = require('../src/db/connection');
const data = require('../src/data');
const indices = require('../src/data/indices');
const { calculateAll, persistScores } = require('../src/factors');
const scoring = require('../src/scoring');

const DATA_DIR = path.join(ROOT, 'public', 'data');
const STOCK_DIR = path.join(DATA_DIR, 'stock');
const TOP_N_SHIPPED = 20;        // top.json 에 담을 종목 수
const HEATMAP_LIMIT = 80;        // 히트맵 종목 수
const STOCK_HISTORY_DAYS = 90;   // 종목별 상세에 담을 일수 (git 사이즈 절약)

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function refreshStocks() {
  let n = 0;
  for (const market of cfg.data.markets) {
    const list = await data.listStocks(market);
    for (const s of list) {
      await db.run(
        `INSERT INTO stocks (code, name, market, sector, industry, listed_shares)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name, market = EXCLUDED.market,
           sector = COALESCE(EXCLUDED.sector, stocks.sector),
           industry = COALESCE(EXCLUDED.industry, stocks.industry),
           listed_shares = COALESCE(EXCLUDED.listed_shares, stocks.listed_shares),
           updated_at = CURRENT_TIMESTAMP`,
        [s.code, s.name, s.market, s.sector, s.industry, s.listed_shares || null],
      );
      n++;
    }
    await sleep(300);
  }
  return n;
}

async function refreshPricesForAll() {
  const rows = await db.all(`SELECT code FROM stocks WHERE market IN ('KOSPI','KOSDAQ')`);
  let n = 0;
  for (const { code } of rows) {
    try {
      const prices = await data.getDailyPrices(code);
      for (const p of prices) {
        await db.run(
          `INSERT INTO daily_prices (code, date, open, high, low, close, volume, trading_value, market_cap)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT (code, date) DO NOTHING`,
          [code, String(p.date), p.open, p.high, p.low, p.close, p.volume, p.trading_value, p.market_cap],
        );
      }
      n += prices.length;
    } catch (e) {
      console.error(`[price] ${code} 실패:`, e.message);
    }
    await sleep(80);
  }
  return n;
}

async function refreshFundamentalsForAll() {
  const rows = await db.all(`SELECT code FROM stocks WHERE market IN ('KOSPI','KOSDAQ')`);
  let n = 0;
  for (const { code } of rows) {
    try {
      const f = await data.getFinance(code);
      if (!f) continue;
      const period = f.period || 'LATEST';
      await db.run(
        `INSERT INTO fundamentals
          (code, period, per, pbr, psr, eps, bps, roe, roa, revenue, operating_profit, net_profit, debt_ratio, dividend_yield)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (code, period) DO UPDATE SET
           per = EXCLUDED.per, pbr = EXCLUDED.pbr, psr = EXCLUDED.psr,
           eps = EXCLUDED.eps, bps = EXCLUDED.bps, roe = EXCLUDED.roe, roa = EXCLUDED.roa,
           revenue = EXCLUDED.revenue, operating_profit = EXCLUDED.operating_profit,
           net_profit = EXCLUDED.net_profit, debt_ratio = EXCLUDED.debt_ratio,
           dividend_yield = EXCLUDED.dividend_yield, updated_at = CURRENT_TIMESTAMP`,
        [code, period, f.per, f.pbr, f.psr, f.eps, f.bps, f.roe, f.roa,
         f.revenue, f.operating_profit, f.net_profit, f.debt_ratio, f.dividend_yield],
      );
      n++;
    } catch (e) {
      console.error(`[fund] ${code} 실패:`, e.message);
    }
    await sleep(100);
  }
  return n;
}

function writeJson(name, obj) {
  const p = path.join(DATA_DIR, name);
  fs.writeFileSync(p, JSON.stringify(obj));
  console.log(`  → ${name} (${(fs.statSync(p).size / 1024).toFixed(1)}KB)`);
}

async function exportStatic() {
  console.log('[export] 정적 JSON 생성...');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(STOCK_DIR, { recursive: true });

  // 메타
  const stats = await db.one(`
    SELECT
      (SELECT COUNT(*) FROM stocks WHERE market IN ('KOSPI','KOSDAQ')) AS stock_count,
      (SELECT COUNT(DISTINCT sector) FROM stocks WHERE sector IS NOT NULL) AS sector_count,
      (SELECT MAX(date) FROM daily_prices) AS last_price_date,
      (SELECT MAX(date) FROM factor_scores) AS last_score_date,
      (SELECT MAX(run_at) FROM update_log) AS last_update
  `);
  const markets = await db.all(`SELECT DISTINCT market FROM stocks ORDER BY market`);
  const sectors = await db.all(`SELECT DISTINCT sector FROM stocks WHERE sector IS NOT NULL ORDER BY sector`);
  writeJson('meta.json', { ...stats, markets: markets.map((m) => m.market), sectors: sectors.map((s) => s.sector) });

  // 지수 (KOSPI / KOSDAQ / KOSPI200)
  try {
    const idx = await indices.getAllIndices();
    writeJson('indices.json', idx);
  } catch (e) {
    console.error('[export] 지수 데이터 실패:', e.message);
    writeJson('indices.json', []);
  }

  // TOP 20 (재가중치 적용은 클라이언트)
  const top = await db.all(`
    SELECT fs.rank, fs.code, s.name, s.market, s.sector,
           fs.value_score, fs.momentum_score, fs.quality_score,
           fs.volatility_score, fs.growth_score, fs.total_score
    FROM factor_scores fs JOIN stocks s ON s.code = fs.code
    WHERE fs.date = (SELECT MAX(date) FROM factor_scores)
    ORDER BY fs.rank LIMIT ?`, [TOP_N_SHIPPED]);
  top.forEach((r) => (r.grade = scoring.gradeFor(r.total_score)));
  writeJson('top.json', top);

  // 전체 (클라이언트에서 필터링 + 재가중치)
  const all = await db.all(`
    SELECT fs.rank, fs.code, s.name, s.market, s.sector, s.industry,
           fs.value_score, fs.momentum_score, fs.quality_score,
           fs.volatility_score, fs.growth_score, fs.total_score
    FROM factor_scores fs JOIN stocks s ON s.code = fs.code
    WHERE fs.date = (SELECT MAX(date) FROM factor_scores)
    ORDER BY fs.code`);
  all.forEach((r) => (r.grade = scoring.gradeFor(r.total_score)));
  writeJson('all.json', all);

  // 섹터
  const sectorsData = await scoring.getSectorScores();
  const marketsData = await scoring.getMarketScores();
  writeJson('sectors.json', { sectors: sectorsData, markets: marketsData });

  // 히트맵
  const heatmap = await scoring.getHeatmap({ limit: HEATMAP_LIMIT });
  writeJson('heatmap.json', heatmap);

  // 상관관계
  const corr = await scoring.getFactorCorrelation();
  writeJson('correlation.json', { keys: corr.keys, matrix: corr.matrix });

  // 분포 (전체 점수)
  const dist = await db.all(`
    WITH latest AS (SELECT MAX(date) AS d FROM factor_scores)
    SELECT total_score FROM factor_scores, latest WHERE date = latest.d`);
  writeJson('distribution.json', { scores: dist.map((r) => r.total_score) });

  // 로그
  const logs = await db.all(`SELECT * FROM update_log ORDER BY id DESC LIMIT 10`);
  writeJson('log.json', logs);

  // 종목별 상세 (최근 90일 일봉만)
  console.log('[export] 종목별 상세 JSON 생성...');
  const stockList = await db.all(`SELECT code FROM stocks WHERE market IN ('KOSPI','KOSDAQ')`);
  for (const { code } of stockList) {
    const stock = await db.one(`SELECT * FROM stocks WHERE code = ?`, [code]);
    const score = await db.one(`
      SELECT * FROM factor_scores
      WHERE code = ? AND date = (SELECT MAX(date) FROM factor_scores WHERE code = ?)`, [code, code]);
    const fund = await db.all(`SELECT * FROM fundamentals WHERE code = ? ORDER BY period DESC LIMIT 4`, [code]);
    const prices = await db.all(`
      SELECT date, close, volume FROM daily_prices WHERE code = ?
      ORDER BY date DESC LIMIT ?`, [code, STOCK_HISTORY_DAYS]);
    const total = score?.total_score || 0;
    const detail = {
      stock, score: score ? { ...score, grade: scoring.gradeFor(total) } : null,
      fundamentals: fund, prices,
    };
    fs.writeFileSync(path.join(STOCK_DIR, `${code}.json`), JSON.stringify(detail));
  }
  console.log(`  → stock/*.json (${stockList.length}개)`);
}

(async () => {
  const t0 = Date.now();
  const isFull = process.env.FULL === '1' || !fs.existsSync(path.join(ROOT, 'data', 'quant.db'));
  console.log(`[update] 시작 (모드: ${isFull ? 'FULL' : 'INCREMENTAL'})`);

  await initSchema();

  let stocksN = 0, pricesN = 0, fundN = 0;
  try {
    if (isFull) {
      console.log('[update] 1/4 종목 목록...');
      stocksN = await refreshStocks();
      console.log(`     → ${stocksN}개`);

      console.log('[update] 2/4 일봉...');
      pricesN = await refreshPricesForAll();
      console.log(`     → ${pricesN} 행`);

      console.log('[update] 3/4 재무...');
      fundN = await refreshFundamentalsForAll();
      console.log(`     → ${fundN} 행`);
    } else {
      console.log('[update] 1/3 종목 목록 갱신...');
      stocksN = await refreshStocks();
      console.log(`     → ${stocksN}개`);

      console.log('[update] 2/3 최근 일봉 (누락분만)...');
      pricesN = await refreshPricesForAll();
      console.log(`     → ${pricesN} 행`);

      console.log('[update] 3/3 재무...');
      fundN = await refreshFundamentalsForAll();
      console.log(`     → ${fundN} 행`);
    }

    console.log('[update] 점수 계산...');
    const { rows } = await calculateAll();
    const scoreN = await persistScores(rows);
    console.log(`     → ${scoreN}개 점수`);

    // 로그 기록
    await db.run(
      `INSERT INTO update_log (status, message, stocks_updated, duration_ms)
       VALUES ('ok', ?, ?, ?)`,
      [`stocks=${stocksN} prices=${pricesN} fund=${fundN} scores=${scoreN}`,
       stocksN, Date.now() - t0],
    );

    console.log('[update] JSON 출력...');
    await exportStatic();

    const ms = Date.now() - t0;
    console.log(`[update] 완료. ${(ms / 1000).toFixed(1)}s`);

    await db.close();
    process.exit(0);
  } catch (e) {
    console.error('[update] 실패:', e);
    try {
      await db.run(
        `INSERT INTO update_log (status, message) VALUES ('error', ?)`,
        [String(e.message || e)],
      );
    } catch (_) { /* ignore */ }
    process.exit(1);
  }
})();
