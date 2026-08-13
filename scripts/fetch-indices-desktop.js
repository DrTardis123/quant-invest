'use strict';

// KOSPI/KOSDAQ 일봉 desktop HTML fetch → indices.json 갱신
// Naver mobile API 409 우회

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const fs = require('fs');
const axios = require('axios');
const iconv = require('iconv-lite');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const http = axios.create({
  timeout: 10000,
  headers: {
    'User-Agent': UA,
    'Referer': 'https://finance.naver.com/',
  },
  responseType: 'arraybuffer',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchIndexDesktop(code, days = 90) {
  const out = [];
  const seen = new Set();
  const maxPages = Math.ceil(days / 6) + 2;

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://finance.naver.com/sise/sise_index_day.naver?code=${code}&page=${page}`;
    try {
      const { data } = await http.get(url);
      const html = iconv.decode(Buffer.from(data), 'EUC-KR');
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      let m;
      let count = 0;
      while ((m = rowRe.exec(html)) !== null) {
        const row = m[1];
        const dateM = /class="date"[^>]*>(\d{4}\.\d{2}\.\d{2})/.exec(row);
        const numMs = [...row.matchAll(/<td class="number_1"[^>]*>([\d,\.]+)<\/td>/g)];
        if (!dateM || numMs.length < 1) continue;
        const date = dateM[1].replace(/\./g, '-');
        if (seen.has(date)) continue;
        seen.add(date);
        const close = Number(String(numMs[0][1]).replace(/,/g, ''));
        if (!close || !Number.isFinite(close)) continue;
        out.push({ date, close });
        count++;
        if (out.length >= days) break;
      }
      if (count === 0) break;
      await sleep(150);
    } catch (e) {
      console.error(`[fetchIndex] ${code} page ${page} 실패:`, e.message);
      break;
    }
    if (out.length >= days) break;
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

(async () => {
  console.log('[fetch] KOSPI/KOSDAQ 일봉 desktop HTML fetch...');
  const kospi = await fetchIndexDesktop('KOSPI', 90);
  const kosdaq = await fetchIndexDesktop('KOSDAQ', 90);
  console.log(`[fetch] KOSPI: ${kospi.length}일, KOSDAQ: ${kosdaq.length}일`);

  // 가장 최근 값
  const kospiLast = kospi[kospi.length - 1];
  const kosdaqLast = kosdaq[kosdaq.length - 1];

  // 1일 전 값으로 change 계산
  const calcChange = (arr) => {
    if (arr.length < 2) return { change: null, changePct: null };
    const last = arr[arr.length - 1].close;
    const prev = arr[arr.length - 2].close;
    return { change: last - prev, changePct: ((last - prev) / prev) * 100 };
  };
  const kospiChg = calcChange(kospi);
  const kosdaqChg = calcChange(kosdaq);

  const data = [
    {
      market: 'KOSPI',
      name: '코스피',
      value: kospiLast.close,
      change: kospiChg.change,
      changePct: parseFloat(kospiChg.changePct.toFixed(2)),
      open: null, high: null, low: null, volume: null,
      asOf: kospiLast.date,
      history: kospi,
    },
    {
      market: 'KOSDAQ',
      name: '코스닥',
      value: kosdaqLast.close,
      change: kosdaqChg.change,
      changePct: parseFloat(kosdaqChg.changePct.toFixed(2)),
      open: null, high: null, low: null, volume: null,
      asOf: kosdaqLast.date,
      history: kosdaq,
    },
  ];

  fs.writeFileSync(path.join(ROOT, 'public', 'data', 'indices.json'), JSON.stringify(data));
  console.log(`[fetch] KOSPI: ${kospiLast.close} (${kospiChg.changePct.toFixed(2)}%, ${kospiLast.date})`);
  console.log(`[fetch] KOSDAQ: ${kosdaqLast.close} (${kosdaqChg.changePct.toFixed(2)}%, ${kosdaqLast.date})`);
  console.log('[fetch] → public/data/indices.json');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
