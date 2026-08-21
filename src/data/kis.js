// KIS (한국투자증권) Open API 래퍼
// - OAuth2 토큰 발급/갱신
// - 국내 주식 일봉 (inquire-daily-itemchartprice)
// - 5년치 장기 데이터 fetch 용
//
// 환경변수:
//   KIS_APP_KEY    (필수) - 앱 키
//   KIS_APP_SECRET (필수) - 앱 시크릿
//   KIS_ACCOUNT_NO (선택) - 계좌번호 (필요 시)
//   KIS_IS_PAPER   (선택) - 'true'면 모의, 기본은 실전

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_REAL = 'https://openapi.koreainvestment.com:9443';
const BASE_PAPER = 'https://openapivts.koreainvestment.com:29443';

let _token = null;
let _tokenExpires = 0;

function getBase() {
  return process.env.KIS_IS_PAPER === 'true' ? BASE_PAPER : BASE_REAL;
}

function isPaper() {
  return process.env.KIS_IS_PAPER === 'true';
}

// OAuth2 토큰 발급
async function getToken() {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error('KIS_APP_KEY / KIS_APP_SECRET 환경변수 필요');
  }
  if (_token && Date.now() < _tokenExpires - 60000) {
    return _token;
  }
  const url = `${getBase()}/oauth2/tokenP`;
  const body = {
    grant_type: 'client_credentials',
    appkey: appKey,
    appsecret: appSecret,
  };
  const resp = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  if (!resp.data || !resp.data.access_token) {
    throw new Error(`KIS 토큰 발급 실패: ${JSON.stringify(resp.data)}`);
  }
  _token = resp.data.access_token;
  // KIS 토큰은 보통 24시간 유효
  _tokenExpires = Date.now() + (resp.data.expires_in || 86400) * 1000;
  console.log(`[kis] 토큰 발급 완료 (만료: ${new Date(_tokenExpires).toISOString()})`);
  return _token;
}

// 국내 주식 일봉 (장기)
// inquire-daily-itemchartprice
async function getDailyPrice(code, fromDate, toDate) {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const token = await getToken();
  const url = `${getBase()}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`;
  const trId = isPaper() ? 'FHKST03010100' : 'FHKST03010100';
  const params = {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: code,
    FID_INPUT_DATE_1: fromDate,  // YYYYMMDD
    FID_INPUT_DATE_2: toDate,    // YYYYMMDD
    FID_PERIOD_DIV_CODE: 'D',    // D=일봉, W=주봉, M=월봉
    FID_ORG_ADJ_PRC: '1',        // 수정주가 반영
  };
  try {
    const resp = await axios.get(url, {
      params,
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        appkey: appKey,
        appsecret: appSecret,
        tr_id: trId,
      },
      timeout: 15000,
    });
    if (!resp.data || !Array.isArray(resp.data.output2)) {
      return [];
    }
    return resp.data.output2.map((r) => ({
      date: String(r.stck_bsop_date).slice(0, 4) + '-' + String(r.stck_bsop_date).slice(4, 6) + '-' + String(r.stck_bsop_date).slice(6, 8),
      open: Number(r.stck_oprc),
      high: Number(r.stck_hgpr),
      low: Number(r.stck_lwpr),
      close: Number(r.stck_clpr),
      volume: Number(r.acml_vol),
      trading_value: Number(r.acml_tr_pbmn) || null,
    }));
  } catch (e) {
    if (e.response) {
      const code = e.response.data?.rt_cd || e.response.status;
      const msg = e.response.data?.msg1 || e.message;
      throw new Error(`KIS 일봉 실패 (${code}): ${msg}`);
    }
    throw e;
  }
}

// 5년치 일봉 fetch (페이지네이션)
async function fetch5y(code) {
  // KIS 일봉은 1회 100건 cap
  const out = [];
  const today = new Date();
  const toDate = today.toISOString().slice(0, 10).replace(/-/g, '');
  const fiveYearsAgo = new Date(today.getTime() - 5 * 365 * 86400 * 1000);
  const fromDate = fiveYearsAgo.toISOString().slice(0, 10).replace(/-/g, '');

  // 한 번에 5년치 = 1,260 거래일. 1회 100일 → 13페이지
  // KIS는 1회 max 100건이라 페이지네이션 필요
  let cursor = fiveYearsAgo;
  while (cursor < today) {
    const end = new Date(Math.min(cursor.getTime() + 100 * 86400 * 1000 * 1.4, today.getTime()));
    const from = cursor.toISOString().slice(0, 10).replace(/-/g, '');
    const to = end.toISOString().slice(0, 10).replace(/-/g, '');
    const rows = await getDailyPrice(code, from, to);
    if (rows.length === 0) break;
    for (const r of rows) out.push(r);
    cursor = end;
    if (rows.length < 50) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // 중복 제거 (날짜 기준) + 정렬
  const seen = new Set();
  const uniq = [];
  for (const r of out) {
    if (seen.has(r.date)) continue;
    seen.add(r.date);
    uniq.push(r);
  }
  uniq.sort((a, b) => (a.date < b.date ? -1 : 1));
  return uniq;
}

module.exports = { getToken, getDailyPrice, fetch5y, isPaper, getBase };

if (require.main === module) {
  // CLI 테스트
  (async () => {
    const code = process.argv[2] || '005930';
    console.log(`[kis] ${code} 5년치 일봉 fetch...`);
    const t0 = Date.now();
    try {
      const rows = await fetch5y(code);
      console.log(`[kis] ${code}: ${rows.length}일 (${rows[0]?.date} ~ ${rows[rows.length-1]?.date})`);
      console.log(`[kis] 완료. ${(Date.now() - t0) / 1000}s`);
    } catch (e) {
      console.error('[kis] 실패:', e.message);
      process.exit(1);
    }
  })();
}
