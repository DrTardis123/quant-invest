'use strict';

// 한국 주요 지수 데이터 (네이버 금융)
// KOSPI / KOSDAQ / KOSPI200 일별 시세

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const http = axios.create({
  timeout: 10000,
  headers: {
    'User-Agent': UA,
    'Referer': 'https://m.stock.naver.com/',
    'Accept': 'application/json,text/plain,*/*',
  },
});

// 네이버 모바일의 market 코드
const INDICES = {
  KOSPI:    { code: 'KOSPI',    name: '코스피' },
  KOSDAQ:   { code: 'KOSDAQ',   name: '코스닥' },
  KOSPI200: { code: 'KOSPI200', name: '코스피200' },
};

async function getIndex(market) {
  const meta = INDICES[market];
  if (!meta) return null;
  const url = `https://m.stock.naver.com/api/index/${encodeURIComponent(meta.code)}/price?pageSize=20&page=1`;
  try {
    const { data } = await http.get(url);
    if (!Array.isArray(data) || data.length === 0) return null;

    const latest = data[0];
    const closes = data.map((d) => ({
      date: parseDate(d.localTradedAt || d.tradedAt),
      close: toNum(d.closePrice),
    })).filter((d) => d.date && d.close !== null);

    return {
      market,
      name: meta.name,
      value: toNum(latest.closePrice),
      change: toNum(latest.compareToPreviousClosePrice),
      changePct: toNum(latest.fluctuationsRatio),
      open: toNum(latest.openPrice),
      high: toNum(latest.highPrice),
      low: toNum(latest.lowPrice),
      volume: toInt(latest.accumulatedTradingVolume),
      asOf: parseDate(latest.localTradedAt || latest.tradedAt),
      history: closes,
    };
  } catch (e) {
    console.error(`[index] ${market} 실패:`, e.message);
    return null;
  }
}

async function getAllIndices() {
  const results = await Promise.allSettled([
    getIndex('KOSPI'),
    getIndex('KOSDAQ'),
    getIndex('KOSPI200'),
  ]);
  return results
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value);
}

function parseDate(s) {
  if (!s) return null;
  let m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(String(s));
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s));
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[, %]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

module.exports = { getIndex, getAllIndices, INDICES };
