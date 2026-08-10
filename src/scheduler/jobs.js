'use strict';

const cron = require('node-cron');
const cfg = require('../config');
const db = require('../db/connection');
const { initSchema } = require('../db/init');
const data = require('../data');
const { calculateAll, persistScores } = require('../factors');
const { run } = db;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nextDay(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return null;
  const d = new Date(yyyy_mm_dd);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function refreshStocks() {
  let n = 0;
  for (const market of cfg.data.markets) {
    const list = await data.listStocks(market);
    for (const s of list) {
      await run(
        `INSERT INTO stocks (code, name, market, sector, industry, listed_shares)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           market = EXCLUDED.market,
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
  // **증분 fetch**: 마지막 저장일 +1 부터만 다운로드 (시간/네트워크 대폭 절약)
  const rows = await db.all(`SELECT code FROM stocks WHERE market IN ('KOSPI','KOSDAQ')`);
  let n = 0;
  for (const { code } of rows) {
    try {
      const last = await db.one(`SELECT MAX(date) AS d FROM daily_prices WHERE code = ?`, [code]);
      const fromDate = nextDay(last?.d ? String(last.d) : null);
      const prices = await data.getDailyPrices(code, { fromDate });
      if (prices.length === 0) continue;
      for (const p of prices) {
        await run(
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
    await sleep(60);
  }
  return n;
}

async function refreshFundamentalsForAll() {
  // **증분 fetch**: 30일 이내 갱신된 종목은 스킵 (재무는 자주 안 바뀜)
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = await db.all(`
    SELECT s.code, MAX(f.updated_at) AS last_update
    FROM stocks s LEFT JOIN fundamentals f ON f.code = s.code
    WHERE s.market IN ('KOSPI','KOSDAQ')
    GROUP BY s.code
  `);
  let n = 0, skipped = 0;
  for (const { code, last_update } of rows) {
    if (last_update && new Date(last_update).toISOString() > cutoff) { skipped++; continue; }
    try {
      const f = await data.getFinance(code);
      if (!f) continue;
      const period = f.period || 'LATEST';
      await run(
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
    await sleep(80);
  }
  console.log(`[fund] ${n}개 갱신, ${skipped}개 30일 내 (스킵)`);
  return n;
}

async function runUpdate({ skipStocks = false, skipPrices = false, skipFundamentals = false } = {}) {
  const t0 = Date.now();
  let logId;
  await run(
    `INSERT INTO update_log (status, message) VALUES ('running', 'started')`,
  );
  logId = (await db.one(`SELECT MAX(id) AS id FROM update_log`))?.id;

  let stocksN = 0, pricesN = 0, fundN = 0, scoreN = 0;
  try {
    if (!skipStocks) {
      console.log('[update] 종목 목록 갱신...');
      stocksN = await refreshStocks();
    }
    if (!skipPrices) {
      console.log('[update] 일봉 갱신...');
      pricesN = await refreshPricesForAll();
    }
    if (!skipFundamentals) {
      console.log('[update] 재무 갱신...');
      fundN = await refreshFundamentalsForAll();
    }
    console.log('[update] 점수 계산...');
    const { rows } = await calculateAll();
    scoreN = await persistScores(rows);
    const ms = Date.now() - t0;
    await run(
      `UPDATE update_log SET status=?, message=?, stocks_updated=?, duration_ms=? WHERE id=?`,
      ['ok', `stocks=${stocksN} prices=${pricesN} fund=${fundN} scores=${scoreN}`,
       stocksN, ms, logId],
    );
    console.log(`[update] 완료 (${(ms / 1000).toFixed(1)}s) stocks=${stocksN} prices=${pricesN} fund=${fundN} scores=${scoreN}`);
    return { stocksN, pricesN, fundN, scoreN, ms };
  } catch (e) {
    await run(
      `UPDATE update_log SET status=?, message=? WHERE id=?`,
      ['error', String(e.message || e), logId],
    );
    console.error('[update] 실패:', e);
    throw e;
  }
}

function schedule() {
  const { hour, minute } = cfg.schedule;
  const expr = `${minute} ${hour} * * 1-5`; // 평일
  console.log(`[cron] 평일 ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} (KST) 자동 갱신 등록`);
  cron.schedule(expr, async () => {
    console.log('[cron] 자동 갱신 시작');
    try {
      await runUpdate();
    } catch (e) {
      console.error('[cron] 자동 갱신 실패:', e.message);
    }
  }, { timezone: 'Asia/Seoul' });
}

module.exports = { runUpdate, schedule, refreshStocks, refreshPricesForAll, refreshFundamentalsForAll };

// CLI: node src/scheduler/jobs.js --once
if (require.main === module) {
  (async () => {
    await initSchema();
    if (process.argv.includes('--once')) {
      await runUpdate();
      process.exit(0);
    } else if (process.argv.includes('--stocks')) {
      console.log(await refreshStocks(), 'stocks');
      process.exit(0);
    } else if (process.argv.includes('--prices')) {
      console.log(await refreshPricesForAll(), 'rows');
      process.exit(0);
    } else if (process.argv.includes('--fund')) {
      console.log(await refreshFundamentalsForAll(), 'rows');
      process.exit(0);
    } else {
      schedule();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
