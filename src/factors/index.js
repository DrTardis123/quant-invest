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

function percentileScore(values, higherIsBetter = true) {
  // values: [{code, raw}] 또는 array of {raw}
  // null은 제외, 0-100 백분위로 변환
  const valid = values.filter((v) => v.raw !== null && v.raw !== undefined && Number.isFinite(v.raw));
  if (valid.length === 0) return new Map();
  const sorted = [...valid].sort((a, b) => higherIsBetter ? b.raw - a.raw : a.raw - b.raw);
  const rankMap = new Map();
  sorted.forEach((v, i) => rankMap.set(v.code, ((sorted.length - i) / sorted.length) * 100));
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
  const roeVals = fundamentals
    .filter((f) => f.roe !== null && f.roe > -50 && f.roe < 100)
    .map((f) => ({ code: f.code, raw: f.roe }));
  const roaVals = fundamentals
    .filter((f) => f.roa !== null && f.roa > -50 && f.roa < 50)
    .map((f) => ({ code: f.code, raw: f.roa }));
  const debtVals = fundamentals
    .filter((f) => f.debt_ratio !== null && f.debt_ratio > 0 && f.debt_ratio < 500)
    .map((f) => ({ code: f.code, raw: f.debt_ratio }));

  return avgMaps([
    percentileScore(roeVals, true),
    percentileScore(roaVals, true),
    percentileScore(debtVals, false),
  ]);
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
  // 최근 5일 종가 동일 + 거래량 0 → 거래정지
  // 최근 5일 평균 거래량이 전체 평균의 5% 미만 → 거래주의 (유동성 부족)
  return all(`
    WITH recent AS (
      SELECT code, date, close, volume,
             ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn,
             AVG(volume) OVER (PARTITION BY code) AS avg_vol_all
      FROM daily_prices
    )
    SELECT code,
           COUNT(*) FILTER (WHERE rn <= 5) AS recent_days,
           MAX(close) FILTER (WHERE rn <= 5) AS max_close,
           MIN(close) FILTER (WHERE rn <= 5) AS min_close,
           SUM(volume) FILTER (WHERE rn <= 5) AS vol5,
           AVG(avg_vol_all) AS avg_vol_all
    FROM recent
    GROUP BY code
  `);
}

function applyStatusPenalty(rows, statusMap) {
  // 거래정지: -80점 (사실상 0점)
  // 거래주의:  -30점 (유동성 부족)
  // 코스닥:    -3점 (작은 페널티, 무시할 수준)
  for (const r of rows) {
    const st = statusMap.get(r.code);
    if (!st) continue;
    if (st.max_close === st.min_close && Number(st.vol5) === 0) {
      r.total_score = Math.max(0, r.total_score - 80);
      r.status = 'halt';
    } else if (st.vol5 !== null && st.avg_vol_all > 0 && Number(st.vol5) < st.avg_vol_all * 0.05) {
      r.total_score = Math.max(0, r.total_score - 30);
      r.status = 'caution';
    } else {
      r.status = 'normal';
    }
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
  const rows = liquidity
    .filter((r) => r.turnover_20d > 0)
    .map((r) => ({ code: r.code, raw: Number(r.turnover_20d) }));
  return percentileScore(rows, true);
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

async function calculateAll(weights = null) {
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

  const v = calcValue(fundamentals);
  const m = calcMomentum(prices);
  const q = calcQuality(fundamentals);
  const lv = calcLowVol(prices);
  const g = calcGrowth(fundamentals, prevFundamentals);
  const liq = calcLiquidity(liquidity);
  const sup = calcSupply(supply);

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

  // 거래정지/거래주의 맵
  const statusMap = new Map(statusRows.map((s) => [s.code, s]));

  // market 정보 (코스닥 페널티용)
  const marketMap = new Map(fundamentals.map((f) => [f.code, f.market]));

  const rows = [];
  for (const code of codes) {
    const vs = v.get(code) ?? 50;
    const ms = m.get(code) ?? 50;
    const qs = q.get(code) ?? 50;
    const lvs = lv.get(code) ?? 50;
    const gs = g.get(code) ?? 50;
    const liqs = liq.get(code) ?? 50;
    const sups = sup.get(code) ?? 50;
    let total = (vs * wv + ms * wm + qs * wq + lvs * wlv + gs * wg + liqs * wliq + sups * wsup) / totalWeight;

    // 코스닥 작은 페널티 (-3점, 무시 가능한 수준)
    if (marketMap.get(code) === 'KOSDAQ') {
      total -= 3;
    }

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
    });
  }

  // 거래정지/거래주의 패널티 적용
  applyStatusPenalty(rows, statusMap);

  rows.sort((a, b) => b.total_score - a.total_score);
  rows.forEach((r, i) => (r.rank = i + 1));

  return { codes: [...codes], rows, asOf };
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
      placeholders.push('(?,?,?,?,?,?,?,?,?)');
      values.push(
        r.code, String(r.date),
        r.value_score, r.momentum_score, r.quality_score,
        r.volatility_score, r.growth_score, r.total_score, r.rank,
      );
    }
    const sql = `
      INSERT INTO factor_scores
        (code, date, value_score, momentum_score, quality_score,
         volatility_score, growth_score, total_score, rank)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (code, date) DO UPDATE SET
        value_score = EXCLUDED.value_score,
        momentum_score = EXCLUDED.momentum_score,
        quality_score = EXCLUDED.quality_score,
        volatility_score = EXCLUDED.volatility_score,
        growth_score = EXCLUDED.growth_score,
        total_score = EXCLUDED.total_score,
        rank = EXCLUDED.rank
    `;
    await run(sql, values);
    n += slice.length;
  }
  return n;
}

module.exports = { calculateAll, persistScores };
