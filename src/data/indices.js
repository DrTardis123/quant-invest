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

const INDICES = {
  KOSPI:    { code: 'KOSPI',    name: '코스피' },
  KOSDAQ:   { code: 'KOSDAQ',   name: '코스닥' },
  KOSPI200: { code: 'KOSPI200', name: '코스피200' },
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getIndex(market) {
  const meta = INDICES[market];
  if (!meta) return null;
  const url = `https://m.stock.naver.com/api/index/${encodeURIComponent(meta.code)}/price?pageSize=60&page=1`;
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

// 페이지네이션으로 과거 데이터 가져오기 (pageSize 60, 최대 30페이지 ≈ 7년치)
async function getIndexHistory(market, { days = 500, maxPages = 30, perPage = 60 } = {}) {
  const meta = INDICES[market];
  if (!meta) return [];
  const out = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://m.stock.naver.com/api/index/${encodeURIComponent(meta.code)}/price?pageSize=${perPage}&page=${page}`;
    try {
      const { data } = await http.get(url);
      if (!Array.isArray(data) || data.length === 0) break;
      let stop = false;
      for (const d of data) {
        const date = parseDate(d.localTradedAt || d.tradedAt);
        if (!date || seen.has(date)) continue;
        seen.add(date);
        out.push({
          date,
          close: toNum(d.closePrice),
          open: toNum(d.openPrice),
          high: toNum(d.highPrice),
          low: toNum(d.lowPrice),
          change: toNum(d.compareToPreviousClosePrice),
          changePct: toNum(d.fluctuationsRatio),
        });
        if (out.length >= days) { stop = true; break; }
      }
      if (stop) break;
      if (data.length < perPage) break;
    } catch (e) {
      console.error(`[indexHistory] ${market} page ${page} 실패:`, e.message);
      break;
    }
    await sleep(120);
  }
  // 오래된 → 최신
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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

module.exports = { getIndex, getAllIndices, getIndexHistory, INDICES };
