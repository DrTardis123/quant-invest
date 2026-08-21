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
    // 7팩터 기본 가중치 = strategies.js 의 'balanced' 프로파일 (단일 진실 공급원)
    // scripts/update.js 가 calculateAll(undefined) 로 호출하므로, 이 값이 all.json/top.json 의
    // total_score 를 결정한다. 대시보드 기본 프로파일과 어긋나면 서버 랭킹과 화면 랭킹이 달라진다.
    get weights() {
      return require('../strategies').get('balanced').weights;
    },
  },

  // KIS 키가 모두 있으면 자동으로 KIS 모드
  isKisEnabled() {
    return Boolean(this.kis.appKey && this.kis.appSecret);
  },
};

module.exports = cfg;
