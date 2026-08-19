'use strict';

// 팩터 계산기
// - 각 팩터는 raw 값을 0-100 점수(백분위)로 정규화
// - 가중 합산으로 total_score 산출
// - 모든 작업은 DuckDB의 최신 스냅샷(가장 최근 일봉 + 가장 최근 재무) 기준

const { all, run } = require('../db/connection');
const cfg = require('../config');

// ---------- SQL: 데이터 가져오기 ----------

async function fetchLatestFundamentals() {
  return all(`
    WITH latest_f AS (
      SELECT f.*,
             ROW_NUMBER() OVER (PARTITION BY f.code ORDER BY f.period DESC) AS rn
      FROM fundamentals f
    )
    SELECT s.code, s.name, s.market, s.sector, s.industry,
           lf.per, lf.pbr, lf.psr, lf.eps, lf.bps, lf.roe, lf.roa,
           lf.revenue, lf.operating_profit, lf.net_profit,
           lf.debt_ratio, lf.dividend_yield, lf.period
    FROM stocks s
    LEFT JOIN latest_f lf ON s.code = lf.code AND lf.rn = 1
    WHERE s.market IN ('KOSPI', 'KOSDAQ')
  `);
}

async function fetchPricesForFactors() {
  // 모멘텀(12-1), 저변동성(60일) 계산용
  return all(`
    SELECT code, date, close, volume
    FROM daily_prices
    WHERE date >= (SELECT MAX(date) FROM daily_prices) - INTERVAL '15 months'
    ORDER BY code, date
  `);
}

async function fetchPrevYearFundamentals() {
  return all(`
    WITH ranked AS (
      SELECT f.*,
             ROW_NUMBER() OVER (PARTITION BY f.code ORDER BY f.period DESC) AS rn
      FROM fundamentals f
    )
    SELECT code, revenue, net_profit, eps
    FROM ranked
    WHERE rn <= 5
  `);
}

// ---------- 정규화 유틸 ----------

// 백분위 점수 (0~95, 절대 만점 안 됨)
// - raw 값을 정렬 후 순위 기반 점수
// - 1위는 ~94, 꼴찌는 ~1
// - 동점은 같은 점수
// - max=94로 강제 cap → 절대 만점 안 됨 (사용자 요구)
// - 95점 이상 절대 안 나옴
function percentileScore(values, higherIsBetter = true) {
  const valid = values.filter((v) => v.raw !== null && v.raw !== undefined && Number.isFinite(v.raw));
  if (valid.length === 0) return new Map();
  const sorted = [...valid].sort((a, b) => higherIsBetter ? b.raw - a.raw : a.raw - b.raw);
  const n = sorted.length;
  const rankMap = new Map();
  sorted.forEach((v, i) => {
    // i=0 (1등) → ~94, i=n-1 (꼴찌) → ~1
    let score = ((n - i) / n) * 94;  // 0~94 (1등=93.x)
    score = Math.max(1, Math.min(94, score));  // 절대 95 이상 안 됨
    rankMap.set(v.code, score);
  });
  // 원래 입력에 없는/유효하지 않은 code는 50(중립)
  const out = new Map();
  for (const v of values) {
    out.set(v.code, rankMap.has(v.code) ? rankMap.get(v.code) : 50);
  }
  return out;
}

function avgMaps(maps) {
  // maps: Array<Map<code, score>>, 동일 code에 대해 평균
  const all = new Set();
  for (const m of maps) for (const k of m.keys()) all.add(k);
  const out = new Map();
  for (const k of all) {
    let sum = 0, cnt = 0;
    for (const m of maps) {
      const v = m.get(k);
      if (v !== undefined) { sum += v; cnt++; }
    }
    out.set(k, cnt > 0 ? sum / cnt : 50);
  }
  return out;
}

// ---------- 팩터별 계산 ----------

function calcValue(fundamentals) {
  // PER, PBR, PSR 각각 낮을수록 좋음 → percentile
  // 결측/음수/0 PER, PBR은 제외
  const perVals = fundamentals
    .filter((f) => f.per !== null && f.per > 0 && f.per < 100)
    .map((f) => ({ code: f.code, raw: f.per }));
  const pbrVals = fundamentals
    .filter((f) => f.pbr !== null && f.pbr > 0 && f.pbr < 20)
    .map((f) => ({ code: f.code, raw: f.pbr }));
  const psrVals = fundamentals
    .filter((f) => f.psr !== null && f.psr > 0 && f.psr < 50)
    .map((f) => ({ code: f.code, raw: f.psr }));

  const perScore = percentileScore(perVals, false);
  const pbrScore = percentileScore(pbrVals, false);
  const psrScore = percentileScore(psrVals, false);

  return avgMaps([perScore, pbrScore, psrScore]);
}

function calcQuality(fundamentals) {
  // ROE(↑), ROA(↑), 부채비율(↓) 가중
  // DB에 ROE/ROA/debt_ratio가 없으면 (현재 99% null) → PER/PBR 기반 mock으로 추정
  // mock: PER 낮을수록 + PBR 낮을수록 + 배당수익률 높을수록 = 퀄리티 높음
  const roeVals = fundamentals
    .filter((f) => f.roe !== null && f.roe > -50 && f.roe < 100)
    .map((f) => ({ code: f.code, raw: f.roe }));
  const roaVals = fundamentals
    .filter((f) => f.roa !== null && f.roa > -50 && f.roa < 50)
    .map((f) => ({ code: f.code, raw: f.roa }));
  const debtVals = fundamentals
    .filter((f) => f.debt_ratio !== null && f.debt_ratio > 0 && f.debt_ratio < 500)
    .map((f) => ({ code: f.code, raw: f.debt_ratio }));

  const roeMap = percentileScore(roeVals, true);
  const roaMap = percentileScore(roaVals, true);
  const debtMap = percentileScore(debtVals, false);

  // mock quality: PER < 10 = 80점, PER 10~20 = 60, PER 20~30 = 50, PER > 30 = 30
  //            PBR < 1 = 80, PBR 1~2 = 60, PBR 2~3 = 50, PBR > 3 = 30
  //            배당수익률 > 5% = 보너스
  const mockQualityRows = [];
  for (const f of fundamentals) {
    if (roeMap.has(f.code)) continue; // 실제 데이터 있으면 mock 안 함
    const per = Number(f.per) || null;
    const pbr = Number(f.pbr) || null;
    const dvr = Number(f.dividend_yield) || null;
    if (per === null && pbr === null) continue;
    let score = 50;
    if (per !== null) {
      if (per > 0 && per < 8) score += 30;
      else if (per < 15) score += 20;
      else if (per < 25) score += 5;
      else if (per > 50) score -= 20;
    }
    if (pbr !== null) {
      if (pbr > 0 && pbr < 0.5) score += 25;
      else if (pbr < 1) score += 18;
      else if (pbr < 1.5) score += 10;
      else if (pbr < 3) score += 0;
      else score -= 10;
    }
    if (dvr !== null && dvr > 4) score += 8;
    mockQualityRows.push({ code: f.code, raw: Math.max(5, Math.min(94, score)) });
  }
  const mockMap = new Map(mockQualityRows.map((r) => [r.code, r.raw]));

  // 실제 + mock 통합
  const allCodes = new Set([...roeMap.keys(), ...roaMap.keys(), ...debtMap.keys(), ...mockMap.keys()]);
  const out = new Map();
  for (const c of allCodes) {
    const r1 = roeMap.get(c) ?? mockMap.get(c) ?? 50;
    const r2 = roaMap.get(c) ?? mockMap.get(c) ?? 50;
    const r3 = debtMap.get(c) ?? mockMap.get(c) ?? 50;
    out.set(c, (r1 + r2 + r3) / 3);
  }
  return out;
}

function calcGrowth(fundamentals, prevFundamentals) {
  // YoY 매출/이익 성장률 (직전 4분기 vs 1년 전 4분기)
  // prevFundamentals는 code별 과거 분기 5개까지 가져온 데이터
  const byCode = new Map();
  for (const f of prevFundamentals) {
    if (!byCode.has(f.code)) byCode.set(f.code, []);
    byCode.get(f.code).push(f);
  }
  const growthRows = [];
  for (const f of fundamentals) {
    const history = byCode.get(f.code) || [];
    if (history.length < 2) continue;
    const latestRev = Number(f.revenue);
    const oldRev = Number(history[history.length - 1].revenue);
    if (latestRev && oldRev && oldRev > 0) {
      growthRows.push({ code: f.code, raw: (latestRev - oldRev) / oldRev });
    }
  }
  if (growthRows.length === 0) {
    // DB에 revenue 변화 데이터 없음 → PER/PBR/배당 기반 mock 성장률 추정
    // mock: PER 낮은데 PBR도 낮으면 성장 가능성 (가성비), 배당 안정 = 점수 중립
    const mockRows = [];
    for (const f of fundamentals) {
      const per = Number(f.per) || null;
      const pbr = Number(f.pbr) || null;
      const dvr = Number(f.dividend_yield) || null;
      if (per === null && pbr === null && dvr === null) continue;
      let score = 50;
      // PER < 10 = 저평가 = 잠재적 성장 (단, 적자기업은 제외)
      if (per !== null && per > 0) {
        if (per < 8 && pbr !== null && pbr > 0 && pbr < 1) score += 20; // PER·PBR 모두 저평가 = 강한 매력
        else if (per < 12) score += 12;
        else if (per < 20) score += 5;
        else if (per > 40) score -= 15;
      }
      // PBR < 1 = 자산가치 대비 저평가 = 성장 잠재력
      if (pbr !== null && pbr > 0 && pbr < 0.7) score += 12;
      // 배당 안정 = 점수 중립 (보너스 없음)
      mockRows.push({ code: f.code, raw: Math.max(5, Math.min(94, score)) });
    }
    const out = new Map();
    for (const r of mockRows) out.set(r.code, r.raw);
    return out;
  }
  return percentileScore(growthRows, true);
}

function calcMomentum(prices) {
  // 12개월 수익률 - 최근 1개월 (Jegadeesh-Titman 모멘텀)
  // 각 code별 종가를 시간순으로 정렬 후 추출
  const byCode = new Map();
  for (const r of prices) {
    if (!byCode.has(r.code)) byCode.set(r.code, []);
    byCode.get(r.code).push(r);
  }
  const rows = [];
  for (const [code, arr] of byCode) {
    if (arr.length < 30) continue;
    const last = Number(arr[arr.length - 1].close);
    const monthAgo = Number(arr[Math.max(0, arr.length - 21)].close);
    const yearAgo = Number(arr[0].close);
    if (!last || !monthAgo || !yearAgo) continue;
    const ret12 = (last - yearAgo) / yearAgo;
    const ret1 = (last - monthAgo) / monthAgo;
    rows.push({ code, raw: ret12 - ret1 });
  }
  return percentileScore(rows, true);
}

function calcLowVol(prices) {
  // 최근 60일 일별 수익률 표준편차 → 낮을수록 좋음
  const byCode = new Map();
  for (const r of prices) {
    if (!byCode.has(r.code)) byCode.set(r.code, []);
    byCode.get(r.code).push(r);
  }
  const rows = [];
  for (const [, arr] of byCode) {
    if (arr.length < 30) continue;
    const tail = arr.slice(-60);
    const rets = [];
    for (let i = 1; i < tail.length; i++) {
      const c0 = Number(tail[i - 1].close);
      const c1 = Number(tail[i].close);
      if (c0 > 0 && c1 > 0) {
        rets.push(Math.log(c1 / c0));
      }
    }
    if (rets.length < 20) continue;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    const std = Math.sqrt(variance);
    rows.push({ code: tail[tail.length - 1].code, raw: std });
  }
  return percentileScore(rows, false);
}

// ---------- 거래정지/거래주의 감지 ----------

async function fetchTradingStatus() {
  // 거래정지/거래주의 감지 (모두 거래대금 기준):
  //   - halt: 최근 5일 종가 변동 없거나 거래량 0
  //   - caution: 최근 5일 평균 거래대금 < 1억 (단기 유동성 부족, 거래량 급감)
  //   - zero_volume: 최근 20일 평균 거래대금 0 (거래정지 의심)
  //   - veryLowLiq (< 1억): KRX 저유동성, -30점 (장기 20일 평균 거래대금)
  //   - lowLiq (1~5억):  실전 매매 어려움, -20점
  //   - cautionLiq (5~10억): 낮은 유동성, -10점
  return all(`
    WITH recent AS (
      SELECT code, date, close, volume,
             ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
      FROM daily_prices
    )
    SELECT code,
           MAX(close) FILTER (WHERE rn <= 5) AS max_close,
           MIN(close) FILTER (WHERE rn <= 5) AS min_close,
           SUM(volume) FILTER (WHERE rn <= 5) AS vol5,
           AVG(volume) FILTER (WHERE rn <= 5) AS avg_vol5,
           AVG(volume * close) FILTER (WHERE rn <= 5) / 1 AS turnover_5d,
           AVG(volume * close) FILTER (WHERE rn <= 20) AS turnover_20d
    FROM recent
    GROUP BY code
  `);
}

// 거래정지/거래주의 분류
// 반환: { halt, caution, zeroVolume, veryLowLiq, lowLiq, cautionLiq }
// 유동성 3단계 (웹서칭 기준 — KRX 저유동성 + 실전 매매 유동성):
//   veryLowLiq (< 1억): KRX 저유동성, -30점 (투자 부적합)
//   lowLiq     (1~5억):  실전 매매 어려움, -20점
//   cautionLiq (5~10억): 낮은 유동성, -10점
//   10억+      : 정상, 페널티 없음 (단, percentile 점수는 그대로 적용)
function classifyStatus(statusRows) {
  const halt = new Set();
  const caution = new Set();
  const zeroVolume = new Set();
  const veryLowLiq = new Set();
  const lowLiq = new Set();
  const cautionLiq = new Set();
  for (const s of statusRows) {
    const maxC = s.max_close;
    const minC = s.min_close;
    const vol5 = Number(s.vol5) || 0;
    const avgVol5 = Number(s.avg_vol5) || 0;
    const turnover5d = Number(s.turnover_5d) || 0;
    const turnover = Number(s.turnover_20d) || 0;

    // 거래량 0: 최근 20일 평균 거래대금 0 → 완전 제외
    if (turnover === 0) {
      zeroVolume.add(s.code);
      continue;
    }
    // 거래정지: 최근 5일 종가 변동 0 + 거래량 0
    if (vol5 === 0 || (maxC === minC && avgVol5 === 0)) {
      halt.add(s.code);
      continue;
    }
    // 거래주의: 최근 5일 평균 거래대금 < 1억 (단기 유동성 부족)
    if (turnover5d < 100_000_000) {
      caution.add(s.code);
      continue;
    }
    // 유동성 3단계 (20일 평균 거래대금 기준)
    if (turnover < 100_000_000) veryLowLiq.add(s.code);          // < 1억
    else if (turnover < 500_000_000) lowLiq.add(s.code);         // 1~5억
    else if (turnover < 1_000_000_000) cautionLiq.add(s.code);  // 5~10억
  }
  return { halt, caution, zeroVolume, veryLowLiq, lowLiq, cautionLiq };
}

function applyStatusPenalty(rows, statusMap, options = {}) {
  // 거래정지/거래량 0: 완전 제외 (0점 처리, top.json에서 빠짐)
  // 거래주의: -50점 (실질적으로 B 등급 이하로 강제)
  // 유동성 페널티 (웹서칭 기반, KRX 저유동성 + 실전 매매 유동성):
  //   veryLowLiq (< 1억):    -30점 (투자 부적합, KRX 저유동성)
  //   lowLiq     (1~5억):     -20점 (저유동성, 실전 매매 어려움)
  //   cautionLiq (5~10억):   -10점 (낮은 유동성, 참고용)
  // 코스닥: -5점 (서버 부하 줄이기 위한 약한 페널티)
  // excludeKosdaq=true: 코스닥을 아예 제외
  const { halt, caution, zeroVolume, veryLowLiq, lowLiq, cautionLiq } = statusMap;
  const excludeKosdaq = !!options.excludeKosdaq;
  for (const r of rows) {
    let penalized = false;

    if (zeroVolume && zeroVolume.has(r.code)) {
      // 거래량 0 → 완전 0점 (top.json에서 제외)
      r.total_score = 0;
      r.status = 'zero_volume';
      penalized = true;
    } else if (halt && halt.has(r.code)) {
      // 거래정지 → 완전 0점
      r.total_score = 0;
      r.status = 'halt';
      penalized = true;
    } else if (caution && caution.has(r.code)) {
      // 거래주의 → -50점 (B+ 이하로 강제)
      r.total_score = Math.max(0, r.total_score - 50);
      r.status = 'caution';
      penalized = true;
    } else if (veryLowLiq && veryLowLiq.has(r.code)) {
      // 매우 낮은 유동성 (< 1억, KRX 저유동성) → -30점 (투자 부적합)
      r.total_score = Math.max(0, r.total_score - 30);
      r.status = 'very_low_liquidity';
      penalized = true;
    } else if (lowLiq && lowLiq.has(r.code)) {
      // 저유동성 (1~5억, 실전 매매 어려움) → -20점
      r.total_score = Math.max(0, r.total_score - 20);
      r.status = 'low_liquidity';
      penalized = true;
    } else if (cautionLiq && cautionLiq.has(r.code)) {
      // 낮은 유동성 (5~10억, 참고용) → -10점
      r.total_score = Math.max(0, r.total_score - 10);
      r.status = 'caution_liquidity';
      penalized = true;
    } else if (excludeKosdaq && r.market === 'KOSDAQ') {
      // KOSDAQ 완전 제외 (메인 대시보드)
      r.total_score = 0;
      r.status = 'excluded_kosdaq';
      penalized = true;
    } else if (r.market === 'KOSDAQ') {
      // KOSDAQ 약한 페널티 (별도 페이지에서 볼 때)
      r.total_score = Math.max(0, r.total_score - 5);
      r.status = r.status || 'kosdaq';
      penalized = true;
    }

    if (!penalized) r.status = r.status || 'normal';
  }
}

// ---------- 유동성 (거래량/거래대금) ----------

async function fetchLiquidity() {
  // 최근 20일 평균 거래대금 (거래량 × 종가)
  // 단순 거래량보다 거래대금이 시총 보정 효과가 있음
  return all(`
    WITH recent AS (
      SELECT code, date, volume, close,
             ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
      FROM daily_prices
    )
    SELECT code, AVG(volume * close) FILTER (WHERE rn <= 20) AS turnover_20d
    FROM recent
    GROUP BY code
  `);
}

function calcLiquidity(liquidity) {
  // 거래대금 백분위 (높을수록 좋음, 유동성)
  // 거래량 0 = 점수 0 (제외)
  const rows = liquidity
    .filter((r) => r.turnover_20d > 0)
    .map((r) => ({ code: r.code, raw: Number(r.turnover_20d) }));
  return percentileScore(rows, true);
}

// 거래량 0 종목 마킹 (UI에서 거래정지와 별도 표시)
function markZeroVolume(stocks, liquidity) {
  const map = new Map(liquidity.map((r) => [r.code, Number(r.turnover_20d) || 0]));
  for (const s of stocks) {
    if (!map.has(s.code) || map.get(s.code) === 0) {
      s.zero_volume = true;
    }
  }
}

// ---------- 수급 (외인/기관) ----------

async function fetchSupply() {
  // 외인+기관 5일 + 20일 누적 순매수
  return all(`
    WITH ranked AS (
      SELECT code, date, foreign_net, institution_net,
             ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
      FROM investor_flow
    )
    SELECT code,
           SUM(foreign_net) FILTER (WHERE rn <= 5) AS foreign_5d,
           SUM(institution_net) FILTER (WHERE rn <= 5) AS inst_5d,
           SUM(foreign_net) FILTER (WHERE rn <= 20) AS foreign_20d,
           SUM(institution_net) FILTER (WHERE rn <= 20) AS inst_20d
    FROM ranked
    GROUP BY code
  `);
}

function calcSupply(supply) {
  // 외인+기관 5일 누적 백분위 (높을수록 좋음)
  const rows = supply
    .filter((r) => r.foreign_5d != null)
    .map((r) => ({
      code: r.code,
      raw: (Number(r.foreign_5d) || 0) + (Number(r.inst_5d) || 0),
    }));
  return percentileScore(rows, true);
}

// ---------- 메인 ----------

// ETF/레버리지/인버스/SPAC/스팩/우선주 제외 패턴
// 7팩터 점수 계산 시: lightIsExcludedProduct 사용 (정확한 패턴, 오탐 방지)
// - '삼성' / 'KB' 같은 일반 prefix는 더 이상 자동 제외 안 됨
const { lightIsExcludedProduct: isExcludedProduct } = require('../data/filters');

async function calculateAll(weights = null, options = {}) {
  const [fundamentals, prices, prevFundamentals, statusRows, liquidity, supply] = await Promise.all([
    fetchLatestFundamentals(),
    fetchPricesForFactors(),
    fetchPrevYearFundamentals(),
    fetchTradingStatus(),
    fetchLiquidity(),
    fetchSupply(),
  ]);

  if (fundamentals.length === 0) {
    return { codes: [], rows: [], asOf: null };
  }

  // ETF/레버리지/인버스/SPAC 등 제외
  const filteredFunda = fundamentals.filter((f) => !isExcludedProduct(f.name));
  const filteredCodeSet = new Set(filteredFunda.map((f) => f.code));
  const filteredPrices = prices.filter((p) => filteredCodeSet.has(p.code));
  const filteredLiq = liquidity.filter((l) => filteredCodeSet.has(l.code));
  const filteredSupply = supply.filter((s) => filteredCodeSet.has(s.code));
  const filteredStatus = statusRows.filter((s) => filteredCodeSet.has(s.code));

  const v = calcValue(filteredFunda);
  const m = calcMomentum(filteredPrices);
  const q = calcQuality(filteredFunda);
  const lv = calcLowVol(filteredPrices);
  const g = calcGrowth(filteredFunda, prevFundamentals);
  const liq = calcLiquidity(filteredLiq);
  const sup = calcSupply(filteredSupply);

  // status 분류
  const statusMap = classifyStatus(filteredStatus);

  const W = weights || cfg.factors.weights;
  const wv = W.value || 0;
  const wm = W.momentum || 0;
  const wq = W.quality || 0;
  const wlv = W.volatility || 0;
  const wg = W.growth || 0;
  const wliq = W.liquidity || 0;
  const wsup = W.supply || 0;
  const totalWeight = wv + wm + wq + wlv + wg + wliq + wsup || 100;

  const codes = new Set([
    ...v.keys(), ...m.keys(), ...q.keys(), ...lv.keys(), ...g.keys(),
    ...liq.keys(), ...sup.keys(),
  ]);

  // 오늘 날짜 (DuckDB의 max(date))
  const dateRow = await all(`SELECT MAX(date) AS d FROM daily_prices`);
  const asOf = dateRow[0]?.d || null;
  if (!asOf) return { codes: [...codes], rows: [], asOf: null };

  // market + name 매핑
  const marketMap = new Map(filteredFunda.map((f) => [f.code, f.market]));
  const nameMap = new Map(filteredFunda.map((f) => [f.code, f.name]));

  const rows = [];
  for (const code of codes) {
    const vs = v.get(code) ?? 50;
    const ms = m.get(code) ?? 50;
    const qs = q.get(code) ?? 50;
    const lvs = lv.get(code) ?? 50;
    const gs = g.get(code) ?? 50;
    const liqs = liq.get(code) ?? 50;
    const sups = sup.get(code) ?? 50;
    // 가중 평균 (각 팩터 0~95, 만점 방지)
    let total = (vs * wv + ms * wm + qs * wq + lvs * wlv + gs * wg + liqs * wliq + sups * wsup) / totalWeight;
    // 100점 만점: 비율 유지, 0~100 스케일
    // (이미 가중 평균이 0~95 범위)

    rows.push({
      code,
      date: asOf,
      value_score: round2(vs),
      momentum_score: round2(ms),
      quality_score: round2(qs),
      volatility_score: round2(lvs),
      growth_score: round2(gs),
      liquidity_score: round2(liqs),
      supply_score: round2(sups),
      total_score: round2(total),
      market: marketMap.get(code) || null,
      name: nameMap.get(code) || null,
    });
  }

  // 거래정지/거래주의/거래량0/KOSDAQ 페널티 적용
  applyStatusPenalty(rows, statusMap, options);

  rows.sort((a, b) => b.total_score - a.total_score);
  rows.forEach((r, i) => (r.rank = i + 1));

  return {
    codes: [...codes],
    rows,
    asOf,
    stats: {
      total: rows.length,
      normal: rows.filter((r) => r.status === 'normal').length,
      halt: rows.filter((r) => r.status === 'halt').length,
      caution: rows.filter((r) => r.status === 'caution').length,
      zeroVolume: rows.filter((r) => r.status === 'zero_volume').length,
      veryLowLiq: rows.filter((r) => r.status === 'very_low_liquidity').length,
      lowLiquidity: rows.filter((r) => r.status === 'low_liquidity').length,
      cautionLiq: rows.filter((r) => r.status === 'caution_liquidity').length,
      kosdaq: rows.filter((r) => r.status === 'kosdaq' || r.status === 'excluded_kosdaq').length,
    },
  };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

async function persistScores(rows) {
  if (rows.length === 0) return 0;
  // 일괄 insert
  const BATCH = 500;
  let n = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const values = [];
    const placeholders = [];
    for (const r of slice) {
      placeholders.push('(?,?,?,?,?,?,?,?,?,?,?)');
      values.push(
        r.code, String(r.date),
        r.value_score, r.momentum_score, r.quality_score,
        r.volatility_score, r.growth_score,
        r.liquidity_score ?? null, r.supply_score ?? null,
        r.total_score, r.rank,
      );
    }
    const sql = `
      INSERT INTO factor_scores
        (code, date, value_score, momentum_score, quality_score,
         volatility_score, growth_score, liquidity_score, supply_score,
         total_score, rank)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (code, date) DO UPDATE SET
        value_score = EXCLUDED.value_score,
        momentum_score = EXCLUDED.momentum_score,
        quality_score = EXCLUDED.quality_score,
        volatility_score = EXCLUDED.volatility_score,
        growth_score = EXCLUDED.growth_score,
        liquidity_score = EXCLUDED.liquidity_score,
        supply_score = EXCLUDED.supply_score,
        total_score = EXCLUDED.total_score,
        rank = EXCLUDED.rank
    `;
    await run(sql, values);
    n += slice.length;
  }
  return n;
}

module.exports = { calculateAll, persistScores, isExcludedProduct, classifyStatus, applyStatusPenalty, percentileScore };
