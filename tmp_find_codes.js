'use strict';
const { all } = require('./src/db/connection');
(async () => {
  const r = await all(
    "SELECT s.code FROM stocks s WHERE s.market = 'KOSPI' AND s.code NOT IN (SELECT DISTINCT code FROM investor_flow) ORDER BY s.code LIMIT 481"
  );
  console.log(JSON.stringify(r.map((x) => x.code)));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
