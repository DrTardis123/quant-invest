const init = require('./src/db/init');
const db = require('./src/db/connection');
const data = require('./src/data');
(async () => {
  await init.initSchema();
  const r = await db.one('SELECT MAX(id) AS max_id FROM update_log');
  console.log('update_log max_id:', r && r.max_id);
  try {
    await db.run("INSERT INTO update_log (status, message) VALUES ('test', 'ok')");
    console.log('insert OK');
    const r2 = await db.one('SELECT MAX(id) AS max_id FROM update_log');
    console.log('after insert, max_id:', r2 && r2.max_id);
  } catch (e) {
    console.log('insert FAIL:', e.message);
  }
  await db.run('DELETE FROM update_log');
  // test new data functions
  try {
    const f = await data.getInvestorFlow('005930', { days: 3 });
    console.log('getInvestorFlow OK, rows:', f.length);
  } catch (e) {
    console.log('getInvestorFlow FAIL:', e.message);
  }
  await db.close();
})().catch(e => console.error('ERR:', e.message));
