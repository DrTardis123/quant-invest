'use strict';

// KOSPI200 일봉 5년치 fetch (KOSPI 지수)
// → optimize-weights.js에 활용

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const fs = require('fs');
const axios = require('axios');

const KOSPI200_CODE = 'KOSPI200';  // mobile API code

async function fetchKospiIndex(code, days) {
  const out = [];
  const seen = new Set();
  const perPage = 60;
  const maxPages = Math.ceil(days / perPage) + 2;

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://m.stock.naver.com/api/index/${encodeURIComponent(code)}/price?pageSize=${perPage}&page=${page}`;
    try {
      const r = await axios.get(url, { timeout: 8000 });
      if (!Array.isArray(r.data) || r.data.length === 0) break;
      for (const d of r.data) {
        const date = parseDate(d.localTradedAt || d.tradedAt);
        if (!date || seen.has(date)) continue;
        seen.add(date);
        out.push({ date, close: Number(String(d.closePrice).replace(/,/g, '')) });
        if (out.length >= days) break;
      }
      if (out.length >= days) break;
      if (r.data.length < perPage) break;
    } catch (e) {
      console.error(`[fetch] ${code} page ${page} 실패:`, e.message);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

function parseDate(s) {
  if (!s) return null;
  let m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(String(s));
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s));
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

(async () => {
  const days = Number(process.env.DAYS || 1300);  // ~5년
  console.log(`[fetch] KOSPI/KOSPI200 일봉 ${days}일치 fetch...`);
  const t0 = Date.now();

  const kospi = await fetchKospiIndex('KOSPI', days);
  const kospi200 = await fetchKospiIndex('KOSPI200', days);

  fs.writeFileSync(
    path.join(ROOT, 'data', 'indices-5y.json'),
    JSON.stringify({
      kospi: kospi.map((k) => ({ date: k.date, close: k.close })),
      kospi200: kospi200.map((k) => ({ date: k.date, close: k.close })),
      fetchedAt: new Date().toISOString(),
    }),
  );

  console.log(`[fetch] KOSPI: ${kospi.length}일 (${kospi[0]?.date} ~ ${kospi[kospi.length - 1]?.date})`);
  console.log(`[fetch] KOSPI200: ${kospi200.length}일 (${kospi200[0]?.date} ~ ${kospi200[kospi200.length - 1]?.date})`);
  console.log(`[fetch] 완료. ${(Date.now() - t0) / 1000}s. → data/indices-5y.json`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
