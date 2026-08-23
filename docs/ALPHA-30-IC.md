=== 30 알파 SQL-only (DuckDB 내부) ===

[1/4] DuckDB: 30 알파 + per-day rank (CTE) → temp table...
  ranks 테이블: 1,655,009행 (129.6s)

[2/4] 알파별 IC 분석 (DuckDB CORR)
  IC 계산 완료 (0.7s)
  카테고리 | 알파            | IC×1000 | t(단순) | N      | 유의미
  ----------------------------------------------------------------------
  모멘텀      | a_mom5          |  -2.554 |   -3.28 | 1653654 | ✅
  모멘텀      | a_mom20         |  -0.304 |   -0.39 | 1653654 | ⚠️
  모멘텀      | a_mom60         |   0.428 |    0.55 | 1653654 | ⚠️
  모멘텀      | a_mom5_neg      |  -4.160 |   -5.35 | 1653654 | ✅
  모멘텀      | a_mom_clipped   |  -2.554 |   -3.28 | 1653654 | ✅
  반전       | a_053           |  -5.978 |   -7.69 | 1653654 | ✅
  반전       | a_rev5          |   3.049 |    3.92 | 1653654 | ✅
  반전       | a_rev10         |   1.257 |    1.62 | 1653654 | ⚠️
  반전       | a_rev20         |  -0.469 |   -0.60 | 1653654 | ⚠️
  반전       | a_no_new_high   |   9.311 |   11.97 | 1653654 | ✅
  거래량      | a_006           |   6.459 |    8.31 | 1653654 | ✅
  거래량      | a_vol_rank      |   6.436 |    8.28 | 1653654 | ✅
  거래량      | a_vol_ratio     |  -1.504 |   -1.93 | 1653654 | ⚠️
  거래량      | a_006_pos       |  11.593 |   14.91 | 1653654 | ✅
  거래량      | a_dolv_rank     |   5.342 |    6.87 | 1653654 | ✅
  변동성      | a_vol20         |   3.379 |    4.35 | 1653654 | ✅
  변동성      | a_range_pct     |  -3.364 |   -4.33 | 1653654 | ✅
  변동성      | a_vol5          |  -3.118 |   -4.01 | 1653654 | ✅
  변동성      | a_path5         |  -3.334 |   -4.29 | 1653654 | ✅
  변동성      | a_hlv_vwap      |   3.953 |    5.08 | 1653654 | ✅
  추세       | a_009           |   5.425 |    6.98 | 1653654 | ✅
  추세       | a_trend20_sign  |  -0.438 |   -0.56 | 1653654 | ⚠️
  추세       | a_trend60_sign  |   0.132 |    0.17 | 1653654 | ⚠️
  추세       | a_trend_score   |  -0.879 |   -1.13 | 1653654 | ⚠️
  추세       | a_up_ratio_20   |  -7.714 |   -9.92 | 1653654 | ✅
  유동성      | a_liq_lev       |  10.261 |   13.20 | 1653654 | ✅
  유동성      | a_liq_pass      |  -3.602 |   -4.63 | 1653654 | ✅
  유동성      | a_liq_rank      |  10.261 |   13.20 | 1653654 | ✅
  유동성      | a_liq_score     |  -8.878 |  -11.42 | 1653654 | ✅
  유동성      | a_size_vol      |   0.686 |    0.88 | 1653654 | ⚠️

  유의미 알파 (t≥2): 21개

[3/4] Cross-correlation (DuckDB)
  210 페어 계산 (4.1s)

  상위 cross-correlation:
    a_liq_lev ↔ a_liq_rank                   1.000  ⚠️ 중복
    a_mom5 ↔ a_mom_clipped                   0.998  ⚠️ 중복
    a_mom5_neg ↔ a_rev5                      -0.976  ⚠️ 중복
    a_dolv_rank ↔ a_liq_lev                  -0.918  ⚠️ 중복
    a_dolv_rank ↔ a_liq_rank                 -0.918  ⚠️ 중복
    a_vol_rank ↔ a_dolv_rank                 0.849  ⚠️ 중복
    a_dolv_rank ↔ a_liq_pass                 -0.794  ⚠️ 중복
    a_vol20 ↔ a_vol5                         0.787  ⚠️ 중복
    a_vol_rank ↔ a_liq_lev                   -0.766  ⚠️ 중복
    a_vol_rank ↔ a_liq_rank                  -0.766  ⚠️ 중복
    a_liq_lev ↔ a_liq_pass                   0.751  ⚠️ 중복
    a_liq_pass ↔ a_liq_rank                  0.751  ⚠️ 중복
    a_vol20 ↔ a_range_pct                    0.708  ⚠️ 중복
    a_mom_clipped ↔ a_up_ratio_20            0.689  ⚠️ 중복
    a_mom5 ↔ a_up_ratio_20                   0.688  ⚠️ 중복
    a_range_pct ↔ a_vol5                     0.672  ⚠️ 중복
    a_vol_rank ↔ a_liq_pass                  -0.660  ⚠️ 중복
    a_006 ↔ a_006_pos                        -0.578  ⚠️ 중복
    a_dolv_rank ↔ a_liq_score                -0.546  ⚠️ 중복
    a_vol_rank ↔ a_range_pct                 -0.541  ⚠️ 중복
    a_vol20 ↔ a_path5                        0.519  ⚠️ 중복
    a_vol_rank ↔ a_liq_score                 -0.516  ⚠️ 중복
    a_vol_rank ↔ a_vol20                     -0.513  ⚠️ 중복
    a_053 ↔ a_no_new_high                    0.512  ⚠️ 중복
    a_vol5 ↔ a_path5                         0.497  🟡 보통

[4/4] 카테고리별 분산 추천 (각 1개)
    거래량      a_006_pos       — t = 14.91 (상승 신호)
    모멘텀      a_mom5_neg      — t = -5.35 (하락 신호)
    반전       a_no_new_high   — t = 11.97 (상승 신호)
    변동성      a_hlv_vwap      — t = 5.08 (상승 신호)
    유동성      a_liq_lev       — t = 13.20 (상승 신호)
    추세       a_up_ratio_20   — t = -9.92 (하락 신호)

총 소요: 134.4s
=== 완료 ===
