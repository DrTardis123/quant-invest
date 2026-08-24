// 알파 백테스트 공용 엔진 (수정판)
//
// 기존 scratch/*.js 4개에 흩어져 있던 알파 계산 + 랭킹 + 시뮬 로직을 한 곳으로 모으고,
// 2026-08-23 검증에서 발견된 버그를 전부 수정한 버전.
//
// 수정 내역
//  [1] 재현성 : 알파 쿼리에 ORDER BY code, date 추가 (DuckDB 멀티스레드 행순서 비결정성 제거)
//  [2] 재현성 : 동점 처리를 평균 순위(average rank)로 변경. 기존 i/(n-1)은 DB 행순서에
//               따라 동점 종목에 서로 다른 랭크를 줘서 실행할 때마다 결과가 바뀌었음
//               (a_053은 하루 평균 6.9개, a_upday는 5.5개 값만 존재 → 87종목이 대량 동점)
//  [3] a_041  : vwap 자리에 AVG(volume*close)(=20일 평균 거래대금, ~54억)가 들어가
//               가격항(~1.8만원)을 30만배로 압도 → corr(a_041, -거래대금) = 0.99999999999.
//               실제 일별 VWAP = trading_value/volume 으로 교체하고 close로 나눠 무차원화
//  [4] 결측   : NaN을 0.5로 치환하던 것 제거. 상관계수 범위 [-1,1]에서 0.5는 상위권이라
//               "데이터 없는 종목"이 매수 대상이 됐음. 이제 해당 알파 랭킹에서 제외하고
//               남은 알파 가중치를 재정규화
//  [5] 체결   : 같은 날 종가 신호 → 같은 날 종가 매수(동시성 가정) 제거.
//               기본값을 t일 종가 신호 → t+1일 시가 매수 → t+21일 시가 매도로 변경
//  [6] 유동성 : 거래정지/저유동 종목 제외 필터 추가 (20일 평균 거래대금 하한)
//  [7] 평가   : 유니버스 동일가중 벤치마크를 같은 체결·비용 기준으로 계산해
//               초과수익과 t값을 함께 리포트 (절대수익만 보면 시장 베타를 알파로 착각)
//  [8] 탐색   : rng()+0.1 정규화(실효범위 1.6~40.7%, 균등 주변에 집중)를 진짜
//               Dirichlet(α) 샘플링으로 교체해 단체(simplex) 전체를 커버
//  [9] 통계   : Sharpe 표준오차, t값, Deflated Sharpe Ratio(Bailey & Lopez de Prado)
//               추가. 24~37 표본에서 SE가 0.58~0.72라 Sharpe 1.1은 0과 구분 불가
//
// 남은 한계 (코드로 못 고침, 리포트에 명시됨)
//  - 생존편향: DB에 상장폐지 종목이 없음. 5년 데이터가 있는 87종목은 전부 생존 종목
//  - MDD는 20일 비중첩 수익률 기준이라 실제 일중 낙폭보다 과소평가됨

'use strict';

const ALPHA_KEYS = [
  // ===== 모멘텀 (5) =====
  'a_mom5',          // 5일 모멘텀
  'a_mom20',         // 20일 모멘텀
  'a_mom60',         // 60일 모멘텀
  'a_mom5_neg',      // 5일 음의 모멘텀 = 양의 단기 반전
  'a_mom_clipped',   // 클리핑된 모멘텀

  // ===== 반전 (5) =====
  'a_053',           // 9일 중 신저가 갱신 비율
  'a_055',           // -1 * (low - close) * volume (매도 압력)
  'a_rev5',          // (close - c5) / c5
  'a_rev10',         // (close - c10) / c10
  'a_no_new_high',   // 9일 중 신고가 미갱신 비율

  // ===== 거래량 (5) =====
  'a_006',           // -corr(open, volume, 10)
  'a_010',           // SIGN(close - close_lag4) — 단기 반전 (실은 거래량 카테고리)
  'a_vol_rank',      // -1 * PERCENT_RANK(volume)
  'a_006_pos',       // +corr(close, volume, 10)
  'a_dolv_rank',     // -1 * PERCENT_RANK(volume * close)

  // ===== 변동성 (5) =====
  'a_017',           // rank(close - vwap) — 추세 강도
  'a_034',           // stddev(returns, 5)
  'a_vol20',         // stddev(returns, 20)
  'a_range_pct',     // (high - low) / close
  'a_path5',         // |close - c5| / c5

  // ===== 추세 (5) =====
  'a_009',           // -corr(rank_open, rank_close, 10)
  'a_022',           // (close - close_lag5) / adv5
  'a_trend20_sign',  // SIGN(close - c20)
  'a_trend_score',   // 클리핑된 추세 점수
  'a_up_ratio_20',   // 20일 중 close > c5 비율

  // ===== 유동성 (5) =====
  'a_028',           // LN(turnover_20d + 1)
  'a_041',           // (sqrt(high*low) - vwap) / close
  'a_liq_lev',       // trading_value / 1e8
  'a_liq_rank',      // PERCENT_RANK(trading_value)
  'a_liq_score',     // LEAST(100, adv20_pv / 1e6)
];
// 총 30개, 카테고리별 5개

const ALPHA_DESC = {
  a_003: '-corr(rank(open), rank(volume), 10)',
  a_006: '-corr(open, volume, 10)',
  a_009: '-corr(rank(open), rank(close), 10)',
  a_010: 'SIGN(close - close_lag4) — 단기 반전',
  a_017: '(close - vwap) / close — 추세 강도',
  a_022: '(close - close_lag5) / adv5 — 모멘텀+거래량',
  a_028: 'LN(turnover_20d + 1) — 유동성',
  a_034: 'stddev(returns, 5) — 단기 변동성',
  a_041: '(sqrt(high*low) - vwap) / close',
  a_053: '9일 중 신저가 갱신 비율 (t-1까지, 평균회귀)',
  a_055: '-1 * (low - close) * volume — 매도 압력',
  a_mom5: '5일 모멘텀',
  a_mom20: '20일 모멘텀',
  a_mom60: '60일 모멘텀',
  a_mom5_neg: '(c5 - close) / close — 5일 음의 모멘텀',
  a_mom_clipped: 'LEAST(1, GREATEST(-1, (c5 - c20) / c20)) — 클리핑된 모멘텀',
  a_upday: '5일 중 신고가 갱신 비율',
  a_rev5: '(close - c5) / c5 — 5일 양의 반전',
  a_rev10: '(close - c10) / c10 — 10일 양의 반전',
  a_rev20: '(close - c20) / c20 — 20일 양의 반전',
  a_no_new_high: '9일 중 신고가 미갱신 비율 (반전 신호)',
  a_vol_rank: '-1 * PERCENT_RANK(volume) — 일중 거래량 순위',
  a_vol_ratio: 'volume / ADV20 — 일중 거래량 / 20일 평균',
  a_006_pos: '+corr(close, volume, 10) — 가격-거래량 양의 상관',
  a_dolv_rank: '-1 * PERCENT_RANK(volume * close) — 거래대금 순위',
  a_vol20: 'stddev(returns, 20) — 20일 변동성',
  a_range_pct: '(high - low) / close — 일중 변동 폭',
  a_hlv_vwap: '(sqrt(high*low) - vwap) — 가격괴리',
  a_path5: '|close - c5| / c5 — 5일 path-dependent 변동성',
  a_trend20_sign: 'SIGN(close - c20) — 20일 추세 부호',
  a_trend60_sign: 'SIGN(close - c60) — 60일 추세 부호',
  a_trend_score: 'LEAST(1, GREATEST(-1, (close - c20) / c20 * 5)) — 추세 점수',
  a_up_ratio_20: '20일 중 close > c5 비율',
  a_liq_lev: 'trading_value / 1e8 — 거래대금 (억원)',
  a_liq_pass: 'CASE WHEN adv20_pv > 5e8 THEN 1 ELSE 0 — 유동성 통과',
  a_liq_rank: 'PERCENT_RANK(trading_value) — 거래대금 순위',
  a_liq_score: 'LEAST(100, adv20_pv / 1e6) — 유동성 점수',
  a_size_vol: '20일 stddev(close) / close — 변동성-규모 보정',
};

const ALPHA_CATEGORY = {
  // 모멘텀
  a_mom5: '모멘텀', a_mom20: '모멘텀', a_mom60: '모멘텀', a_mom5_neg: '모멘텀', a_mom_clipped: '모멘텀',
  // 반전
  a_053: '반전', a_055: '반전', a_rev5: '반전', a_rev10: '반전', a_no_new_high: '반전',
  // 거래량
  a_006: '거래량', a_010: '거래량', a_vol_rank: '거래량', a_006_pos: '거래량', a_dolv_rank: '거래량',
  // 변동성
  a_017: '변동성', a_034: '변동성', a_vol20: '변동성', a_range_pct: '변동성', a_path5: '변동성',
  // 추세
  a_009: '추세', a_022: '추세', a_trend20_sign: '추세', a_trend_score: '추세', a_up_ratio_20: '추세',
  // 유동성
  a_028: '유동성', a_041: '유동성', a_liq_lev: '유동성', a_liq_rank: '유동성', a_liq_score: '유동성',
};

const DEFAULTS = {
  startDate: '2021-08-22',
  minHistory: 1000,      // 유니버스 편입에 필요한 최소 거래일 수
  topN: 3,
  rebalDays: 20,
  holdDays: 20,
  cost: 0.006,           // round trip (단순)
  minTurnover: 5e8,      // 20일 평균 거래대금 하한 (5억). 0이면 필터 해제
  execution: 'next_open', // 'next_open' | 'same_close'
  minWeightCoverage: 0.5, // 종목이 살아남으려면 확보돼야 하는 알파 가중치 비율
  // [신규] 현실적 비용 모델 파라미터
  costModel: {
    enabled: false,           // true면 cost 대신 costModel 사용
    baseCost: 0.0015,         // 기본 round trip 0.15% (증권사 수수료 + 세금)
    slippage: 0.0005,         // 슬리피지 5bps
    marketImpactCoef: 0.001,  // 시장 충격 계수 (1bp per 1% of ADV)
    spreadHalf: 0.001,        // 평균 스프레드 (호가 단위) 10bps
  },
};

// ─────────────────────────────────────────────────────────────
// 난수: mulberry32 (기존 LCG는 주기 233280으로 너무 짧았음)
// ─────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNormal(rng) {
  let spare = null;
  return function normal() {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u, v, s;
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * f;
    return u * f;
  };
}

// Marsaglia-Tsang gamma 샘플러 → 진짜 Dirichlet
function makeDirichlet(rng) {
  const normal = makeNormal(rng);
  function gamma(alpha) {
    if (alpha < 1) return gamma(alpha + 1) * Math.pow(rng(), 1 / alpha);
    const d = alpha - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = normal(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = rng();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  return function dirichlet(k, alpha = 1) {
    const g = []; let s = 0;
    for (let i = 0; i < k; i++) { const x = gamma(alpha); g.push(x); s += x; }
    return g.map((x) => x / s);
  };
}

// ─────────────────────────────────────────────────────────────
// 정규분포 CDF / 역함수 (Deflated Sharpe 계산용)
// ─────────────────────────────────────────────────────────────
function normCdf(x) {
  // Abramowitz-Stegun 7.1.26 기반 erf 근사
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

function normInv(p) {
  // Acklam 근사
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ─────────────────────────────────────────────────────────────
// 1) 알파 패널 로딩
// ─────────────────────────────────────────────────────────────
function buildSql(opts) {
  const { startDate, minHistory } = opts;
  return `
    WITH universe AS (
      SELECT code FROM daily_prices
      WHERE date >= '${startDate}'
      GROUP BY code
      HAVING COUNT(*) >= ${minHistory}
    ),
    base AS (
      SELECT
        dp.code, dp.date, dp.open, dp.high, dp.low, dp.close, dp.volume, dp.trading_value,
        -- [3] 진짜 일별 VWAP. 거래 없는 날은 typical price로 대체
        CASE WHEN dp.volume > 0 AND dp.trading_value > 0
             THEN dp.trading_value / CAST(dp.volume AS DOUBLE)
             ELSE (dp.high + dp.low + dp.close) / 3.0 END AS vwap,
        -- [6] 유동성 필터용 20일 평균 거래대금 (당일 포함, 미래 미참조)
        AVG(CASE WHEN dp.trading_value > 0 THEN dp.trading_value END)
            OVER (PARTITION BY dp.code ORDER BY dp.date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS turnover_20d,
        -- PERCENT_RANK (cross-sectional)
        PERCENT_RANK() OVER (PARTITION BY dp.date ORDER BY dp.open)   AS rank_open,
        PERCENT_RANK() OVER (PARTITION BY dp.date ORDER BY dp.volume) AS rank_vol,
        PERCENT_RANK() OVER (PARTITION BY dp.date ORDER BY dp.close)  AS rank_close,
        PERCENT_RANK() OVER (PARTITION BY dp.date ORDER BY dp.volume * dp.close) AS rank_dolv,
        -- LAG 컬럼
        LAG(dp.close, 1)  OVER (PARTITION BY dp.code ORDER BY dp.date) AS close_lag1,
        LAG(dp.close, 4)  OVER (PARTITION BY dp.code ORDER BY dp.date) AS close_lag4,
        LAG(dp.close, 5)  OVER (PARTITION BY dp.code ORDER BY dp.date) AS close_lag5,
        LAG(dp.close, 10) OVER (PARTITION BY dp.code ORDER BY dp.date) AS close_lag10,
        LAG(dp.close, 20) OVER (PARTITION BY dp.code ORDER BY dp.date) AS close_lag20,
        LAG(dp.close, 60) OVER (PARTITION BY dp.code ORDER BY dp.date) AS close_lag60,
        LAG(dp.low, 1)    OVER (PARTITION BY dp.code ORDER BY dp.date) AS low_lag1,
        LAG(dp.high, 1)   OVER (PARTITION BY dp.code ORDER BY dp.date) AS high_lag1,
        -- ADV5/20: 평균 거래대금 (가격×거래량)
        AVG(dp.volume * dp.close) OVER (PARTITION BY dp.code ORDER BY dp.date ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) AS adv5_pv,
        AVG(dp.volume * dp.close) OVER (PARTITION BY dp.code ORDER BY dp.date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS adv20_pv
      FROM daily_prices dp
      JOIN universe u ON dp.code = u.code
      WHERE dp.date >= '${startDate}'
        AND dp.close > 0 AND dp.open > 0 AND dp.high > 0 AND dp.low > 0
    ),
    alphas AS (
      SELECT
        code, date, open, high, low, close, volume, trading_value, vwap, turnover_20d,
        rank_open, rank_vol, rank_close, rank_dolv, adv5_pv, adv20_pv,
        close_lag1, close_lag4, close_lag5, close_lag10, close_lag20, close_lag60,
        low_lag1, high_lag1,
        -- ===== 모멘텀 (5) =====
        -1 * CORR(rank_open, rank_vol)   OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS a_003,
        -1 * CORR(open, volume)          OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS a_006,
        -1 * CORR(rank_open, rank_close) OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS a_009,
        (POWER(high * low, 0.5) - vwap) / close AS a_041,
        SUM(CASE WHEN low < low_lag1 THEN 1 ELSE 0 END)
            OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 8 PRECEDING AND 1 PRECEDING) / 9.0 AS a_053,
        (close - close_lag5)  / CAST(close_lag5  AS DOUBLE) AS a_mom5,
        (close - close_lag20) / CAST(close_lag20 AS DOUBLE) AS a_mom20,
        SUM(CASE WHEN high > high_lag1 THEN 1 ELSE 0 END)
            OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) / 5.0 AS a_upday,
        -- === 다양화 22개 ===
        -- a_010: 4일 단기 반전
        SIGN(close - close_lag4) AS a_010,
        -- a_017: 추세 강도 (close vs vwap)
        (close - vwap) / close AS a_017,
        -- a_022: 모멘텀+거래량 (5일 모멘텀 / ADV5)
        (close - close_lag5) / NULLIF(adv5_pv, 0) AS a_022,
        -- a_028: 유동성 점수 (log ADV20)
        LN(turnover_20d + 1) AS a_028,
        -- a_034: 단기 변동성 (5일 stddev)
        STDDEV((close - close_lag1) / NULLIF(close_lag1, 0))
            OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) AS a_034,
        -- a_055: 매도 압력 (저가-종가 × 거래량)
        -1 * (low - close) * volume / 1e8 AS a_055,
        -- ===== 모멘텀 다양화 3개 =====
        (close - close_lag60) / CAST(close_lag60 AS DOUBLE) AS a_mom60,
        (close_lag5 - close) / CAST(close AS DOUBLE) AS a_mom5_neg,
        LEAST(1.0, GREATEST(-1.0, (close_lag5 - close_lag20) / NULLIF(close_lag20, 0))) AS a_mom_clipped,
        -- ===== 반전 다양화 4개 =====
        (close - close_lag5) / CAST(close_lag5 AS DOUBLE) AS a_rev5,
        (close - close_lag10) / CAST(close_lag10 AS DOUBLE) AS a_rev10,
        (close - close_lag20) / CAST(close_lag20 AS DOUBLE) AS a_rev20,
        SUM(CASE WHEN high > high_lag1 THEN 0 ELSE 1 END)
            OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 8 PRECEDING AND 1 PRECEDING) / 9.0 AS a_no_new_high,
        -- ===== 거래량 다양화 4개 =====
        -1 * rank_vol AS a_vol_rank,
        volume / NULLIF(adv20_pv / NULLIF(close, 0), 0) AS a_vol_ratio,
        CORR(close, volume) OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS a_006_pos,
        -1 * rank_dolv AS a_dolv_rank,
        -- ===== 변동성 다양화 4개 =====
        STDDEV((close - close_lag1) / NULLIF(close_lag1, 0))
            OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS a_vol20,
        (high - low) / NULLIF(close, 0) AS a_range_pct,
        (POWER(high * low, 0.5) - vwap) AS a_hlv_vwap,
        ABS(close - close_lag5) / NULLIF(close_lag5, 0) AS a_path5,
        -- ===== 추세 다양화 4개 =====
        SIGN(close - close_lag20) AS a_trend20_sign,
        SIGN(close - close_lag60) AS a_trend60_sign,
        LEAST(1.0, GREATEST(-1.0, (close - close_lag20) / NULLIF(close_lag20, 0) * 5)) AS a_trend_score,
        SUM(CASE WHEN close > close_lag5 THEN 1 ELSE 0 END)
            OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) / 20.0 AS a_up_ratio_20,
        -- ===== 유동성 다양화 5개 =====
        trading_value / 1e8 AS a_liq_lev,
        CASE WHEN adv20_pv > 5e8 THEN 1 ELSE 0 END AS a_liq_pass,
        PERCENT_RANK() OVER (PARTITION BY date ORDER BY trading_value) AS a_liq_rank,
        LEAST(100.0, adv20_pv / 1e6) AS a_liq_score,
        STDDEV(close) OVER (PARTITION BY code ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) / NULLIF(close, 0) AS a_size_vol
      FROM base
    )
    SELECT code, date, open, high, low, close, volume, trading_value, vwap, turnover_20d,
           ${ALPHA_KEYS.join(', ')}
    FROM alphas
    ORDER BY code, date          -- [1] 재현성의 핵심
  `;
}

async function loadPanel(db, userOpts = {}) {
  const opts = { ...DEFAULTS, ...userOpts };
  const rows = await db.all(buildSql(opts));

  const byCode = new Map();
  for (const r of rows) {
    const rec = {
      code: r.code,
      dateStr: String(r.date).slice(0, 10),
      open: Number(r.open),
      close: Number(r.close),
      turnover20: r.turnover_20d === null ? null : Number(r.turnover_20d),
      volume: Number(r.volume),
    };
    for (const k of ALPHA_KEYS) {
      const v = Number(r[k]);
      rec[k] = Number.isFinite(v) ? v : null;   // [4] NaN은 null로, 0.5 치환 금지
    }
    if (!byCode.has(rec.code)) byCode.set(rec.code, []);
    byCode.get(rec.code).push(rec);
  }

  // [5] 체결 가정에 맞춘 forward return
  //     next_open : t 종가 신호 → t+1 시가 진입 → t+1+hold 시가 청산
  //     same_close: t 종가 신호 → t 종가 진입 → t+hold 종가 청산 (기존 방식, 비교용)
  const hold = opts.holdDays;
  for (const [, arr] of byCode) {
    arr.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    for (let i = 0; i < arr.length; i++) {
      if (opts.execution === 'same_close') {
        const exit = i + hold < arr.length ? arr[i + hold].close : null;
        arr[i].fwd = exit !== null ? (exit - arr[i].close) / arr[i].close : null;
      } else {
        const entryRow = i + 1 < arr.length ? arr[i + 1] : null;
        const exitRow = i + 1 + hold < arr.length ? arr[i + 1 + hold] : null;
        arr[i].fwd = entryRow && exitRow && entryRow.open > 0
          ? (exitRow.open - entryRow.open) / entryRow.open
          : null;
      }
    }
  }

  const byDate = new Map();
  for (const [, arr] of byCode) {
    for (const r of arr) {
      if (!byDate.has(r.dateStr)) byDate.set(r.dateStr, []);
      byDate.get(r.dateStr).push(r);
    }
  }
  // 날짜별 종목 순서도 코드순으로 고정 (완전 결정론)
  for (const [, arr] of byDate) arr.sort((a, b) => a.code.localeCompare(b.code));

  const allDates = [...byDate.keys()].sort();
  const rebalDates = allDates.filter((_, i) => i % opts.rebalDays === 0);

  return { opts, byCode, byDate, allDates, rebalDates, nRows: rows.length };
}

// ─────────────────────────────────────────────────────────────
// 2) 일자별 cross-sectional 평균순위 랭킹
//    [2] 동점은 평균 순위, [4] 결측은 제외(null)
// ─────────────────────────────────────────────────────────────
function averageRank(values) {
  // values: [{key, v}] (v는 유한값만). 반환: Map(key → 0~1 평균순위)
  const out = new Map();
  const n = values.length;
  if (n === 0) return out;
  if (n === 1) { out.set(values[0].key, 0.5); return out; }
  const sorted = [...values].sort((a, b) => (a.v - b.v) || a.key.localeCompare(b.key));
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].v === sorted[i].v) j++;
    const avgIdx = (i + j) / 2;          // 동점 구간의 평균 인덱스
    const norm = avgIdx / (n - 1);
    for (let k = i; k <= j; k++) out.set(sorted[k].key, norm);
    i = j + 1;
  }
  return out;
}

function buildRanks(panel) {
  const { byDate, opts } = panel;
  const ranksByDate = new Map();
  for (const [date, rows] of byDate) {
    // [6] 유동성 필터: 20일 평균 거래대금 하한 + 당일 거래 존재
    const eligible = rows.filter((r) =>
      r.volume > 0 && (opts.minTurnover <= 0 || (r.turnover20 !== null && r.turnover20 >= opts.minTurnover)));

    const perAlpha = {};
    for (const k of ALPHA_KEYS) {
      const vals = [];
      for (const r of eligible) if (r[k] !== null) vals.push({ key: r.code, v: r[k] });
      perAlpha[k] = averageRank(vals);
    }
    const m = new Map();
    for (const r of eligible) {
      const obj = {};
      for (const k of ALPHA_KEYS) {
        const v = perAlpha[k].get(r.code);
        obj[k] = v === undefined ? null : v;
      }
      m.set(r.code, obj);
    }
    ranksByDate.set(date, m);
  }
  return ranksByDate;
}

// ─────────────────────────────────────────────────────────────
// 2.5) 가중치 계산 (균등 + IC + IC × cross-correlation 보정)
// ─────────────────────────────────────────────────────────────

/**
 * 균등 가중치 (기본값)
 * @returns {number[]} ALPHA_KEYS 길이의 1/N 가중치
 */
function equalWeights() {
  const n = ALPHA_KEYS.length;
  return new Array(n).fill(1 / n);
}

/**
 * IC 가중치 (절댓값 t-stat 비례)
 * @param {Object} icResults - {alpha: {t, n, mean}}
 * @returns {number[]} t 부호 보존 + 절댓값 가중치 (정규화)
 */
function icWeights(icResults, options = {}) {
  const { minT = 0, shrinkage = 0.2 } = options;
  const raw = ALPHA_KEYS.map((k) => {
    const r = icResults[k];
    if (!r || !Number.isFinite(r.t)) return 0;
    // 부호 보존: t가 양수면 양의 가중치, 음수면 음의 가중치
    return r.t;
  });
  // 음수는 그대로 (반전 알파), 양수도 그대로
  // 절댓값으로 가중치 계산 후 부호 복원
  const abs = raw.map((x) => Math.abs(x));
  const max = Math.max(...abs);
  if (max === 0) return equalWeights();
  // Shrinkage toward equal weights
  const equal = equalWeights();
  const norm = abs.map((x) => (x / max) * (1 - shrinkage) + (1 / ALPHA_KEYS.length) * shrinkage);
  // 부호 복원
  const signed = norm.map((x, i) => x * Math.sign(raw[i] || 1));
  // 양수로 정규화 (음수는 long-short 의미지만 단순화)
  // 실제로는 scoreDate가 signed 가중치를 받음
  // sum 절댓값 = 1
  const sumAbs = signed.reduce((a, b) => a + Math.abs(b), 0);
  if (sumAbs === 0) return equal;
  return signed.map((x) => x / sumAbs);
}

/**
 * Cross-correlation 보정 가중치 (inverse-vol shrinkage)
 * — k개의 알파가 서로 상관관계가 높으면, 가중치를 1/k로 축소
 * — 각 알파의 "독립적 기여도" = sum_i (1 - |corr(alpha, alpha_i)|) / K
 * — Ledoit-Wolf 스타일 shrinkage
 * @param {Object} icResults - {alpha: {t, n, mean}}
 * @param {Object<string, number>} corrMap - 'alpha_a ↔ alpha_b' -> correlation
 * @param {Object} options - {shrinkage: 0~1, minT: 0}
 * @returns {number[]} 보정된 가중치
 */
function corrAdjustedWeights(icResults, corrMap, options = {}) {
  const { shrinkage = 0.5, minT = 0 } = options;
  const n = ALPHA_KEYS.length;
  // 1) IC 가중치 (부호 보존)
  const rawIc = ALPHA_KEYS.map((k) => {
    const r = icResults[k];
    return (r && Number.isFinite(r.t)) ? r.t : 0;
  });
  const absIc = rawIc.map((x) => Math.abs(x));
  const maxIc = Math.max(...absIc);
  if (maxIc === 0) return equalWeights();
  // 2) Cross-correlation 행렬 (NxN)
  // corr(alpha_i, alpha_j) lookup
  const corrOf = (i, j) => {
    if (i === j) return 1;
    const a = ALPHA_KEYS[i], b = ALPHA_KEYS[j];
    const k1 = `${a} ↔ ${b}`;
    const k2 = `${b} ↔ ${a}`;
    if (k1 in corrMap) return corrMap[k1];
    if (k2 in corrMap) return corrMap[k2];
    return 0;
  };
  // 3) 각 알파의 "독립성 점수" = (N - sum|corr(i,j)|) / N
  //     → corr이 높은 알파일수록 가중치 ↓
  const indep = new Array(n);
  for (let i = 0; i < n; i++) {
    let sumAbsCorr = 0;
    for (let j = 0; j < n; j++) sumAbsCorr += Math.abs(corrOf(i, j));
    indep[i] = (n - sumAbsCorr) / n;  // 0 (완전 중복) ~ 1 (독립)
  }
  // 4) 가중치 결합: IC × 독립성
  //     shrinkage toward equal weights
  const equal = equalWeights();
  const w = new Array(n);
  for (let i = 0; i < n; i++) {
    const icComponent = (absIc[i] / maxIc);
    const indepComponent = Math.max(0.1, indep[i]);  // 완전 중복이어도 0.1 floor
    w[i] = (icComponent * indepComponent) * (1 - shrinkage) + equal[i] * shrinkage;
  }
  // 5) 부호 복원 (t 부호) + 정규화
  const signed = w.map((x, i) => x * Math.sign(rawIc[i] || 1));
  const sumAbs = signed.reduce((a, b) => a + Math.abs(b), 0);
  if (sumAbs === 0) return equal;
  return signed.map((x) => x / sumAbs);
}

/**
 * 30 알파 → 카테고리별 1개씩 + IC 가중치 (분산 추천)
 * @param {Object} icResults - {alpha: {t, n, mean}}
 * @returns {{picks: string[], weights: number[]}} 카테고리별 best 1개
 */
function categoryBestWeights(icResults) {
  const byCategory = {};
  for (const k of ALPHA_KEYS) {
    const c = ALPHA_CATEGORY[k] || '?';
    if (!byCategory[c]) byCategory[c] = [];
    byCategory[c].push(k);
  }
  // 카테고리 내 IC 절댓값 최대 알파 선택
  const picks = [];
  const cats = Object.keys(byCategory).sort();
  for (const c of cats) {
    let best = null, bestT = -Infinity;
    for (const k of byCategory[c]) {
      const r = icResults[k];
      if (!r || !Number.isFinite(r.t)) continue;
      if (Math.abs(r.t) > bestT) { bestT = Math.abs(r.t); best = k; }
    }
    if (best) picks.push(best);
  }
  // picks의 t 부호로 가중치
  const weights = new Array(ALPHA_KEYS.length).fill(0);
  for (const k of picks) {
    const i = ALPHA_KEYS.indexOf(k);
    weights[i] = Math.sign(icResults[k].t);
  }
  return { picks, weights };
}

/**
 * [신규] Regime-conditioned 가중치 (HMM regime별 알파 가중치)
 *
 * regime별 IC를 별도 계산해 regime별로 다른 가중치 벡터 산출.
 * low_vol (안정) → 모멘텀/추세 알파 강화
 * mid_vol (중립) → 균등
 * high_vol (공포) → 반전/저변동 알파 강화
 *
 * @param {Object} icByRegime - {regime: {alpha: {t, n, mean}}, ...} (regime별 IC)
 * @param {Object} [options] - {method: 'categoryBest'|'icWeighted'|'equal', smoothing: 0.3}
 * @returns {Object} {weights: {regime: number[]}, picks: {regime: string[]}, regime: {regime: {mu, sigma, nDays}}}
 */
function regimeConditionedWeights(icByRegime, options = {}) {
  const { method = 'categoryBest', smoothing = 0.3 } = options;
  const n = ALPHA_KEYS.length;
  const out = { weights: {}, picks: {}, regimes: {} };
  for (const [regime, icRes] of Object.entries(icByRegime)) {
    let w, picks;
    if (method === 'categoryBest') {
      const cb = categoryBestWeights(icRes);
      w = cb.weights;
      picks = cb.picks;
    } else if (method === 'icWeighted') {
      w = icWeights(icRes, { shrinkage: smoothing });
      picks = ALPHA_KEYS.filter((_, i) => Math.abs(w[i]) > 0.01);
    } else {
      w = new Array(n).fill(1 / n);
      picks = [...ALPHA_KEYS];
    }
    out.weights[regime] = w;
    out.picks[regime] = picks;
    out.regimes[regime] = {
      nDays: Object.values(icRes).reduce((a, b) => Math.max(a, b.n || 0), 0),
    };
  }
  return out;
}

/**
 * [신규] 주어진 날짜에 regime 조회 (regime history 기반)
 * @param {string} date - 'YYYY-MM-DD'
 * @param {Array<{date, state}>} regimeHistory
 * @returns {string} regime (low_vol/mid_vol/high_vol)
 */
function lookupRegime(date, regimeHistory) {
  if (!regimeHistory || regimeHistory.length === 0) return 'mid_vol';
  // 가장 가까운 과거 regime 찾기
  let best = regimeHistory[0];
  for (const r of regimeHistory) {
    if (r.date <= date) best = r;
    else break;
  }
  return best.state;
}

/**
 * [신규] Regime-aware strategy returns (날짜별로 다른 가중치 적용)
 * @param {Object} panel
 * @param {Map} ranksByDate
 * @param {Object} weightsByRegime - {regime: number[]}
 * @param {Array<{date, state}>} regimeHistory
 * @param {Array} dates
 * @param {Object} [o]
 * @returns {number[]}
 */
function strategyReturnsRegime(panel, ranksByDate, weightsByRegime, regimeHistory, dates, o = {}) {
  const { opts } = panel;
  const cost = o.cost === undefined ? opts.cost : o.cost;
  const rets = [];
  for (const date of dates) {
    const ranks = ranksByDate.get(date);
    if (!ranks || ranks.size === 0) continue;
    const regime = lookupRegime(date, regimeHistory);
    const weights = weightsByRegime[regime] || weightsByRegime.mid_vol || new Array(ALPHA_KEYS.length).fill(1 / ALPHA_KEYS.length);
    const scored = scoreDate(ranks, weights, opts.minWeightCoverage);
    const picks = [];
    for (const s of scored) {
      const f = fwdOf(panel, s.code, date);
      if (f === null || !Number.isFinite(f)) continue;
      picks.push(f);
      if (picks.length === opts.topN) break;
    }
    if (picks.length === opts.topN) {
      rets.push(picks.reduce((a, b) => a + b, 0) / opts.topN - cost);
    }
  }
  return rets;
}

/**
 * 다중 가설 보정 (Bonferroni + Benjamini-Hochberg FDR)
 * — 30 알파 동시 검정 시 family-wise error 증가
 * — Bonferroni: p × N (보수적)
 * — BH-FDR: sorted p-values, k/N × α (덜 보수적, FDR 제어)
 * @param {Object} icResults - {alpha: {t, n, mean}}
 * @param {Object} [options] - {method: 'bonferroni'|'bh'|'both', alpha: 0.05}
 * @returns {Object} {alpha: {p, pAdj, t, significant, ...}}
 */
function multipleTestingCorrection(icResults, options = {}) {
  const { method = 'both', alpha = 0.05 } = options;
  const N = ALPHA_KEYS.length;
  function tToP(t, df) {
    if (!Number.isFinite(t)) return 1;
    // 정규분포 근사 (df>30이면 충분)
    return 2 * (1 - normCdf(Math.abs(t)));
  }
  // 각 알파 p-value
  const pvals = {};
  for (const k of ALPHA_KEYS) {
    const r = icResults[k];
    const t = (r && Number.isFinite(r.t)) ? r.t : 0;
    pvals[k] = tToP(t, (r?.n || 1000) - 2);
  }
  // Bonferroni: p_adj = min(p * N, 1)
  const bonf = {};
  for (const k of ALPHA_KEYS) {
    bonf[k] = Math.min(pvals[k] * N, 1);
  }
  // BH-FDR: sorted p-values (작은 → 큰)
  const sorted = Object.entries(pvals).sort((a, b) => a[1] - b[1]);
  // 큰 rank부터 작은 rank로 (역순) - 보정 누적
  const adjusted = new Array(N);
  for (let i = N - 1; i >= 0; i--) {
    const [k, p] = sorted[i];
    const rank = i + 1;
    const raw = p * N / rank;
    adjusted[i] = i === N - 1 ? Math.min(raw, 1) : Math.min(raw, adjusted[i + 1]);
  }
  const bh = {};
  for (let i = 0; i < N; i++) {
    bh[sorted[i][0]] = adjusted[i];
  }
  // 결과
  const out = {};
  for (const k of ALPHA_KEYS) {
    const r = icResults[k];
    out[k] = {
      ...(r || {}),
      p: pvals[k],
      pBonf: bonf[k],
      pBH: bh[k],
      sigRaw: pvals[k] < alpha,
      sigBonf: bonf[k] < alpha,
      sigBH: bh[k] < alpha,
    };
  }
  return out;
}

/**
 * Bonferroni 보정 후 진짜 유의미한 알파 (p_adj < alpha)
 * @param {Object} icResults
 * @param {Object} [options]
 * @returns {string[]} 알파 키 배열
 */
function significantAlphas(icResults, options = {}) {
  const { method = 'BH', alpha = 0.05 } = options;
  const adj = multipleTestingCorrection(icResults);
  return Object.entries(adj)
    .filter(([k, v]) => method === 'BH' ? v.sigBH : v.sigBonf)
    .map(([k]) => k);
}

/**
 * [신규] Regime별 알파 IC 계산 (JS, ranksByDate 활용)
 *
 * @param {Object} panel
 * @param {Map} ranksByDate - buildRanks() 결과
 * @param {Array<{date, state}>} regimeHistory - lookupRegime()로 regime 조회
 * @param {Object} [options] - {minN: 100, alphaKeys: [...]} (기본: ALPHA_KEYS 전체)
 * @returns {Object} {regime: {alpha: {ic, t, n, mean, std}}}
 */
function computeRegimeICs(panel, ranksByDate, regimeHistory, options = {}) {
  const { minN = 50, alphaKeys = ALPHA_KEYS } = options;
  // regime별 알파-수익률 pair 수집
  const pairsByRegime = {};
  for (const r of regimeHistory) {
    if (!pairsByRegime[r.state]) {
      const obj = {};
      for (const a of alphaKeys) obj[a] = [];
      pairsByRegime[r.state] = obj;
    }
  }
  for (const [date, ranks] of ranksByDate) {
    const regime = lookupRegime(date, regimeHistory);
    if (!pairsByRegime[regime]) continue;
    for (const [code, ar] of ranks) {
      const ret1d = fwdOf(panel, code, date);
      if (ret1d === null || !Number.isFinite(ret1d)) continue;
      for (const a of alphaKeys) {
        const v = ar[a];
        if (v === null || !Number.isFinite(v)) continue;
        pairsByRegime[regime][a].push([v, ret1d]);
      }
    }
  }
  // regime별 알파 IC 계산
  const result = {};
  for (const [regime, alphaPairs] of Object.entries(pairsByRegime)) {
    result[regime] = {};
    for (const [alpha, pairs] of Object.entries(alphaPairs)) {
      if (pairs.length < minN) {
        result[regime][alpha] = { ic: 0, t: 0, n: pairs.length, mean: 0, std: 0 };
        continue;
      }
      const n = pairs.length;
      const sumX = pairs.reduce((a, b) => a + b[0], 0);
      const sumY = pairs.reduce((a, b) => a + b[1], 0);
      const mX = sumX / n, mY = sumY / n;
      let sXY = 0, sX2 = 0, sY2 = 0;
      for (const [x, y] of pairs) {
        sXY += (x - mX) * (y - mY);
        sX2 += (x - mX) ** 2;
        sY2 += (y - mY) ** 2;
      }
      const denom = Math.sqrt(sX2 * sY2);
      const ic = denom > 0 ? sXY / denom : 0;
      const t = n > 2 ? ic * Math.sqrt(n - 2) / Math.sqrt(Math.max(1 - ic * ic, 1e-9)) : 0;
      const std = n > 1 ? Math.sqrt(sY2 / (n - 1)) : 0;
      result[regime][alpha] = { ic, t, n, mean: mY, std };
    }
  }
  return result;
}

/**
 * Kelly fraction (단순화: f* = (p - q) / b)
 * — binary outcome, 확률 p, 손익비 b
 * — long-only: p > 0.5 일 때만 진입
 * @param {Object} stats - {winRate, avgWin, avgLoss, sharpe}
 * @param {Object} [options] - {fraction: 0.5, maxFraction: 0.25}
 * @returns {number} 0~1 사이의 fraction
 */
function kellyFraction(stats, options = {}) {
  const { fraction = 0.5, maxFraction = 0.25 } = options;  // half-Kelly + 25% cap
  if (!stats || !Number.isFinite(stats.sharpe)) return 0;
  // Sharpe-based Kelly: f* ≈ Sharpe / σ (volatility)
  // 단순화: f* = sharpe * 0.1 (Sharpe 1.0 → 10% 포지션)
  // Half-Kelly 적용 (보수적)
  const raw = Math.max(0, stats.sharpe * 0.1) * fraction;
  return Math.min(raw, maxFraction);
}

/**
 * 변동성 기반 포지션 사이징 (vol targeting)
 * — 목표 연환산 변동성 (예: 15%)에 맞춰 각 종목 비중 조정
 * @param {Object} panel
 * @param {string[]} topCodes - 선정된 종목 코드
 * @param {Object} [options] - {targetVol: 0.15, maxWeight: 0.10, minWeight: 0.02}
 * @returns {Object} {code: weight} (합 = 1)
 */
function volTargetWeights(panel, topCodes, options = {}) {
  const { targetVol = 0.15, maxWeight = 0.10, minWeight = 0.02 } = options;
  if (topCodes.length === 0) return {};
  // 1) 각 종목의 20일 변동성 (annualized)
  const vols = {};
  for (const code of topCodes) {
    const arr = panel.byCode.get(code);
    if (!arr || arr.length < 21) {
      vols[code] = 0.3;  // 기본값
      continue;
    }
    const recent = arr.slice(-21);  // 최근 20일
    const rets = [];
    for (let i = 1; i < recent.length; i++) {
      const r = (recent[i].close - recent[i - 1].close) / recent[i - 1].close;
      if (Number.isFinite(r)) rets.push(r);
    }
    if (rets.length < 5) {
      vols[code] = 0.3;
      continue;
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    let varSum = 0;
    for (const r of rets) varSum += (r - mean) * (r - mean);
    const dailyVol = Math.sqrt(varSum / (rets.length - 1));
    const annualVol = dailyVol * Math.sqrt(252);
    vols[code] = Number.isFinite(annualVol) && annualVol > 0.01 ? annualVol : 0.3;
  }
  // 2) inverse-vol 가중치
  const invVol = {};
  let sumInv = 0;
  for (const code of topCodes) {
    invVol[code] = 1 / vols[code];
    sumInv += invVol[code];
  }
  // 3) 정규화 + max/min 제한
  const w = {};
  for (const code of topCodes) {
    w[code] = invVol[code] / sumInv;
  }
  // max cap
  for (const code of topCodes) {
    if (w[code] > maxWeight) w[code] = maxWeight;
  }
  // 재합 = 1로 정규화
  let s = 0;
  for (const code of topCodes) s += w[code];
  for (const code of topCodes) w[code] /= s;
  // min floor (너무 작아지지 않게)
  for (const code of topCodes) {
    if (w[code] < minWeight && w[code] > 0) w[code] = minWeight;
  }
  // 재합 = 1
  s = 0;
  for (const code of topCodes) s += w[code];
  for (const code of topCodes) w[code] /= s;
  return w;
}

function fwdOf(panel, code, date) {
  const arr = panel.byCode.get(code);
  if (!arr) return null;
  // 날짜 정렬돼 있으므로 이진탐색
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = arr[mid].dateStr.localeCompare(date);
    if (c === 0) return arr[mid].fwd;
    if (c < 0) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

/**
 * [3] 일자별 종목 점수화 (signed 가중치 지원)
 * — 가중치 부호로 long/short 의미 전달 (양수=long, 음수=short)
 * — scoreDate 시그니처: (ranks, weights, minCoverage)
 */
function scoreDate(ranks, weights, minCoverage) {
  const scored = [];
  for (const [code, ar] of ranks) {
    let s = 0, wUsed = 0;
    for (let i = 0; i < ALPHA_KEYS.length; i++) {
      const v = ar[ALPHA_KEYS[i]];
      if (v === null) continue;           // [4] 결측 알파는 건너뛰고
      s += weights[i] * v;
      wUsed += Math.abs(weights[i]);
    }
    if (wUsed < minCoverage) continue;    // 가중치 확보율 미달 종목 제외
    scored.push({ code, score: wUsed > 0 ? s / wUsed : 0 });
  }
  scored.sort((a, b) => (b.score - a.score) || a.code.localeCompare(b.code));
  return scored;
}

/**
 * 전략 수익률 시계열
 * @param {number} [o.cost] 비용 오버라이드. 0을 주면 gross(비용 전) 수익률.
 *   gross와 net을 같이 보면 "신호가 없는 것"과 "신호는 있는데 비용이 먹는 것"을 구분할 수 있다.
 */
function strategyReturns(panel, ranksByDate, weights, dates, o = {}) {
  const { opts } = panel;
  const cost = o.cost === undefined ? opts.cost : o.cost;
  const rets = [];
  for (const date of dates) {
    const ranks = ranksByDate.get(date);
    if (!ranks || ranks.size === 0) continue;
    const scored = scoreDate(ranks, weights, opts.minWeightCoverage);
    const picks = [];
    for (const s of scored) {
      const f = fwdOf(panel, s.code, date);
      if (f === null || !Number.isFinite(f)) continue;
      picks.push(f);
      if (picks.length === opts.topN) break;
    }
    if (picks.length === opts.topN) {
      rets.push(picks.reduce((a, b) => a + b, 0) / opts.topN - cost);
    }
  }
  return rets;
}

/**
 * [신규] Turnover 기반 비용 모델을 적용한 전략 수익률
 *
 * strategyReturns는 매 리밸런싱마다 고정 `cost`를 차감한다.
 * 현실에서는 turnover가 변할 수 있고, 회전율에 비례한 비용/슬리피지/시장충격이 발생한다.
 *
 * @param {object} costModel - DEFAULTS.costModel (enabled, baseCost, slippage, marketImpactCoef, spreadHalf)
 * @param {boolean} [o.applyCost=true] false면 gross(비용 0)
 * @param {number} [o.minAdvFrac=0.001] 거래량 1bp당 ADV 대비 비중 임계 (시장충격 cap)
 * @returns {{ rets: number[], turnovers: number[], meanTurnover: number, meanCost: number }}
 */
function strategyReturnsWithCost(panel, ranksByDate, weights, dates, costModel, o = {}) {
  const { opts } = panel;
  const applyCost = o.applyCost !== false;
  const minAdvFrac = o.minAdvFrac != null ? o.minAdvFrac : 0.001;
  const rets = [];
  const turnovers = [];
  const costs = [];

  let prevTopSet = null;
  for (const date of dates) {
    const ranks = ranksByDate.get(date);
    if (!ranks || ranks.size === 0) continue;
    const scored = scoreDate(ranks, weights, opts.minWeightCoverage);
    const curSet = new Set();
    const picks = [];
    for (const s of scored) {
      const f = fwdOf(panel, s.code, date);
      if (f === null || !Number.isFinite(f)) continue;
      curSet.add(s.code);
      picks.push(f);
      if (picks.length === opts.topN) break;
    }
    if (picks.length < opts.topN) continue;

    // turnover 계산
    let turnover = 0;
    if (prevTopSet) {
      let changed = 0;
      for (const c of curSet) if (!prevTopSet.has(c)) changed++;
      for (const c of prevTopSet) if (!curSet.has(c)) changed++;
      turnover = changed / (2 * opts.topN);  // 0~1
    }
    turnovers.push(turnover);

    // gross return
    const gross = picks.reduce((a, b) => a + b, 0) / opts.topN;

    // costModel 적용
    let cost = 0;
    if (applyCost && costModel && costModel.enabled) {
      cost = costModel.baseCost;
      if (turnover > 0) {
        // turnover 비율만큼 슬리피지 + spread 추가
        cost += turnover * (costModel.slippage + costModel.spreadHalf);
        // 시장충격: 각 종목 거래량 대비 비중에 비례
        // 1종목 평균 ADV (최근 20일 평균 거래량) / 포트 비중
        let advSum = 0, n = 0;
        for (const code of curSet) {
          const arr = panel.byCode.get(code);
          if (!arr || arr.length < 21) continue;
          // 현재 date의 인덱스 (이진탐색)
          const idx = fwdIdxOf(panel, code, date);
          if (idx < 20) continue;
          let vSum = 0;
          for (let k = idx - 20; k < idx; k++) vSum += (arr[k] && arr[k].volume) || 0;
          const adv = vSum / 20;
          if (adv > 0) {
            // 1종목 1/topN 비중, ADV 대비 거래 비율
            const frac = (1 / opts.topN) / adv;
            advSum += Math.min(frac, 0.1) * costModel.marketImpactCoef;  // 10% cap
            n++;
          }
        }
        if (n > 0) cost += (advSum / n) * turnover;  // 평균 시장충격 × turnover
      }
    } else if (applyCost) {
      cost = opts.cost;  // 기본 fallback
    }
    costs.push(cost);
    rets.push(gross - cost);
    prevTopSet = curSet;
  }

  const meanTurnover = turnovers.length > 0 ? turnovers.reduce((a, b) => a + b, 0) / turnovers.length : 0;
  const meanCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
  return { rets, turnovers, costs, meanTurnover, meanCost };
}

/**
 * fwdOf의 인덱스 버전 (turnover 계산에 사용)
 */
function fwdIdxOf(panel, code, date) {
  const arr = panel.byCode.get(code);
  if (!arr) return -1;
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = arr[mid].date;
    if (d === date) return mid;
    if (d < date) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * [7] 유니버스 동일가중 벤치마크 — 전략과 동일한 체결 기준
 *
 * 비용은 기본적으로 부과하지 않는다. 전 종목을 동일가중으로 계속 보유하는
 * 포트폴리오는 회전율이 사실상 0이라 20일마다 0.6%를 물릴 근거가 없고,
 * 물리면 전략의 비용 부담이 상쇄돼 초과수익이 부풀려진다.
 * 즉 "무비용 벤치마크"가 전략이 넘어야 할 정직한 허들이다.
 */
function benchmarkReturns(panel, ranksByDate, dates, { applyCost = false } = {}) {
  const { opts } = panel;
  const rets = [];
  for (const date of dates) {
    const ranks = ranksByDate.get(date);
    if (!ranks || ranks.size === 0) continue;
    const vals = [];
    for (const code of ranks.keys()) {
      const f = fwdOf(panel, code, date);
      if (f !== null && Number.isFinite(f)) vals.push(f);
    }
    if (!vals.length) continue;
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    rets.push(applyCost ? m - opts.cost : m);
  }
  return rets;
}

// ─────────────────────────────────────────────────────────────
// 4) 통계
// ─────────────────────────────────────────────────────────────
function stats(rets, rebalDays = 20) {
  if (!rets || rets.length < 2) return null;
  const n = rets.length;
  const periodsPerYear = 252 / rebalDays;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const varS = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1); // 표본분산
  const std = Math.sqrt(varS);
  const sharpePeriod = std > 0 ? mean / std : 0;
  const sharpe = sharpePeriod * Math.sqrt(periodsPerYear);
  const seSharpe = Math.sqrt((1 + 0.5 * sharpePeriod ** 2) / n) * Math.sqrt(periodsPerYear);
  const t = std > 0 ? mean / (std / Math.sqrt(n)) : 0;

  let cum = 1, peak = 1, mdd = 0;
  for (const r of rets) { cum *= 1 + r; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum / peak - 1); }
  const years = n / periodsPerYear;
  const cagr = cum > 0 ? Math.pow(cum, 1 / years) - 1 : -1;

  // 왜도/첨도 (Deflated Sharpe용)
  const m3 = rets.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
  const m4 = rets.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
  const sd0 = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const skew = sd0 > 0 ? m3 / sd0 ** 3 : 0;
  const kurt = sd0 > 0 ? m4 / sd0 ** 4 : 3;

  return {
    n, mean, std, sharpe, sharpePeriod, seSharpe, t,
    winRate: rets.filter((r) => r > 0).length / n,
    totalRet: cum - 1, cagr, mdd, skew, kurt, years,
  };
}

/**
 * Deflated Sharpe Ratio (Bailey & Lopez de Prado 2014)
 * nTrials번 탐색해서 고른 최고 Sharpe가 "운"일 확률을 보정
 */
function deflatedSharpe(best, trialSharpesPeriod, nTrials) {
  if (!best || !trialSharpesPeriod.length) return null;
  const m = trialSharpesPeriod.reduce((a, b) => a + b, 0) / trialSharpesPeriod.length;
  const v = trialSharpesPeriod.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, trialSharpesPeriod.length - 1);
  const sdTrials = Math.sqrt(v);
  const EULER = 0.5772156649;
  // 귀무가설 하에서 nTrials번 뽑았을 때 기대되는 최대 Sharpe
  const sr0 = sdTrials * (
    (1 - EULER) * normInv(1 - 1 / nTrials) +
    EULER * normInv(1 - 1 / (nTrials * Math.E))
  );
  const { sharpePeriod: sr, n, skew, kurt } = best;
  const denom = Math.sqrt(Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr));
  const z = ((sr - sr0) * Math.sqrt(n - 1)) / denom;
  return { sr0Period: sr0, sr0Annual: sr0 * Math.sqrt(252 / 20), dsr: normCdf(z), z };
}

/** 교차검증용: 두 수익률 시계열의 차이(초과수익) 통계 */
function excess(stratRets, benchRets, rebalDays = 20) {
  const n = Math.min(stratRets.length, benchRets.length);
  if (n < 2) return null;
  const d = [];
  for (let i = 0; i < n; i++) d.push(stratRets[i] - benchRets[i]);
  const s = stats(d, rebalDays);
  return { ...s, annualDiff: s.mean * (252 / rebalDays) };
}

// ─────────────────────────────────────────────────────────────
// 4-0) DuckDB SQL-only IC 계산 (30 알파 × 1.6M 행 → DuckDB)
// — ic_alpha_values 테이블을 남겨서 computeCrossCorrSql이 재사용 가능
// ─────────────────────────────────────────────────────────────
async function computeICsSql(db, options = {}) {
  const { startDate = DEFAULTS.startDate, minHistory = DEFAULTS.minHistory, keepTables = false } = options;
  const sql = buildSql({ startDate, minHistory });
  // 1단계: alpha values
  await db.run('DROP TABLE IF EXISTS ic_alpha_values');
  await db.run(`CREATE TABLE ic_alpha_values AS ${sql}`);
  // 2단계: per-day rank + ret_1d
  const rankSelects = ALPHA_KEYS.map((k) => `PERCENT_RANK() OVER (PARTITION BY date ORDER BY ${k}) AS r_${k}`).join(', ');
  await db.run('DROP TABLE IF EXISTS ic_ranks');
  await db.run(`CREATE TABLE ic_ranks AS
    SELECT code, date, open, close,
      LEAD(open) OVER (PARTITION BY code ORDER BY date) AS next_open,
      ${rankSelects}
    FROM ic_alpha_values`);
  // 3단계: ret_1d
  await db.run('DROP TABLE IF EXISTS ic_ret');
  await db.run(`CREATE TABLE ic_ret AS
    SELECT *, CASE WHEN close > 0 AND next_open > 0
                   THEN (next_open - close) / close ELSE NULL END AS ret_1d
    FROM ic_ranks`);
  // 4단계: per-alpha IC
  const icSelects = ALPHA_KEYS.map((k) => `CORR(r_${k}, ret_1d) AS ic_${k}`).join(', ');
  const row = await db.one(`SELECT ${icSelects}, COUNT(r_${ALPHA_KEYS[0]}) AS n FROM ic_ret WHERE ret_1d IS NOT NULL`);
  const icResults = {};
  const N = Number(row.n);
  for (const k of ALPHA_KEYS) {
    const ic = Number(row[`ic_${k}`]);
    const t = ic * Math.sqrt(N - 2) / Math.sqrt(Math.max(1e-9, 1 - ic * ic));
    icResults[k] = { mean: ic, t, n: N };
  }
  if (!keepTables) {
    await db.run('DROP TABLE IF EXISTS ic_alpha_values');
    await db.run('DROP TABLE IF EXISTS ic_ranks');
    await db.run('DROP TABLE IF EXISTS ic_ret');
  }
  return { icResults, n: N, alphaCount: ALPHA_KEYS.length };
}

// ─────────────────────────────────────────────────────────────
// 4-a) DuckDB SQL-only cross-correlation
// — computeICsSql(keepTables=true) 호출 후 재사용 또는 자체 생성
// ─────────────────────────────────────────────────────────────
async function computeCrossCorrSql(db, panel, ranksByDate, sigAlphas, options = {}) {
  const { batch = 50 } = options;
  // ic_alpha_values 테이블 확인
  const existsRow = await db.one(`SELECT COUNT(*) AS n FROM duckdb_tables() WHERE table_name = 'ic_alpha_values'`);
  const tableExists = Number(existsRow.n) > 0;
  if (!tableExists) {
    // 직접 buildSql 실행 (느림)
    await db.run('DROP TABLE IF EXISTS ic_alpha_values');
    await db.run(`CREATE TABLE ic_alpha_values AS ${buildSql({ startDate: DEFAULTS.startDate, minHistory: DEFAULTS.minHistory })}`);
  }
  // per-day rank (sigAlphas만, wide format)
  const rankSelects = sigAlphas.map((k) => `PERCENT_RANK() OVER (PARTITION BY date ORDER BY ${k}) AS r_${k}`).join(', ');
  await db.run('DROP TABLE IF EXISTS ranks_db');
  await db.run(`CREATE TABLE ranks_db AS
    SELECT code, date, ${rankSelects} FROM ic_alpha_values`);
  // 페어별 CORR (batches)
  const pairs = [];
  for (let i = 0; i < sigAlphas.length; i++) {
    for (let j = i + 1; j < sigAlphas.length; j++) {
      pairs.push({ a: sigAlphas[i], b: sigAlphas[j], colName: `c_${i}_${j}` });
    }
  }
  const corr = {};
  for (let bi = 0; bi < pairs.length; bi += batch) {
    const b = pairs.slice(bi, bi + batch);
    const sel = b.map((p) => `CORR(r_${p.a}, r_${p.b}) AS ${p.colName}`).join(', ');
    const sql = `SELECT ${sel} FROM ranks_db`;
    const row = await db.one(sql);
    for (const p of b) {
      const v = Number(row[p.colName]);
      if (Number.isFinite(v)) corr[`${p.a} ↔ ${p.b}`] = v;
    }
  }
  // cleanup
  await db.run('DROP TABLE IF EXISTS ranks_db');
  if (!tableExists) {
    // 우리가 만든 경우만 정리
    await db.run('DROP TABLE IF EXISTS ic_alpha_values');
  }
  return corr;
}

// ─────────────────────────────────────────────────────────────
// 4-b) 알파 부호 정렬
// ─────────────────────────────────────────────────────────────
function alphaICs(panel, ranksByDate, dates) {
  const out = {};
  for (const k of ALPHA_KEYS) out[k] = [];
  for (const date of dates) {
    const m = ranksByDate.get(date);
    if (!m || m.size < 10) continue;
    const codes = [...m.keys()];
    const fwd = codes.map((c) => fwdOf(panel, c, date));
    for (const k of ALPHA_KEYS) {
      const xs = [], ys = [];
      for (let i = 0; i < codes.length; i++) {
        const v = m.get(codes[i])[k];
        if (v === null || fwd[i] === null || !Number.isFinite(fwd[i])) continue;
        xs.push(v); ys.push(fwd[i]);
      }
      if (xs.length < 10) continue;
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let cov = 0, sxx = 0, syy = 0;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        cov += dx * dy; sxx += dx * dx; syy += dy * dy;
      }
      const den = Math.sqrt(sxx * syy);
      if (den > 0) out[k].push(cov / den);
    }
  }
  const res = {};
  for (const k of ALPHA_KEYS) {
    const s = out[k];
    if (s.length < 3) { res[k] = { meanIC: 0, t: 0, n: s.length, sign: 1 }; continue; }
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (s.length - 1));
    const t = sd > 0 ? m / (sd / Math.sqrt(s.length)) : 0;
    res[k] = { meanIC: m, t, n: s.length, sign: m < 0 ? -1 : 1 };
  }
  return res;
}

/** 부호를 적용한 랭킹 사본 (rank -> 1-rank 으로 뒤집기) */
function applySigns(ranksByDate, signs) {
  const out = new Map();
  for (const [date, m] of ranksByDate) {
    const nm = new Map();
    for (const [code, o] of m) {
      const no = {};
      for (const k of ALPHA_KEYS) no[k] = o[k] === null ? null : (signs[k] === -1 ? 1 - o[k] : o[k]);
      nm.set(code, no);
    }
    out.set(date, nm);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 5) 가중치 탐색 ([8] 진짜 Dirichlet)
// ─────────────────────────────────────────────────────────────
function searchWeights(panel, ranksByDate, dates, { nTrials = 1000, seed = 20260823, alpha = 1.0 } = {}) {
  const rng = mulberry32(seed);
  const dirichlet = makeDirichlet(rng);
  const trials = [];
  for (let i = 0; i < nTrials; i++) {
    const w = dirichlet(ALPHA_KEYS.length, alpha);
    const st = stats(strategyReturns(panel, ranksByDate, w, dates), panel.opts.rebalDays);
    if (st) trials.push({ w, ...st });
  }
  trials.sort((a, b) => b.sharpe - a.sharpe);
  return trials;
}

// ─────────────────────────────────────────────────────────────
// 6) 리포트 헬퍼
// ─────────────────────────────────────────────────────────────
function fmtStats(s) {
  if (!s) return 'n/a';
  return `n=${String(s.n).padStart(2)} 평균${(s.mean * 100).toFixed(2).padStart(6)}% ` +
         `CAGR${(s.cagr * 100).toFixed(1).padStart(6)}% Sharpe${s.sharpe.toFixed(2).padStart(6)}` +
         `±${s.seSharpe.toFixed(2)} t=${s.t.toFixed(2).padStart(5)} MDD${(s.mdd * 100).toFixed(1).padStart(6)}%`;
}

function fmtWeights(w) {
  return ALPHA_KEYS.map((k, i) => `    ${k.padEnd(9)}: ${(w[i] * 100).toFixed(1).padStart(5)}%`).join('\n');
}

function describeConfig(panel) {
  const o = panel.opts;
  return [
    `유니버스 시작 ${o.startDate}, 최소 이력 ${o.minHistory}일`,
    `Top ${o.topN}, ${o.rebalDays}일 리밸런싱, ${o.holdDays}일 보유`,
    `체결 ${o.execution === 'next_open' ? 't+1 시가 진입 / t+21 시가 청산' : 't 종가 진입 / t+20 종가 청산'}`,
    `비용 ${(o.cost * 100).toFixed(2)}% round trip, 유동성 하한 ${(o.minTurnover / 1e8).toFixed(1)}억`,
  ].join('\n  ');
}

module.exports = {
  ALPHA_KEYS, ALPHA_DESC, ALPHA_CATEGORY, DEFAULTS,
  loadPanel, buildRanks, buildSql,
  computeICsSql, computeCrossCorrSql,
  strategyReturns, strategyReturnsWithCost, strategyReturnsRegime, benchmarkReturns, scoreDate, fwdOf, fwdIdxOf,
  stats, excess, deflatedSharpe, searchWeights, equalWeights,
  icWeights, corrAdjustedWeights, categoryBestWeights, regimeConditionedWeights, lookupRegime,
  multipleTestingCorrection, significantAlphas, computeRegimeICs,
  kellyFraction, volTargetWeights,
  alphaICs, applySigns,
  averageRank, mulberry32, makeDirichlet, normCdf, normInv,
  fmtStats, fmtWeights, describeConfig,
};
