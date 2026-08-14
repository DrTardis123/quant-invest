'use strict';
const { all } = require('./src/db/connection');
(async () => {
  const r = await all(`SELECT s.market,
    COUNT(*) AS total,
    SUM(CASE WHEN f.per IS NULL THEN 1 ELSE 0 END) AS no_per,
    SUM(CASE WHEN f.dividend_yield IS NULL THEN 1 ELSE 0 END) AS no_dvr,
    SUM(CASE WHEN s.sector IS NULL OR s.sector = '' THEN 1 ELSE 0 END) AS no_sec
  FROM stocks s LEFT JOIN fundamentals f ON s.code = f.code
  WHERE s.market IN ('KOSPI','KOSDAQ') GROUP BY s.market`);
  console.log('=== stocks coverage ===');
  for (const x of r) console.log(x);
  const r2 = await all(`SELECT COUNT(DISTINCT code) AS n FROM investor_flow`);
  console.log('investor_flow distinct codes:', r2[0]);
  const r3 = await all(`SELECT s.market, COUNT(DISTINCT s.code) AS n
    FROM stocks s WHERE s.code NOT IN (SELECT code FROM investor_flow)
    AND s.market IN ('KOSPI','KOSDAQ') GROUP BY s.market`);
  console.log('=== stocks without investor_flow ===');
  for (const x of r3) console.log(x);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
