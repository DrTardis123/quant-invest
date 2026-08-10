'use strict';

require('dotenv').config();

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function list(v, fallback) {
  if (!v) return fallback;
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

const cfg = {
  root: ROOT,
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',

  data: {
    source: (process.env.DATA_SOURCE || 'naver').toLowerCase(),
    markets: list(process.env.MARKETS, ['KOSPI', 'KOSDAQ']),
    topN: num(process.env.TOP_N, 20),
    backfillYears: num(process.env.BACKFILL_YEARS, 2),
    dbPath: path.join(ROOT, 'data', 'quant.db'),
    rawDir: path.join(ROOT, 'data', 'raw'),
    processedDir: path.join(ROOT, 'data', 'processed'),
  },

  kis: {
    appKey: process.env.KIS_APP_KEY || '',
    appSecret: process.env.KIS_APP_SECRET || '',
    accountNo: process.env.KIS_ACCOUNT_NO || '',
    isPaper: bool(process.env.KIS_IS_PAPER, true),
    baseUrl: 'https://openapi.koreainvestment.com:9443',
    paperBaseUrl: 'https://openapivts.koreainvestment.com:29443',
  },

  schedule: {
    hour: num(process.env.UPDATE_HOUR, 17),
    minute: num(process.env.UPDATE_MINUTE, 0),
  },

  factors: {
    // 가중치 합 = 100
    weights: { value: 35, momentum: 20, quality: 20, volatility: 15, growth: 10 },
  },

  // KIS 키가 모두 있으면 자동으로 KIS 모드
  isKisEnabled() {
    return Boolean(this.kis.appKey && this.kis.appSecret);
  },
};

module.exports = cfg;
