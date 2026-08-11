'use strict';

// Naver Finance (데스크톱) HTML 스크래퍼
// 모바일 API는 2024~2025 사이에 구조가 바뀌어서 불안정함
// finance.naver.com은 10년째 동일한 URL 구조 → 안정적
//
// 사용 엔드포인트 (모두 GET, HTML):
//   1) 시장별 종목 목록:
//      KOSPI: /sise/sise_market_sum.naver?sosok=0&page=N
//      KOSDAQ: /sise/sise_market_sum.naver?sosok=1&page=N
//   2) 종목 기본정보: /item/main.naver?code=XXXXXX
//   3) 일봉: /item/sise_day.naver?code=XXXXXX&page=N
//   4) 재무: /item/finance.naver?code=XXXXXX (연간/분기 탭)

const axios = require('axios');
const iconv = (() => {
  try { return require('iconv-lite'); } catch { return null; }
})();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const http = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
  },
  // gzip/deflate 자동 처리
  decompress: true,
  // 항상 buffer로 받기 (EUC-KR 디코딩 위해)
  responseType: 'arraybuffer',
  transformResponse: [(data) => data], // axios 기본 JSON 변환 우회
  // 연결 재사용
  httpAgent: new (require('http').Agent)({ keepAlive: true }),
  httpsAgent: new (require('https').Agent)({ keepAlive: true }),
});

const BASE = 'https://finance.naver.com';

// 재시도 대상
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
function backoff(attempt) {
  return Math.min(500 * Math.pow(2, attempt) + Math.random() * 300, 15000);
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function get(url, { maxRetries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data, headers } = await http.get(url);
      // EUC-KR / UTF-8 자동 감지해서 디코딩
      const ct = String(headers?.['content-type'] || '');
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (!iconv) {
        return buf.toString('utf8');
      }
      if (/euc-kr/i.test(ct) || /charset\s*=\s*["']?euc-kr/i.test(ct)) {
        return iconv.decode(buf, 'euc-kr');
      }
      // meta charset 검사 (fallback)
      const head = buf.slice(0, 1024).toString('ascii');
      if (/<meta[^>]+charset\s*=\s*["']?euc-kr/i.test(head)) {
        return iconv.decode(buf, 'euc-kr');
      }
      if (/<meta[^>]+charset\s*=\s*["']?utf-8/i.test(head)) {
        return buf.toString('utf8');
      }
      // 기본은 UTF-8
      return buf.toString('utf8');
    } catch (e) {
      lastErr = e;
      const status = e.response?.status;
      const isRetryable = !status || RETRYABLE.has(status) ||
        e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT';
      if (!isRetryable || attempt === maxRetries) throw e;
      const wait = backoff(attempt);
      console.warn(`[naver] ${status || e.code} ${url.split('?')[0].slice(-30)} retry ${attempt + 1}/${maxRetries} in ${wait.toFixed(0)}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// HTML 엔티티 디코드 + 공백 정리
function cleanText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// 숫자 파싱: "1,234" → 1234
function toNum(s) {
  if (s == null) return null;
  const t = String(s).replace(/[,\s%]/g, '').replace(/−/g, '-');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// 시장 코드 매핑
const MARKET_CODE = { KOSPI: 0, KOSDAQ: 1 };

// === 시장별 종목 목록 ===
async function listStocks(market) {
  const sosok = MARKET_CODE[market];
  if (sosok == null) throw new Error(`Unknown market: ${market}`);

  const out = [];
  const maxPages = 50; // 안전장치 (KOSPI 약 16페이지, KOSDAQ 약 25페이지)
  let prevFirstCode = null;
  let dupRunCount = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`;
    let html;
    try {
      html = await get(url);
    } catch (e) {
      console.error(`[naver] listStocks(${market}) p${page} 실패:`, e.message);
      break;
    }
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let m;
    const items = [];
    while ((m = rowRe.exec(html)) !== null) {
      const row = m[1];
      const codeMatch = /\/item\/main\.naver\?code=([0-9]{6})/.exec(row);
      if (!codeMatch) continue;
      const nameMatch = /<a[^>]+href="\/item\/main\.naver\?code=[0-9]{6}"[^>]*>([^<]+)<\/a>/.exec(row);
      if (!nameMatch) continue;
      const code = codeMatch[1];
      const name = cleanText(nameMatch[1]);
      if (!name) continue;
      items.push({ code, name });
    }
    if (items.length === 0) break;

    // 중복 페이지 감지 (Naver가 페이지를 순환시킬 때)
    if (items[0].code === prevFirstCode) {
      dupRunCount++;
      if (dupRunCount >= 2) break; // 같은 시작 코드가 2회 반복되면 종료
    } else {
      dupRunCount = 0;
      prevFirstCode = items[0].code;
    }
    out.push(...items);
    await sleep(150);
  }
  // 중복 제거 (코드 기준)
  const seen = new Set();
  return out
    .filter((s) => (seen.has(s.code) ? false : (seen.add(s.code), true)))
    .map((s) => ({ code: s.code, name: s.name, market, sector: null, industry: null, listed_shares: null }));
}

// === 종목 기본 정보 ===
async function getBasic(code) {
  const url = `${BASE}/item/main.naver?code=${code}`;
  const html = await get(url);
  // 현재가, 시가총액, PER, PBR 등
  const get = (re) => {
    const m = re.exec(html);
    return m ? cleanText(m[1]) : null;
  };
  // price tag (현재가)
  const price = get(/<p class="no_today">[\s\S]*?<span class="blind">([^<]+)<\/span>/);
  // ... 너무 복잡하니 일단 main 페이지에서 핵심만
  return { raw: true, html: html.length };
}

// === 일봉 ===
async function getDailyPrices(code, { fromDate = null, toDate = null, maxPages = 30 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/item/sise_day.naver?code=${code}&page=${page}`;
    const html = await get(url);

    // table.type2 (일봉 테이블)
    // <tr><td class="date">2024.05.31</td><td class="num">종가</td>...</tr>
    // 또는 <span class="tah p11">숫자</span>
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let m;
    let parsed = 0;
    while ((m = rowRe.exec(html)) !== null) {
      const row = m[1];
      // 날짜: <td class="date"...>2024.05.31</td>  또는  <span class="tah p10 gray03">2024.05.31</span>
      let dateMatch = /<td[^>]*class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(row);
      let date = null;
      if (dateMatch) {
        const d = cleanText(dateMatch[1]);
        // "2024.05.31" 또는 "2024.05.31&nbsp;" 형식
        const dm = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(d);
        if (dm) date = `${dm[1]}-${dm[2]}-${dm[3]}`;
      }
      if (!date) {
        // backup: span 안의 날짜
        const altDate = /<span[^>]*>(\d{4}\.\d{2}\.\d{2})<\/span>/.exec(row);
        if (altDate) {
          const dm = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(altDate[1]);
          if (dm) date = `${dm[1]}-${dm[2]}-${dm[3]}`;
        }
      }
      if (!date) continue;

      // 숫자들: <td class="num">...<span class="tah p11">123,456</span></td>
      const numCells = [...row.matchAll(/<td[^>]*class="[^"]*num[^"]*"[^>]*>([\s\S]*?)<\/td>/g)];
      const nums = numCells.map((c) => {
        const inner = c[1];
        const span = /<span[^>]*class="[^"]*tah[^"]*"[^>]*>([^<]+)<\/span>/.exec(inner);
        return toNum(span ? span[1] : inner.replace(/<[^>]+>/g, ''));
      });
      // 일봉: [date, close, 전일비, 시가, 고가, 저가, 거래량]
      // 일부 row에는 거래대금이 추가로 있을 수 있음
      if (nums.length < 6) continue;
      const [close, , open, high, low, volume] = nums;
      if (close == null) continue;
      // 거래대금 (선택)
      const tradingValue = nums[6] != null && nums[6] > 1e6 ? nums[6] : null;

      if (fromDate && date < fromDate) { return out; } // 종료
      if (toDate && date > toDate) continue;
      out.push({
        date,
        open, high, low, close, volume,
        trading_value: tradingValue,
        market_cap: null,
      });
      parsed++;
    }
    if (parsed === 0) break; // 더 이상 데이터 없음
    // 마지막 페이지 감지: 페이지 하단의 "다음" 버튼 비활성화
    if (/<a[^>]+class="pgR[^"]*"[^>]*>\s*다음/.test(html) === false &&
        /<a[^>]+class="on"[^>]*>\s*\d+\s*<\/a>[\s\S]{0,200}<\/td>/.test(html)) {
      // 마지막 페이지에 도달
    }
    await sleep(120);
  }
  return out;
}

// === 재무 ===
async function getFinance(code) {
  const url = `${BASE}/item/finance.naver?code=${code}`;
  const html = await get(url);
  // finance.naver의 재무 페이지는 iframe이거나 직접 테이블
  // 직접 테이블인 경우 (대부분의 경우):
  // <table class="tb_type1"> 안에 연도별/분기별 데이터
  // 최근 연도 컬럼: PER, EPS, ROE 등
  const result = {
    per: null, pbr: null, psr: null,
    eps: null, bps: null, roe: null, roa: null,
    revenue: null, operating_profit: null, net_profit: null,
    debt_ratio: null, dividend_yield: null,
  };

  // 간단한 휴리스틱: 페이지에 등장하는 "PER" 또는 "EPS" 라벨 근처 숫자 추출은 너무 fragile
  // 안전하게: 페이지가 비어있거나 에러면 null 반환
  if (html.length < 5000) return result;

  // TODO: 더 견고한 파싱. 일단 raw 플래그만 반환.
  // 사용 예: 추후 main 페이지의 table.summary에서 PER/PBR 추출
  return result;
}

// === 외인/기관 매매동향 ===
// frgn.naver 페이지에서 최근 20일치 일자별 외인/기관 순매수 추출
async function getInvestorFlow(code, { days = 20 } = {}) {
  const out = [];
  let pages = Math.ceil(days / 10); // 페이지당 약 10행
  for (let page = 1; page <= pages; page++) {
    const url = `${BASE}/item/frgn.naver?code=${code}&page=${page}`;
    let html;
    try { html = await get(url); } catch (e) { break; }
    // table.type2 안의 일별 데이터 추출
    // 두 번째 table: 일자 / 종가 / 전일비 / 등락률 / 거래량 / 기관 / 외국인 순매매량 / 보유주수 / 보유율
    const tables = [...html.matchAll(/<table[^>]+class="[^"]*type2[^"]*"[^>]*>([\s\S]*?)<\/table>/g)];
    if (tables.length < 2) break;
    const dailyTable = tables[1][1];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let m;
    let countThisPage = 0;
    while ((m = rowRe.exec(dailyTable)) !== null) {
      const row = m[1];
      // 헤더/공백 row 스킵
      if (/<th[> ]/i.test(row)) continue;
      // 날짜
      const dateMatch = /(\d{4}\.\d{2}\.\d{2})/.exec(row);
      if (!dateMatch) continue;
      const d = dateMatch[1].replace(/\./g, '-');
      // 모든 <span class="tah..."> 추출
      // 순서: [date, close, change, change%, volume, institution, foreign, holding_qty, holding_ratio]
      const nums = [...row.matchAll(/<span[^>]+class="[^"]*tah[^"]*"[^>]*>([^<]+)<\/span>/g)]
        .map((c) => toNum(c[1]));
      if (nums.length < 9) continue;
      // nums[0] = date (toNum null), nums[1] = close
      const close = nums[1];
      const change = nums[2];
      const volume = nums[4];
      const institution = nums[5];
      const foreign = nums[6];
      const holdingRatio = nums[8];
      if (close == null) continue;
      out.push({
        date: d,
        close,
        change,
        volume,
        institution_net: institution,
        foreign_net: foreign,
        foreign_holding_ratio: holdingRatio,
      });
      countThisPage++;
    }
    if (countThisPage === 0) break;
    await sleep(100);
  }
  return out.slice(0, days);
}

// === 실시간 시세 (polling.finance.naver.com) ===
async function getRealtime(code) {
  const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`;
  let resp;
  try {
    resp = await axios.get(url, {
      headers: { 'User-Agent': UA, 'Referer': 'https://finance.naver.com/' },
      timeout: 10000,
    });
  } catch (e) {
    return null;
  }
  const d = resp.data?.datas?.[0];
  if (!d) return null;
  return {
    code: d.itemCode,
    name: d.stockName,
    close: toNum(d.closePrice),
    change: toNum(d.compareToPreviousClosePrice),
    change_pct: toNum(d.fluctuationsRatio),
    open: toNum(d.openPrice),
    high: toNum(d.highPrice),
    low: toNum(d.lowPrice),
    volume: d.accumulatedTradingVolumeRaw ?? null,
    trading_value: d.accumulatedTradingValueRaw ?? null,
    market_cap: d.marketValueFullRaw ?? null,
    as_of: d.localTradedAt,
  };
}

// === 여러 종목 실시간 일괄 조회 ===
async function getRealtimeBatch(codes) {
  if (codes.length === 0) return [];
  const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${codes.join(',')}`;
  try {
    const resp = await axios.get(url, {
      headers: { 'User-Agent': UA, 'Referer': 'https://finance.naver.com/' },
      timeout: 15000,
    });
    const arr = resp.data?.datas || [];
    return arr.map((d) => ({
      code: d.itemCode,
      close: toNum(d.closePrice),
      change: toNum(d.compareToPreviousClosePrice),
      change_pct: toNum(d.fluctuationsRatio),
      volume: d.accumulatedTradingVolumeRaw ?? null,
      market_cap: d.marketValueFullRaw ?? null,
    }));
  } catch (e) {
    return [];
  }
}

module.exports = { listStocks, getBasic, getDailyPrices, getFinance, getInvestorFlow, getRealtime, getRealtimeBatch };
