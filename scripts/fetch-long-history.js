'use strict';

// Top N 종목 + KOSPI 일봉 N년치 fetch
// → 10년치 시뮬용

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const fs = require('fs');
const { getDailyPrices } = require('../src/data/naver');
const { getIndexHistory } = require('../src/data/indices');
const db = require('../src/db/connection');

const TOP_N = Number(process.env.TOP_N || 100);
const YEARS = Number(process.env.YEARS || 10);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const DAYS = YEARS * 365 + 30;
const FROM_DATE = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - YEARS);
  return d.toISOString().slice(0, 10);
})();

(async () => {
  const t0 = Date.now();
  console.log(`[long-fetch] Top ${TOP_N} 종목 + KOSPI 일봉 ${YEARS}년치 (${DAYS}일) fetch...`);

  // Top N: 시가총액 상위 (trading_value 기준)
  const top = await db.all(`
    SELECT s.code, s.name
    FROM stocks s
    WHERE s.market = 'KOSPI'
      AND s.code IN (SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) > 200)
    ORDER BY (
      SELECT AVG(volume * close) FROM daily_prices dp
      WHERE dp.code = s.code ORDER BY date DESC LIMIT 20
    ) DESC NULLS LAST
    LIMIT ?
  `, [TOP_N]);
  console.log(`  → Top ${top.length}개 선정`);

  // 1) 종목 일봉 fetch (concurrency)
  const errors = [];
  let done = 0;
  for (let i = 0; i < top.length; i += CONCURRENCY) {
    const batch = top.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (s) => {
      try {
        const arr = await getDailyPrices(s.code, { fromDate: FROM_DATE, maxPages: 80 });
        // DB에 INSERT
        if (arr && arr.length > 0) {
          await db.run('BEGIN');
          for (const r of arr) {
            await db.run(
              `INSERT INTO daily_prices (code, date, close, volume)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (code, date) DO UPDATE SET close = EXCLUDED.close, volume = EXCLUDED.volume`,
              [s.code, String(r.date), r.close, r.volume || null],
            );
          }
          await db.run('COMMIT');
        }
        done++;
        if (done % 10 === 0) console.log(`  → ${done}/${top.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      } catch (e) {
        errors.push({ code: s.code, msg: e.message });
        try { await db.run('ROLLBACK'); } catch (_) {}
      }
    }));
  }
  console.log(`  → 종목 일봉 fetch 완료: ${done}/${top.length} (${errors.length}개 실패)`);
  if (errors.length > 0) console.log(`  ! 실패: ${errors.slice(0, 5).map((e) => e.code).join(', ')}`);

  // 2) KOSPI 일봉 fetch
  console.log(`  → KOSPI 일봉 ${DAYS}일치 fetch...`);
  const kospi = await getIndexHistory('KOSPI', { days: DAYS });
  console.log(`  → KOSPI: ${kospi.length}일`);

  // data/long-history.json 저장
  fs.writeFileSync(
    path.join(ROOT, 'data', 'long-history.json'),
    JSON.stringify({
      top: top.map((s) => s.code),
      kospi: kospi.map((k) => ({ date: k.date, close: k.close })),
      years: YEARS,
      fetchedAt: new Date().toISOString(),
    }),
  );

  console.log(`[long-fetch] 완료. ${((Date.now() - t0) / 1000).toFixed(0)}s. → data/long-history.json`);
  await db.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
