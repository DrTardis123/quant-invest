'use strict';
process.env.DUCKDB_READ_ONLY = '1';
const { all, get } = require('./src/db/connection');
(async () => {
  const a = await all("SELECT COUNT(*) AS c, COUNT(sector) AS s FROM stocks WHERE market='KOSPI'");
  console.log('stocks KOSPI:', a);
  const b = await all("SELECT COUNT(*) AS c, COUNT(per) AS p, COUNT(pbr) AS pb, COUNT(sector) AS s FROM stocks s LEFT JOIN fundamentals f ON f.code = s.code WHERE s.market='KOSPI'");
  console.log('KOSPI stock join fund:', b);
  const sample = await all("SELECT s.code, s.name, s.sector, f.per, f.pbr, f.dividend_yield FROM stocks s LEFT JOIN fundamentals f ON f.code = s.code WHERE s.market='KOSPI' AND (f.per IS NOT NULL OR s.sector IS NOT NULL) LIMIT 5");
  console.log('sample KOSPI:', sample);
  const kospi = await all("SELECT s.code, s.name, s.sector, f.per, f.pbr FROM stocks s LEFT JOIN fundamentals f ON f.code = s.code WHERE s.market='KOSPI' AND f.per IS NOT NULL LIMIT 3");
  console.log('KOSPI with PER:', kospi);
  await require('./src/db/connection').close?.();
})();
