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
      const r = await axios.get(url, {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': 'application/json',
          'Referer': 'https://m.stock.naver.com/',
        },
      });
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
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
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
  // KOSPI200은 모바일 API에서 409 (지원 안 함) — KOSPI만 fetch
  // KOSPI200 지수 데이터는 data/indices-5y.json에 kospi 필드로 저장

  fs.writeFileSync(
    path.join(ROOT, 'data', 'indices-5y.json'),
    JSON.stringify({
      kospi: kospi.map((k) => ({ date: k.date, close: k.close })),
      kospi200: [],  // KOSPI200은 모바일 API 미지원 (Naver desktop HTML 필요)
      kospi200Note: 'KOSPI200 모바일 API 미지원. KOSPI 지수만 저장.',
      fetchedAt: new Date().toISOString(),
    }),
  );

  console.log(`[fetch] KOSPI: ${kospi.length}일 (${kospi[0]?.date} ~ ${kospi[kospi.length - 1]?.date})`);
  console.log(`[fetch] KOSPI200: 모바일 API 미지원 (스킵)`);
  console.log(`[fetch] 완료. ${(Date.now() - t0) / 1000}s. → data/indices-5y.json`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
