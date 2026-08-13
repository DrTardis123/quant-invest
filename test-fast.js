const path = require('path');
process.chdir('C:\\Users\\LG\\Documents\\quant_invest');

const db = require('./src/db/connection');
const data = require('./src/data');
const init = require('./src/db/init');

(async () => {
  await init.initSchema();
  const rows = await db.all(`SELECT code FROM stocks WHERE market IN ('KOSPI','KOSDAQ') LIMIT 5`);
  console.log('Testing with 5 stocks:', rows.map(r => r.code).join(', '));
  const t0 = Date.now();
  let total = 0;
  await Promise.all(rows.map(async ({ code }) => {
    const t1 = Date.now();
    const prices = await data.getDailyPrices(code, { maxPages: 1 });
    const elapsed = Date.now() - t1;
    console.log(`  ${code}: ${prices.length} rows in ${elapsed}ms`);
    total += prices.length;
  }));
  console.log(`Total: ${total} rows in ${(Date.now() - t0)}ms (parallel)`);

  // Sequential for comparison
  const t2 = Date.now();
  let total2 = 0;
  for (const { code } of rows) {
    const prices = await data.getDailyPrices(code, { maxPages: 1 });
    total2 += prices.length;
  }
  console.log(`Sequential: ${total2} rows in ${(Date.now() - t2)}ms`);
  console.log(`Speedup: ${((Date.now() - t2) / (Date.now() - t0)).toFixed(1)}x`);

  await db.close();
})().catch(e => console.error('ERR:', e.message));
