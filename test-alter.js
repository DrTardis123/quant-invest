const { all, run, close } = require('./src/db/connection');

(async () => {
  try {
    await run('CREATE TABLE IF NOT EXISTS _t (a INT)');
    await run('ALTER TABLE _t ADD COLUMN IF NOT EXISTS b INT');
    await run('ALTER TABLE _t ADD COLUMN IF NOT EXISTS b INT');
    await run('INSERT INTO _t VALUES (1, 2)');
    const r = await all('SELECT * FROM _t');
    console.log('OK ADD COLUMN IF NOT EXISTS supported. row:', r);
    await run('DROP TABLE _t');
  } catch (e) {
    console.log('FAIL:', e.message);
  }
  await close();
})();
