=== 30 알파 개선된 CV (Bonferroni + Top N + Kelly + vol) ===

[1/5] 패널 로드 (30 알파, 5년치)...
  유니버스: 1355개, 일수: 1222일 (380.0s)

[2/5] IC 계산 (DuckDB SQL)...
  IC 완료 (221.2s, N=1,653,654)

[3/5] 다중 가설 보정 (Bonferroni + BH-FDR)...
  유의미 알파: raw 23개, Bonferroni 23개, BH-FDR 23개
  Bonferroni: a_mom5, a_mom5_neg, a_mom_clipped, a_053, a_055, a_rev5, a_no_new_high, a_006, a_010, a_vol_rank, a_006_pos, a_dolv_rank, a_017, a_034, a_vol20, a_range_pct, a_path5, a_022, a_up_ratio_20, a_041, a_liq_lev, a_liq_rank, a_liq_score
  BH-FDR: a_mom5, a_mom5_neg, a_mom_clipped, a_053, a_055, a_rev5, a_no_new_high, a_006, a_010, a_vol_rank, a_006_pos, a_dolv_rank, a_017, a_034, a_vol20, a_range_pct, a_path5, a_022, a_up_ratio_20, a_041, a_liq_lev, a_liq_rank, a_liq_score

[4/5] Cross-correlation (DuckDB SQL)...
  253 페어 계산 (80.6s)

[5/5] 5-fold CV (Top N × 가중치 × 리밸런싱)...
  ranksByDate 구축 완료 (444.6s)

  18 조합 평가 완료 (450.5s)

  === Top 10 조합 (avg Sharpe 내림차순) ===
  가중치                | Top N | Rebal | Avg Sharpe | Avg Ret | Avg MDD | Best Fold | Worst Fold
  -----------------------------------------------------------------------------------------------
  카테고리 best            |     3 |    40 |      0.066 |    2.66% |   -25.9% |  4(0.90) |  1(-0.64)
  Corr 보정 (BH)         |    20 |    40 |     -0.107 |    0.14% |   -15.0% |  5(0.52) |  2(-0.84)
  카테고리 best            |     3 |    20 |     -0.164 |    1.34% |   -36.5% |  5(0.67) |  1(-1.45)
  카테고리 best            |    20 |    40 |     -0.236 |   -0.37% |   -17.1% |  4(0.48) |  1(-1.45)
  균등 30                |     3 |    40 |     -0.292 |   -0.85% |   -30.2% |  5(0.72) |  3(-1.76)
  Corr 보정 (BH)         |    20 |    20 |     -0.305 |    0.04% |   -25.8% |  5(0.71) |  1(-0.73)
  카테고리 best            |    10 |    40 |     -0.352 |   -0.29% |   -23.8% |  5(0.44) |  1(-1.67)
  균등 30                |    20 |    40 |     -0.367 |   -0.40% |   -16.2% |  5(1.16) |  1(-3.48)
  Corr 보정 (BH)         |     3 |    40 |     -0.471 |    1.61% |   -20.6% |  5(0.74) |  1(-2.05)
  Corr 보정 (BH)         |    10 |    40 |     -0.537 |    0.19% |   -16.3% |  5(0.86) |  1(-2.21)

  === Worst 5 조합 (avg Sharpe 오름차순) ===
  Corr 보정 (BH)         |    10 |    20 |     -0.613 |    0.35% |   -27.9% |  5(0.99) |  1(-1.50)
  균등 30                |    20 |    20 |     -0.792 |   -1.12% |   -34.5% |  5(0.96) |  1(-3.32)
  Corr 보정 (BH)         |     3 |    20 |     -0.991 |   -0.67% |   -39.7% |  5(0.71) |  1(-2.73)
  균등 30                |    10 |    40 |     -1.096 |   -2.05% |   -25.6% |  2(0.76) |  1(-4.69)
  균등 30                |    10 |    20 |     -1.368 |   -2.37% |   -43.8% |  5(0.49) |  1(-4.39)

  === Top N 효과 (모든 가중치 평균) ===
  Top  3: Sharpe -0.406, Ret 0.40%, MDD -33.8%
  Top 10: Sharpe -0.758, Ret -0.85%, MDD -28.8%
  Top 20: Sharpe -0.398, Ret -0.42%, MDD -22.9%

  === Rebal 효과 (모든 가중치/TopN 평균) ===
  20일: avg Sharpe -0.664
  40일: avg Sharpe -0.377

  [6/6] Kelly + vol targeting 분석
  베이스라인 (Top10, 20일, 카테고리 best): Sharpe -0.580
  Kelly fraction (half-Kelly, 25% cap): 0.0%
  → Sharpe 0.5+: Kelly 5% | Sharpe 1.0+: Kelly 10% | Sharpe 1.5+: Kelly 15% (cap 25%)

총 소요: 1132.6s
=== 완료 ===
