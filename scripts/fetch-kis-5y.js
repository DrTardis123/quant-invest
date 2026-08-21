// KIS API 5년치 일봉 fetch (Top N 종목 × KOSPI/KOSDAQ)
// DB에 저장 (daily_prices 테이블)
'use strict';
process.chdir('C:/Users/LG/Documents/quant_invest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');
const { fetch5y, isPaper } = require('../src/data/kis');

const N = parseInt(process.env.N || '300', 10);
const MARKET = process.env.MARKET || 'BOTH'; // KOSPI | KOSDAQ | BOTH
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);
const INCREMENTAL = process.env.INCREMENTAL === 'true'; // true면 DB의 MAX(date) + 1일부터만 (매일 cron용)

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function dateToStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function addOneDay(yyyymmdd) {
  // 'YYYY-MM-DD' → 다음날 'YYYY-MM-DD'
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function fetchAndStore(code, name) {
  const t0 = Date.now();
  try {
    // 기존 데이터 범위 확인 (incremental 모드면 sinceDate 계산)
    const existing = await db.all(`SELECT MAX(date) AS m FROM daily_prices WHERE code = ?`, [code]);
    const lastExisting = existing[0]?.m ? dateToStr(existing[0].m) : null;
    const sinceDate = (INCREMENTAL && lastExisting) ? addOneDay(lastExisting) : null;

    // fetch5y 호출 (sinceDate 있으면 1페이지만 = 증분)
    const rows = await fetch5y(code, sinceDate);
    if (rows.length === 0) return { code, status: 'empty' };

    // INCREMENTAL이 아니면 (1회성 5년치) 마지막 기존일자 이후만 insert
    const toInsert = lastExisting
      ? rows.filter((r) => r.date > lastExisting)
      : rows;
    if (toInsert.length === 0) return { code, status: 'skip', kept: rows.length };

    // 일괄 insert
    const BATCH = 200;
    for (let j = 0; j < toInsert.length; j += BATCH) {
      const slice = toInsert.slice(j, j + BATCH);
      try {
        await db.run('BEGIN', []);
        for (const p of slice) {
          await db.run(
            `INSERT INTO daily_prices (code, date, open, high, low, close, volume, trading_value, market_cap)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT (code, date) DO UPDATE SET
               open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
               close = EXCLUDED.close, volume = EXCLUDED.volume,
               trading_value = EXCLUDED.trading_value`,
            [code, p.date, p.open, p.high, p.low, p.close, p.volume, p.trading_value || null]
          );
        }
        await db.run('COMMIT', []);
      } catch (e) {
        await db.run('ROLLBACK', []).catch(() => {});
      }
    }
    return { code, status: 'ok', inserted: toInsert.length, total: rows.length, elapsed: Date.now() - t0 };
  } catch (e) {
    return { code, status: 'error', error: e.message };
  }
}

(async () => {
  const t0 = Date.now();
  console.log(`[kis-5y] KIS API 5년치 fetch 시작 (N=${N}, market=${MARKET}, paper=${isPaper()})`);
  console.log(`[kis-5y] 키: ${process.env.KIS_APP_KEY ? 'OK' : '❌ 없음'}`);

  if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
    console.error('[kis-5y] KIS_APP_KEY / KIS_APP_SECRET 환경변수 필요');
    console.error('  .env에 추가하거나 GitHub Actions secrets에 등록 필요');
    process.exit(1);
  }

  // Top N 종목 (factor_scores 최신 total_score 기준)
  const markets = MARKET === 'BOTH' ? ['KOSPI', 'KOSDAQ'] : [MARKET];
  const allStocks = [];
  for (const m of markets) {
    const stocks = await db.all(`
      SELECT s.code, s.name
      FROM factor_scores fs
      JOIN stocks s ON fs.code = s.code
      WHERE s.market = ? AND fs.total_score IS NOT NULL
      ORDER BY fs.total_score DESC
      LIMIT ?
    `, [m, N]);
    allStocks.push(...stocks);
  }
  console.log(`[kis-5y] 대상: ${allStocks.length}개`);

  // 동시성 처리
  let done = 0, ok = 0, fail = 0, empty = 0, totalRows = 0;
  for (let i = 0; i < allStocks.length; i += CONCURRENCY) {
    const batch = allStocks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((s) => fetchAndStore(s.code, s.name)));
    for (const r of results) {
      done++;
      if (r.status === 'ok') { ok++; totalRows += r.inserted; }
      else if (r.status === 'error') { fail++; console.log(`  ! ${r.code}: ${r.error}`); if (fail === 1) console.log('     [hint] 일일 호출 한도(200건/일) 또는 초당 거래건수 초과일 수 있음. N을 줄이거나 며칠에 나눠 실행'); }
      else if (r.status === 'empty') { empty++; }
    }
    if (done % 10 === 0 || done === allStocks.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[kis-5y] ${done}/${allStocks.length} (ok=${ok} fail=${fail} empty=${empty} newRows=${totalRows} elapsed=${elapsed}s)`);
    }
    await sleep(200);
  }

  console.log(`[kis-5y] 완료. ok=${ok} fail=${fail} empty=${empty} totalRows=${totalRows} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await db.close();
})().catch((e) => { console.error('[kis-5y] fatal:', e.message); process.exit(1); });
