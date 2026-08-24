=== 6개월 Live Paper Trading 시뮬레이션 ===

[1/4] 패널 로드...
  기간: 2021-08-23 ~ 2026-08-21 (1222일, 299.3s)

  Train: 2021-08-23 ~ 2026-02-12 (1096일)
  Live Paper: 2026-02-13 ~ 2026-08-21 (126일)

[2/4] IC 계산 (DuckDB SQL, train 데이터만)...
  Train IC 완료 (507.1s, N=1,653,654)

[3/4] 다중 가설 보정...
  Bonferroni (α=0.05): 23개 → a_mom5, a_mom5_neg, a_mom_clipped, a_053, a_055, a_rev5, a_no_new_high, a_006, a_010, a_vol_rank, a_006_pos, a_dolv_rank, a_017, a_034, a_vol20, a_range_pct, a_path5, a_022, a_up_ratio_20, a_041, a_liq_lev, a_liq_rank, a_liq_score
  BH-FDR (α=0.05): 23개 → a_mom5, a_mom5_neg, a_mom_clipped, a_053, a_055, a_rev5, a_no_new_high, a_006, a_010, a_vol_rank, a_006_pos, a_dolv_rank, a_017, a_034, a_vol20, a_range_pct, a_path5, a_022, a_up_ratio_20, a_041, a_liq_lev, a_liq_rank, a_liq_score

[4/4] Live paper trading 시뮬레이션 (6개월, train OOS)...
  카테고리 best picks: a_006_pos, a_mom5_neg, a_no_new_high, a_017, a_liq_lev, a_up_ratio_20

  [균등 30 + Top 3]
    6개월 누적: NaN%
    평균/리밸: 0.13%
    CAGR 환산: 1.6%
    Sharpe: 0.02 (t=0.05)
    MDD: -100.0%
    리밸 횟수: 105

  [카테고리 best + Top 3]
    6개월 누적: NaN%
    평균/리밸: -6.20%
    CAGR 환산: -55.4%
    Sharpe: -0.85 (t=-2.44)
    MDD: -100.0%
    리밸 횟수: 105

  [카테고리 best + Top 10]
    6개월 누적: NaN%
    평균/리밸: -3.70%
    CAGR 환산: -37.8%
    Sharpe: -0.55 (t=-1.59)
    MDD: -100.0%
    리밸 횟수: 105

  [BH 유의미 + Top 5]
    6개월 누적: NaN%
    평균/리밸: -3.95%
    CAGR 환산: -39.8%
    Sharpe: -0.65 (t=-1.87)
    MDD: -100.0%
    리밸 횟수: 105

  === 비교: 5-fold CV (in-sample) ===
  rebalDates: 62개
    Top 3: avg Sharpe -0.164, avg ret 1.34%/리밸, MDD -36.5%
    Top 10: avg Sharpe -0.580, avg ret -0.94%/리밸, MDD -35.4%
    Top 20: avg Sharpe -0.583, avg ret -0.79%/리밸, MDD -28.9%

총 소요: 3276.7s
=== 완료 ===
