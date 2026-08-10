'use strict';

// KIS (한국투자증권) Open API 클라이언트
// .env에 KIS_APP_KEY, KIS_APP_SECRET 가 모두 있어야 활성화됩니다.
// 활성화는 config.isKisEnabled() 로 확인.

const axios = require('axios');
const cfg = require('../config');

let _token = null;
let _tokenExp = 0;

const baseURL = () => (cfg.kis.isPaper ? cfg.kis.paperBaseUrl : cfg.kis.baseUrl);

const http = axios.create({
  baseURL: baseURL(),
  timeout: 15000,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

async function getToken() {
  if (_token && Date.now() < _tokenExp - 60_000) return _token;
  const url = '/oauth2/tokenP';
  const body = {
    grant_type: 'client_credentials',
    appkey: cfg.kis.appKey,
    appsecret: cfg.kis.appSecret,
  };
  const { data } = await http.post(url, body);
  if (!data.access_token) throw new Error('KIS 토큰 발급 실패: ' + JSON.stringify(data));
  _token = data.access_token;
  _tokenExp = Date.now() + (Number(data.expires_in) || 86400) * 1000;
  return _token;
}

function trId(env = 'real') {
  // 실전/모의 TR_ID 매핑
  return env === 'paper' ? cfg.kis.isPaper : env;
}

async function listStocks(market) {
  // KIS는 종목 마스터를 한 번에 주지 않으므로
  // KOSPI/KOSDAQ 전체 종목코드를 내려받는 별도 엔드포인트는 제한적.
  // 따라서 KIS 모드에서는 별도 종목리스트 파일을 사용하거나
  // (가능하면) 네이버 마스터 + KIS 데이터 소스 하이브리드를 권장.
  throw new Error('KIS 모드 종목 목록은 별도 캐시가 필요합니다. 네이버로 폴백하세요.');
}

async function getDailyPrices(code, { fromDate, toDate, maxPages = 100 } = {}) {
  // /uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const token = await getToken();
    const url = '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
    const params = {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code,
      FID_INPUT_DATE_1: fromDate || '',
      FID_INPUT_DATE_2: toDate || '',
      FID_PERIOD_DIV_CODE: 'D',
      FID_ORG_ADJ_PRC: '0',
    };
    const { data } = await http.get(url, {
      params,
      headers: {
        authorization: `Bearer ${token}`,
        appkey: cfg.kis.appKey,
        appsecret: cfg.kis.appSecret,
        tr_id: 'FHKST03010100',
        custtype: 'P',
      },
    });
    const rows = data?.output2 || [];
    if (rows.length === 0) break;
    for (const r of rows) {
      out.push({
        date: normalizeDate(r.stck_bsop_date),
        open: toInt(r.stck_oprc),
        high: toInt(r.stck_hgpr),
        low: toInt(r.stck_lwpr),
        close: toInt(r.stck_clpr),
        volume: toInt(r.acml_vol),
        trading_value: null,
        market_cap: null,
      });
    }
    if (rows.length < 30) break;
  }
  return out;
}

async function getFinance(code) {
  const token = await getToken();
  // financial-ratio (PER, PBR, ROE, ROA 등)
  const url = '/uapi/domestic-stock/v1/finance/financial-ratio';
  const { data } = await http.get(url, {
    params: {
      FID_DIV_CLS_CODE: '0',
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: code,
    },
    headers: {
      authorization: `Bearer ${token}`,
      appkey: cfg.kis.appKey,
      appsecret: cfg.kis.appSecret,
      tr_id: 'FHKST66430100',
      custtype: 'P',
    },
  });
  // 응답에 여러 분기가 들어옴 (stac_yymm 기준)
  const rows = Array.isArray(data?.output) ? data.output : [];
  if (rows.length === 0) return null;
  const latest = rows[0];
  return {
    period: `${String(latest.stac_yymm).slice(0, 4)}-Q${Math.ceil(Number(String(latest.stac_yymm).slice(4)) / 3) || 1}`,
    per: toNum(latest.per),
    pbr: toNum(latest.pbr),
    psr: toNum(latest.pcr), // KIS는 psr이 없고 pcr(PSR) 사용
    eps: toNum(latest.eps),
    bps: toNum(latest.bps),
    roe: toNum(latest.roe_val),
    roa: toNum(latest.roa_val),
    revenue: toInt(latest.sales),
    operating_profit: toInt(latest.oper_profit),
    net_profit: toInt(latest.curr_assets || latest.net_income),
    debt_ratio: toNum(latest.lblt_rate),
    dividend_yield: toNum(latest.dvdn_yld),
  };
}

function normalizeDate(s) {
  if (!s) return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
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

module.exports = { getToken, listStocks, getDailyPrices, getFinance };
