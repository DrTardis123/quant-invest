'use strict';

// 한국 주요 지수 데이터 (네이버 금융)
// KOSPI / KOSDAQ / KOSPI200 일별 시세

const axios = require('axios');
const iconv = require('iconv-lite');

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

// 데스크톱 HTML로 최신값 + history 통합 가져오기
async function getIndexDesktopFull(market, { historyDays = 60 } = {}) {
  const meta = INDICES[market];
  if (!meta) return null;
  const desktopCode = market;
  try {
    // 1페이지에서 최신값 (상단 영역)
    const url = `https://finance.naver.com/sise/sise_index.naver?code=${desktopCode}`;
    const { data: htmlBuf } = await http.get(url, {
      responseType: 'arraybuffer',
      headers: { 'Referer': 'https://finance.naver.com/' },
    });
    const html = iconv.decode(Buffer.from(htmlBuf), 'EUC-KR');

    // 지수값 추출: <em id="now_value">...</em>
    const valueM = /id="now_value"[^>]*>([\d,\.]+)</.exec(html);
    // 전일대비: <em id="change_value">...</em>
    const changeM = /id="change_value"[^>]*>([\-\d,\.]+)</.exec(html);
    const changePctM = /id="change_rate"[^>]*>([\-\d,\.%]+)</.exec(html);
    // 기준일: <em id="time">YYYY.MM.DD HH:MM:DD</em>
    const asOfM = /id="time"[^>]*>(\d{4}\.\d{2}\.\d{2})/.exec(html);

    if (!valueM) return null;

    // 부호 확인: <em id="change_value" class="up"> or "dn" ...
    let sign = 1;
    const signM = /id="change_(?:value|rate)"[^>]*class="([^"]*)"/.exec(html);
    if (signM) {
      const cls = signM[1];
      if (cls.includes('dn') || cls.includes('down') || cls.includes('minus')) sign = -1;
      else if (cls.includes('up') || cls.includes('plus')) sign = 1;
    }
    // 별도 image 검사: <img src="ico_down.gif" 등
    if (/<img[^>]*ico_down[^>]*>/.test(html) || /<img[^>]*ico_minus[^>]*>/.test(html)) sign = -1;
    if (/<img[^>]*ico_up[^>]*>/.test(html) || /<img[^>]*ico_plus[^>]*>/.test(html)) sign = 1;

    const value = toNum(valueM[1]);
    const changeRaw = toNum(changeM ? changeM[1] : null);
    const change = changeRaw !== null ? changeRaw * sign : null;
    const changePctRaw = changePctM ? toNum(changePctM[1].replace('%', '')) : null;
    const changePct = changePctRaw !== null ? changePctRaw * sign : null;
    const asOf = asOfM ? parseDate(asOfM[1]) : null;

    // 2) history는 별도 페이지네이션
    const history = await getIndexHistoryDesktop(market, { days: historyDays });

    return {
      market,
      name: meta.name,
      value,
      change,
      changePct,
      open: null,
      high: null,
      low: null,
      volume: null,
      asOf,
      history,
    };
  } catch (e) {
    console.error(`[indexDesktop] ${market} 실패:`, e.message);
    return null;
  }
}

async function getIndex(market) {
  const meta = INDICES[market];
  if (!meta) return null;
  // 1) mobile API 먼저
  const url = `https://m.stock.naver.com/api/index/${encodeURIComponent(meta.code)}/price?pageSize=60&page=1`;
  try {
    const { data } = await http.get(url);
    if (Array.isArray(data) && data.length > 0) {
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
    }
  } catch (e) {
    // 2) desktop HTML 폴백
    console.log(`[index] ${market} mobile fail, desktop fallback...`);
    return await getIndexDesktopFull(market);
  }
  // 빈 mobile API → desktop
  return await getIndexDesktopFull(market);
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
  // 1) mobile API 시도
  const meta = INDICES[market];
  if (!meta) return [];
  let out = [];
  let stop = false;
  let lastErr = null;

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://m.stock.naver.com/api/index/${encodeURIComponent(meta.code)}/price?pageSize=${perPage}&page=${page}`;
    try {
      const { data } = await http.get(url);
      if (!Array.isArray(data) || data.length === 0) { stop = true; break; }
      for (const d of data) {
        const date = parseDate(d.localTradedAt || d.tradedAt);
        if (!date) continue;
        if (out.find((o) => o.date === date)) continue;
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
      lastErr = e.message;
      break;
    }
    await sleep(120);
  }

  if (out.length >= 20) {
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }

  // 2) mobile API 실패 → 데스크톱 HTML 폴백
  console.log(`[indexHistory] ${market} mobile API fail (${out.length}건), 데스크톱 HTML 시도...`);
  return await getIndexHistoryDesktop(market, { days });
}

async function getIndexHistoryDesktop(market, { days = 500 } = {}) {
  const meta = INDICES[market];
  if (!meta) return [];
  // KOSPI/KOSDAQ/KOSPI200 데스크톱 코드 매핑
  const desktopCode = { KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', KOSPI200: 'KOSPI200' }[market] || 'KOSPI';
  const out = [];
  const seen = new Set();
  const maxPages = Math.ceil(days / 6) + 2;

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://finance.naver.com/sise/sise_index_day.naver?code=${desktopCode}&page=${page}`;
    try {
      const { data } = await http.get(url, {
        responseType: 'arraybuffer',
        headers: { 'Referer': 'https://finance.naver.com/' },
      });
      const html = iconv.decode(Buffer.from(data), 'EUC-KR');
      // 행 파싱: <tr><td class="date">...</td><td class="number_1">...</td>...
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      let m;
      let pageCount = 0;
      while ((m = rowRe.exec(html)) !== null) {
        const row = m[1];
        const dateM = /class="date"[^>]*>(\d{4}\.\d{2}\.\d{2})/.exec(row);
        const numMs = [...row.matchAll(/<td class="number_1"[^>]*>([\d,\.]+)<\/td>/g)];
        if (!dateM || numMs.length < 1) continue;
        const date = dateM[1].replace(/\./g, '-');
        if (seen.has(date)) continue;
        seen.add(date);
        const close = toNum(numMs[0][1]);
        if (!close) continue;
        out.push({ date, close, open: null, high: null, low: null, change: null, changePct: null });
        pageCount++;
        if (out.length >= days) break;
      }
      if (pageCount === 0) break;
      await sleep(150);
    } catch (e) {
      console.error(`[indexHistoryDesktop] ${market} page ${page} 실패:`, e.message);
      break;
    }
    if (out.length >= days) break;
  }
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

module.exports = { getIndex, getAllIndices, getIndexHistory, getIndexHistoryDesktop, getIndexDesktopFull, INDICES };
