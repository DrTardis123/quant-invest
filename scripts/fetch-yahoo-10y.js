'use strict';
// Yahoo Finance에서 KOSPI 종목 10년치 일봉 fetch
// KOSPI 전체 (3921종목) → 10년치 = 약 1,119,586 × 10 = 11M rows (대략)
// 시간 절약: KOSPI 메인 + KOSDAQ 메인 = 약 500 종목 × 10년 = 충분
// Yahoo ticker: 005930.KS, 035420.KQ 등

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const axios = require('axios');
const { all, run } = require('../src/db/connection');
const cfg = require('../src/config');
const fs = require('fs');

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchYahooHistory(code, market, years = 10) {
  const ticker = `${code}.${market === 'KOSPI' ? 'KS' : 'KQ'}`;
  const period1 = Math.floor((Date.now() - years * 365 * 86400 * 1000) / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v7/finance/download/${ticker}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
  try {
    const resp = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.data || typeof resp.data !== 'string') return [];
    // CSV 파싱
    const lines = resp.data.trim().split('\n');
    if (lines.length < 2) return [];
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 6) continue;
      const date = parts[0];
      const open = Number(parts[1]);
      const high = Number(parts[2]);
      const low = Number(parts[3]);
      const close = Number(parts[4]);
      const adjClose = Number(parts[5]);
      const volume = Number(parts[6] || 0);
      if (!date || !isFinite(close) || close <= 0) continue;
      out.push({ date, open, high, low, close: adjClose || close, volume });
    }
    return out;
  } catch (e) {
    return [];
  }
}

async function main() {
  const limit = Number(process.argv[2]) || 200; // KOSPI 200
  const years = Number(process.argv[3]) || 10;
  console.log(`[yahoo-10y] KOSPI 시총 상위 ${limit}개, ${years}년치 일봉 fetch`);

  // KOSPI 시총 상위 (DB에 listed_shares가 없으면 일단 코드순)
  const rows = await all(`
    SELECT s.code, s.name, s.market
    FROM stocks s
    WHERE s.market = 'KOSPI'
    ORDER BY s.code
    LIMIT ?
  `, [limit]);
  console.log(`[yahoo-10y] 대상: ${rows.length}개`);

  let ok = 0, fail = 0, totalRows = 0;
  const t0 = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const data = await fetchYahooHistory(r.code, r.market, years);
    if (data.length === 0) { fail++; }
    else {
      // 일괄 insert
      const BATCH = 200;
      for (let j = 0; j < data.length; j += BATCH) {
        const slice = data.slice(j, j + BATCH);
        try {
          await run('BEGIN', []);
          for (const p of slice) {
            await run(
              `INSERT INTO daily_prices (code, date, open, high, low, close, volume, trading_value, market_cap)
               VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
               ON CONFLICT (code, date) DO UPDATE SET
                 open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                 close = EXCLUDED.close, volume = EXCLUDED.volume`,
              [r.code, p.date, p.open, p.high, p.low, p.close, p.volume]
            );
          }
          await run('COMMIT', []);
        } catch (e) {
          await run('ROLLBACK', []).catch(() => {});
        }
      }
      ok++;
      totalRows += data.length;
    }
    if ((i + 1) % 10 === 0 || (i + 1) === rows.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[yahoo-10y] ${i + 1}/${rows.length} (ok=${ok} fail=${fail} rows=${totalRows} elapsed=${elapsed}s)`);
    }
    await sleep(150);
  }
  console.log(`[yahoo-10y] 완료. ok=${ok} fail=${fail} totalRows=${totalRows} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await require('../src/db/connection').close?.();
}

main().catch((e) => {
  console.error('[yahoo-10y] fatal:', e.message);
  process.exit(1);
});
