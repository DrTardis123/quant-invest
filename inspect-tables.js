'use strict';
process.env.DUCKDB_READ_ONLY = '1';
const { all } = require('./src/db/connection');
(async () => {
  const t = await all("SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY table_name");
  console.log('tables:', t);
  // indices에서 KOSPI 데이터 찾기
  const i = await all("SELECT * FROM indices LIMIT 2");
  console.log('indices sample:', i);
  const i2 = await all("SHOW COLUMNS FROM indices");
  console.log('indices columns:', i2);
  process.exit(0);
})();
