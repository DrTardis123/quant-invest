'use strict';

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': UA,
    'Referer': 'https://m.stock.naver.com/',
    'Accept': 'application/json,text/plain,*/*',
  },
});

const BASE = 'https://m.stock.naver.com/api/stock';

// 시장별 종목 목록 (페이지네이션)
async function listStocks(market) {
  const out = [];
  const pageSize = 100;
  for (let page = 1; ; page++) {
    const url = `${BASE}/marketList/${encodeURIComponent(market)}?page=${page}&pageSize=${pageSize}`;
    const { data } = await http.get(url);
    if (!Array.isArray(data) || data.length === 0) break;
    for (const it of data) {
      out.push({
        code: String(it.code || it.stockCode || '').padStart(6, '0'),
        name: it.stockName || it.name || it.koreanName || '',
        market,
        sector: it.sector || null,
        industry: it.industry || null,
        listed_shares: it.listedShareCount || null,
      });
    }
    if (data.length < pageSize) break;
  }
  return out;
}

// 종목 기본 정보
async function getBasic(code) {
  const url = `${BASE}/${encodeURIComponent(code)}/basic`;
  const { data } = await http.get(url);
  return data || null;
}

// 일봉 (페이지네이션, pageSize 최대 60)
async function getDailyPrices(code, { fromDate = null, toDate = null, maxPages = 30 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/${encodeURIComponent(code)}/price?pageSize=60&page=${page}`;
    const { data } = await http.get(url);
    if (!Array.isArray(data) || data.length === 0) break;

    let stop = false;
    for (const r of data) {
      // r.localTradedAt: "2024.05.31" 형식
      const date = parseNaverDate(r.localTradedAt || r.tradedAt);
      if (!date) continue;
      if (fromDate && date < fromDate) { stop = true; break; }
      if (toDate && date > toDate) continue;
      out.push({
        date,
        open: toInt(r.openPrice),
        high: toInt(r.highPrice),
        low: toInt(r.lowPrice),
        close: toInt(r.closePrice),
        volume: toInt(r.accumulatedTradingVolume),
        trading_value: toInt(r.accumulatedTradingValue),
        market_cap: null, // 네이버는 일봉에 시총 미제공
      });
    }
    if (stop) break;
    if (data.length < 60) break;
  }
  return out;
}

// 재무 요약 (PER, PBR, EPS, BPS, 배당 등)
async function getFinance(code) {
  const url = `${BASE}/${encodeURIComponent(code)}/finance`;
  const { data } = await http.get(url);
  // 응답 구조: { per, eps, pbr, bps, dividendYieldRatio, ... }
  if (!data || typeof data !== 'object') return null;
  return {
    per: toNum(data.per),
    pbr: toNum(data.pbr),
    psr: toNum(data.psr),
    eps: toNum(data.eps),
    bps: toNum(data.bps),
    roe: toNum(data.roe),
    roa: toNum(data.roa),
    revenue: toInt(data.revenue),
    operating_profit: toInt(data.operatingProfit),
    net_profit: toInt(data.netProfit),
    debt_ratio: toNum(data.debtRatio),
    dividend_yield: toNum(data.dividendYieldRatio ?? data.dividendYield),
  };
}

function parseNaverDate(s) {
  if (!s) return null;
  // "2024.05.31" 또는 "20240531"
  let m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(String(s));
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s));
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[, %]/g, ''));
  return Number.isFinite(n) ? n : null;
}

module.exports = { listStocks, getBasic, getDailyPrices, getFinance };
