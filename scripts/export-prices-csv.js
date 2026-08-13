'use strict';
// DuckDB에서 가격 데이터를 CSV로 export (DuckDB lock 회피용)
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const fs = require('fs');
const { all } = require('../src/db/connection');

async function main() {
  const csvDir = path.join(ROOT, 'public', 'data', 'csv-cache');
  fs.mkdirSync(csvDir, { recursive: true });

  const stocks = await all(`
    SELECT s.code FROM stocks s
    WHERE s.market = 'KOSPI' AND s.name NOT LIKE '%우%'
    ORDER BY s.code LIMIT 200
  `);
  const codes = stocks.map((s) => s.code);
  console.log(`[csv] KOSPI ${codes.length}개 export`);

  const prices = await all(`
    SELECT code, date, close, volume FROM daily_prices
    WHERE code IN (${codes.map(() => '?').join(',')})
    ORDER BY code, date
  `, codes);
  console.log(`[csv] prices: ${prices.length}행`);

  const kospiHistory = await all(`SELECT date, close FROM indices WHERE market = 'KOSPI' ORDER BY date`).catch(() => []);
  console.log(`[csv] kospi(indices): ${kospiHistory.length}행`);
  // fallback: indices.json
  if (kospiHistory.length === 0) {
    const idxPath = path.join(ROOT, 'public', 'data', 'indices.json');
    if (fs.existsSync(idxPath)) {
      const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
      // indices.json: [{ market, history: [{date, close}] }]
      const kospiArr = Array.isArray(idx) ? idx.find((x) => x.market === 'KOSPI') : null;
      if (kospiArr && kospiArr.history) {
        for (const k of kospiArr.history) kospiHistory.push({ date: k.date, close: k.close });
      }
      console.log(`[csv] kospi(indices.json): ${kospiHistory.length}행`);
    }
  }

  // CSV
  const lines = ['code,date,close,volume'];
  for (const p of prices) {
    lines.push(`${p.code},${String(p.date).slice(0, 10)},${Number(p.close)},${Number(p.volume) || 0}`);
  }
  fs.writeFileSync(path.join(csvDir, `prices-${new Date().toISOString().slice(0, 10)}.csv`), lines.join('\n'));

  const klines = ['date,close'];
  for (const k of kospiHistory) klines.push(`${String(k.date).slice(0, 10)},${Number(k.close)}`);
  fs.writeFileSync(path.join(csvDir, `kospi-${new Date().toISOString().slice(0, 10)}.csv`), klines.join('\n'));

  console.log(`[csv] 완료: ${path.join(csvDir)}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
