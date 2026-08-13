'use strict';
process.env.DUCKDB_READ_ONLY = '1';
const { all } = require('./src/db/connection');
(async () => {
  // 일봉 데이터 기간
  const r1 = await all(`
    SELECT MIN(date) AS min_d, MAX(date) AS max_d, COUNT(*) AS total,
           COUNT(DISTINCT code) AS codes
    FROM daily_prices
  `);
  console.log('daily_prices:', r1);
  // 일자별 카운트
  const r2 = await all(`
    SELECT year, COUNT(DISTINCT code) AS codes
    FROM (SELECT code, CAST(SUBSTR(CAST(date AS VARCHAR),1,4) AS INT) AS year FROM daily_prices)
    GROUP BY year ORDER BY year
  `);
  console.log('연도별 종목수:', r2);
  // 종목별 데이터 일수
  const r3 = await all(`
    SELECT code, COUNT(*) AS days, MIN(date) AS from_d, MAX(date) AS to_d
    FROM daily_prices GROUP BY code ORDER BY days DESC LIMIT 5
  `);
  console.log('top5 longest:', r3);
  // KOSPI 200 시총 상위
  const r4 = await all(`
    SELECT s.code, s.name FROM stocks s
    WHERE s.market = 'KOSPI' ORDER BY s.code LIMIT 5
  `);
  console.log('KOSPI first 5:', r4);
  await require('./src/db/connection').close?.();
})();
