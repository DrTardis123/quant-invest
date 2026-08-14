'use strict';
// Naver 데스크톱 일봉 페이지네이션으로 5년치 fetch
// KOSPI 100개 (코드순) × 5년치 = 100 × 182페이지 = 18,200 페이지
// 1페이지 = ~200ms → 18,200 × 200ms = 3,640s = ~60분

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const naver = require('../src/data/naver');
const { all, run } = require('../src/db/connection');
const { isExcludedProduct } = require('../src/factors');

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const limit = Number(process.argv[2]) || 100;
  const years = Number(process.argv[3]) || 2;
  // Naver 일봉 페이지는 30페이지(300일) cap → 1.2년치만 fetch 가능
  const maxPages = Math.min(30, Math.ceil(years * 252 / 10));
  console.log(`[naver-5y] KOSPI ${limit}개, ${years}년치 (최대 ${maxPages}페이지/종목, 30페이지 cap)`);

  const rows = await all(`
    SELECT s.code, s.name FROM stocks s
    WHERE s.market = 'KOSPI' AND s.name NOT LIKE '%우%'
    ORDER BY s.code LIMIT ?
  `, [limit]);
  const filtered = rows.filter((r) => !isExcludedProduct(r.name));
  console.log(`[naver-5y] 대상: ${filtered.length}개 (ETF/우선주/액티브 제외)`);

  let ok = 0, fail = 0, totalRows = 0;
  const t0 = Date.now();
  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    try {
      const prices = await naver.getDailyPrices(r.code, { maxPages });
      if (prices.length === 0) { fail++; continue; }
      // 기존 데이터 범위 확인 (이미 있으면 스킵)
      const existing = await all(`SELECT MAX(date) AS m FROM daily_prices WHERE code = ?`, [r.code]);
      const lastExisting = existing[0]?.m ? String(existing[0].m).slice(0, 10) : null;
      const toInsert = lastExisting
        ? prices.filter((p) => p.date > lastExisting)
        : prices;
      if (toInsert.length === 0) { ok++; continue; }
      const BATCH = 200;
      for (let j = 0; j < toInsert.length; j += BATCH) {
        const slice = toInsert.slice(j, j + BATCH);
        try {
          await run('BEGIN', []);
          for (const p of slice) {
            await run(
              `INSERT INTO daily_prices (code, date, open, high, low, close, volume, trading_value, market_cap)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
               ON CONFLICT (code, date) DO UPDATE SET
                 open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                 close = EXCLUDED.close, volume = EXCLUDED.volume,
                 trading_value = EXCLUDED.trading_value`,
              [r.code, p.date, p.open, p.high, p.low, p.close, p.volume, p.trading_value || null]
            );
          }
          await run('COMMIT', []);
        } catch (e) {
          await run('ROLLBACK', []).catch(() => {});
        }
      }
      ok++;
      totalRows += toInsert.length;
    } catch (e) {
      fail++;
    }
    if ((i + 1) % 5 === 0 || (i + 1) === filtered.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[naver-5y] ${i + 1}/${filtered.length} (ok=${ok} fail=${fail} newRows=${totalRows} elapsed=${elapsed}s)`);
    }
    await sleep(200);
  }
  console.log(`[naver-5y] 완료. ok=${ok} fail=${fail} newRows=${totalRows} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await require('../src/db/connection').close?.();
}

main().catch((e) => {
  console.error('[naver-5y] fatal:', e.message);
  process.exit(1);
});
