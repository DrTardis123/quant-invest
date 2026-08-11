'use strict';

// 점수화 + 랭킹 + 분석 유틸
// - 등급화 (A+ ~ F)
// - 섹터 집계
// - 팩터 상관관계
// - 간단 백테스트

const { all, one, run } = require('../db/connection');

// ---------- 등급 ----------
function gradeFor(score) {
  if (score === null || score === undefined || !Number.isFinite(score)) return { letter: '—', label: '—', color: 'secondary' };
  if (score >= 80) return { letter: 'A+', label: 'Strong Buy', color: 'success' };
  if (score >= 70) return { letter: 'A',  label: 'Buy',         color: 'success' };
  if (score >= 60) return { letter: 'B+', label: 'Accumulate',  color: 'primary' };
  if (score >= 50) return { letter: 'B',  label: 'Hold',        color: 'secondary' };
  if (score >= 40) return { letter: 'C',  label: 'Watch',       color: 'warning' };
  if (score >= 30) return { letter: 'D',  label: 'Avoid',       color: 'warning' };
  return { letter: 'F', label: 'Sell', color: 'danger' };
}

// ---------- 섹터 점수 ----------
async function getSectorScores() {
  return all(`
    WITH latest AS (SELECT MAX(date) AS d FROM factor_scores)
    SELECT
      s.sector,
      s.market,
      COUNT(*) AS count,
      ROUND(AVG(fs.value_score), 1)     AS avg_value,
      ROUND(AVG(fs.momentum_score), 1)  AS avg_momentum,
      ROUND(AVG(fs.quality_score), 1)   AS avg_quality,
      ROUND(AVG(fs.volatility_score),1) AS avg_volatility,
      ROUND(AVG(fs.growth_score), 1)    AS avg_growth,
      ROUND(AVG(fs.total_score), 1)     AS avg_total,
      ROUND(MAX(fs.total_score), 1)     AS top_score,
      ROUND(MIN(fs.total_score), 1)     AS bottom_score
    FROM factor_scores fs
    JOIN stocks s ON s.code = fs.code
    WHERE fs.date = (SELECT d FROM latest)
      AND s.sector IS NOT NULL AND s.sector <> ''
    GROUP BY s.sector, s.market
    ORDER BY avg_total DESC
  `);
}

async function getMarketScores() {
  return all(`
    WITH latest AS (SELECT MAX(date) AS d FROM factor_scores)
    SELECT
      s.market,
      COUNT(*) AS count,
      ROUND(AVG(fs.total_score), 1) AS avg_total
    FROM factor_scores fs
    JOIN stocks s ON s.code = fs.code
    WHERE fs.date = (SELECT d FROM latest)
    GROUP BY s.market
    ORDER BY avg_total DESC
  `);
}

// ---------- 히트맵 데이터 ----------
async function getHeatmap({ limit = 80 } = {}) {
  return all(`
    WITH latest AS (SELECT MAX(date) AS d FROM factor_scores),
         price_latest AS (SELECT code, close FROM daily_prices
                          WHERE date = (SELECT MAX(date) FROM daily_prices))
    SELECT
      s.code, s.name, s.market, s.sector,
      fs.total_score, fs.value_score, fs.momentum_score,
      fs.quality_score, fs.volatility_score, fs.growth_score,
      fs.rank,
      COALESCE(s.listed_shares, 0) AS listed_shares,
      COALESCE(pl.close, 0) AS close_price,
      CAST(COALESCE(s.listed_shares, 0) AS BIGINT) * COALESCE(pl.close, 0) AS market_cap
    FROM factor_scores fs
    JOIN stocks s ON s.code = fs.code
    LEFT JOIN price_latest pl ON pl.code = s.code
    WHERE fs.date = (SELECT d FROM latest)
      AND s.market IN ('KOSPI','KOSDAQ')
      AND COALESCE(s.listed_shares, 0) * COALESCE(pl.close, 0) > 0
    ORDER BY market_cap DESC
    LIMIT ?
  `, [limit]);
}

// ---------- 상관관계 ----------
function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x; sy += y;
    sxx += x * x; syy += y * y;
    sxy += x * y; c++;
  }
  if (c < 3) return 0;
  const num = c * sxy - sx * sy;
  const den = Math.sqrt((c * sxx - sx * sx) * (c * syy - sy * sy));
  return den === 0 ? 0 : num / den;
}

async function getFactorCorrelation() {
  const rows = await all(`
    WITH latest AS (SELECT MAX(date) AS d FROM factor_scores)
    SELECT value_score, momentum_score, quality_score, volatility_score, growth_score
    FROM factor_scores WHERE date = (SELECT d FROM latest)
  `);
  const keys = ['value_score', 'momentum_score', 'quality_score', 'volatility_score', 'growth_score'];
  const matrix = {};
  for (const a of keys) {
    matrix[a] = {};
    for (const b of keys) {
      matrix[a][b] = pearson(rows.map((r) => r[a]), rows.map((r) => r[b]));
    }
  }
  return { keys, matrix };
}

// ---------- 백테스트 ----------
// 단순 백테스트: 매월 1회 리밸런싱, TOP N 동일가중
// KOSPI(KOSPI 지수 069500 또는 ^KS200 근사)는 daily_prices 에 없으므로
//   사용 가능하면 KOSPI 데이터를 가져와 비교. 없으면 전략 수익만.
async function backtest({ topN = 20, lookbackMonths = 12 } = {}) {
  // 1. 매월 말일자 factor_scores 스냅샷
  const snapshots = await all(`
    SELECT DISTINCT date FROM factor_scores
    WHERE date >= (SELECT MAX(date) FROM factor_scores) - INTERVAL '${Math.max(1, lookbackMonths)} months'
    ORDER BY date
  `);
  if (snapshots.length < 2) {
    return { ok: false, error: '점수 스냅샷이 부족합니다. 데이터가 쌓이면 다시 시도해주세요.' };
  }

  // 2. 매 스냅샷마다 TOP N 추출, 다음 스냅샷까지의 수익률 계산
  const monthlyReturns = [];
  for (let i = 0; i < snapshots.length - 1; i++) {
    const d1 = String(snapshots[i].date);
    const d2 = String(snapshots[i + 1].date);

    const top = await all(`
      SELECT code, total_score FROM factor_scores
      WHERE date = ?
      ORDER BY rank ASC
      LIMIT ?
    `, [d1, topN]);
    if (top.length === 0) continue;
    const codes = top.map((r) => r.code);

    // d1~d2 사이 각 종목의 종가 변화율 평균
    const priceRows = await all(`
      SELECT code,
             MIN(CASE WHEN date = (SELECT MIN(date) FROM daily_prices WHERE code = dp.code AND date >= ?) THEN close END) AS p1,
             MAX(CASE WHEN date = (SELECT MAX(date) FROM daily_prices WHERE code = dp.code AND date <= ?) THEN close END) AS p2
      FROM daily_prices dp
      WHERE code = ANY(?) AND date BETWEEN ? AND ?
      GROUP BY code
    `, [d1, d2, codes, d1, d2]);
    // DuckDB doesn't support ANY(?) easily; use IN list
    // Re-run with manual IN
    const placeholders = codes.map(() => '?').join(',');
    const safe = await all(
      `SELECT code,
              (SELECT close FROM daily_prices WHERE code = dp.code AND date >= ? ORDER BY date ASC LIMIT 1) AS p1,
              (SELECT close FROM daily_prices WHERE code = dp.code AND date <= ? ORDER BY date DESC LIMIT 1) AS p2
       FROM (SELECT DISTINCT code FROM daily_prices WHERE code IN (${placeholders}) AND date BETWEEN ? AND ?) dp`,
      [d1, d2, ...codes, d1, d2],
    );

    const rets = [];
    for (const r of safe) {
      if (r.p1 && r.p2) rets.push((r.p2 - r.p1) / r.p1);
    }
    if (rets.length === 0) continue;
    const avgRet = rets.reduce((a, b) => a + b, 0) / rets.length;
    monthlyReturns.push({ from: d1, to: d2, return: avgRet, count: rets.length });
  }

  if (monthlyReturns.length === 0) {
    return { ok: false, error: '백테스트 가능한 구간이 없습니다.' };
  }

  // 3. 누적 수익률, MDD, Sharpe
  const nav = [1];
  for (const m of monthlyReturns) nav.push(nav[nav.length - 1] * (1 + m.return));
  const totalReturn = nav[nav.length - 1] - 1;
  const months = monthlyReturns.length;
  const cagr = months >= 1 ? Math.pow(1 + totalReturn, 12 / months) - 1 : 0;
  const meanR = monthlyReturns.reduce((a, b) => a + b.return, 0) / months;
  const stdR = Math.sqrt(monthlyReturns.reduce((a, b) => a + (b.return - meanR) ** 2, 0) / months);
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(12) : 0;
  // MDD
  let peak = nav[0], mdd = 0;
  for (const v of nav) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }

  return {
    ok: true,
    topN,
    months,
    totalReturn,
    cagr,
    monthlyReturn: meanR,
    monthlyStd: stdR,
    sharpe,
    mdd,
    nav: nav.map((v, i) => ({ idx: i, value: v })),
    monthlyReturns,
  };
}

// ---------- 가중치 기반 재계산 (전략 프로파일 변경 시) ----------
// DB에 있는 factor_scores는 종합점수만 있고, 가중치별 분해 점수는 없음.
// 하지만 우리는 factor_scores 에 value/momentum/quality/volatility/growth 점수가 모두 있으므로
// 새 가중치로 재계산하여 "what-if" 점수만 메모리로 제공.
// (실제 점수 DB는 마지막 갱신 시의 가중치 그대로 유지)

function recomputeWithWeights(rows, weights) {
  const W = weights;
  const out = rows.map((r) => {
    // 7팩터 (liquidity/supply가 없으면 0 처리)
    const total = (
      (r.value_score || 0) * (W.value || 0) +
      (r.momentum_score || 0) * (W.momentum || 0) +
      (r.quality_score || 0) * (W.quality || 0) +
      (r.volatility_score || 0) * (W.volatility || 0) +
      (r.growth_score || 0) * (W.growth || 0) +
      (r.liquidity_score || 0) * (W.liquidity || 0) +
      (r.supply_score || 0) * (W.supply || 0)
    ) / 100;
    return { ...r, recomputed_total: Math.round(total * 100) / 100 };
  });
  out.sort((a, b) => b.recomputed_total - a.recomputed_total);
  out.forEach((r, i) => (r.recomputed_rank = i + 1));
  return out;
}

module.exports = {
  gradeFor,
  getSectorScores,
  getMarketScores,
  getHeatmap,
  getFactorCorrelation,
  backtest,
  recomputeWithWeights,
  pearson,
};
