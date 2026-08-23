=== 30 알파 5-fold walk-forward CV (4 가중치 방식 비교) ===

[1/4] 패널 로드 (CV용 5년치)...
  유니버스: 1355개, 일수: 1222일 (1103.2s)

[2/4] 알파별 IC (DuckDB CORR)...
  IC 계산 완료 (743.3s, N=1,653,654)
  Top 10 IC:
    a_017           — t = -17.02, IC×1000 = -13.236
    a_006_pos       — t = 14.91, IC×1000 = 11.593
    a_liq_lev       — t = 13.20, IC×1000 = 10.261
    a_liq_rank      — t = 13.20, IC×1000 = 10.261
    a_no_new_high   — t = 11.97, IC×1000 = 9.311
    a_liq_score     — t = -11.42, IC×1000 = -8.878
    a_055           — t = -11.01, IC×1000 = -8.559
    a_041           — t = -10.95, IC×1000 = -8.514
    a_up_ratio_20   — t = -9.92, IC×1000 = -7.714
    a_006           — t = 8.31, IC×1000 = 6.459

[3/4] Cross-correlation (DuckDB SQL-only)...
  유의미 알파 (t≥2): 23개
  253 페어 계산 (199.7s)
  상위 5개 cross-correlation:
    a_mom5 ↔ a_rev5                          1.000  ⚠️ 중복
    a_liq_lev ↔ a_liq_rank                   1.000  ⚠️ 중복
    a_mom5 ↔ a_mom5_neg                      -0.976  ⚠️ 중복
    a_mom5_neg ↔ a_rev5                      -0.976  ⚠️ 중복
    a_dolv_rank ↔ a_liq_lev                  -0.918  ⚠️ 중복

  ranksByDate 재구성 (CV용)...
  랭킹 일자: 1222 (828.0s)

[4/4] 5-fold walk-forward CV (4 가중치 방식)...
  리밸런싱 일자: 62개

  === 가중치 구성 ===
    균등 30 알파: a_mom5(3.3%), a_mom20(3.3%), a_mom60(3.3%), a_mom5_neg(3.3%), a_mom_clipped(3.3%)
    IC 가중치 (shr=0.3): a_017(-8.3%), a_006_pos(7.3%), a_liq_lev(6.4%), a_liq_rank(6.4%), a_no_new_high(5.8%)
    Corr 보정 (shr=0.3): a_017(-9.0%), a_006_pos(7.4%), a_no_new_high(6.1%), a_liq_lev(5.9%), a_liq_rank(5.9%)
    카테고리 best 1개씩: a_mom5_neg(-100.0%), a_no_new_high(100.0%), a_006_pos(100.0%), a_017(-100.0%), a_up_ratio_20(-100.0%)

  === 5-fold walk-forward CV ===

  [균등 30 알파]
    Fold 1: n=12, mean=-7.19%, Sharpe=-2.28, t=-2.22, MDD=-68.7%
    Fold 2: n=12, mean=-0.24%, Sharpe=-0.05, t=-0.05, MDD=-49.5%
    Fold 3: n=12, mean=-1.66%, Sharpe=-0.58, t=-0.57, MDD=-38.2%
    Fold 4: n=12, mean=-1.09%, Sharpe=-0.31, t=-0.30, MDD=-44.8%
    Fold 5: n=13, mean=1.57%, Sharpe=0.29, t=0.29, MDD=-47.2%
    평균: Sharpe -0.585, 수익률 -1.72%/리밸
    최고: Fold 5 (Sharpe 0.29) | 최저: Fold 1 (Sharpe -2.28)

  [IC 가중치 (shr=0.3)]
    Fold 1: n=12, mean=-5.34%, Sharpe=-2.89, t=-2.82, MDD=-49.6%
    Fold 2: n=12, mean=-0.98%, Sharpe=-0.35, t=-0.34, MDD=-30.3%
    Fold 3: n=12, mean=-4.17%, Sharpe=-2.05, t=-2.00, MDD=-41.9%
    Fold 4: n=12, mean=-2.42%, Sharpe=-0.74, t=-0.72, MDD=-47.1%
    Fold 5: n=13, mean=-1.49%, Sharpe=-0.23, t=-0.23, MDD=-39.8%
    평균: Sharpe -1.250, 수익률 -2.88%/리밸
    최고: Fold 5 (Sharpe -0.23) | 최저: Fold 1 (Sharpe -2.89)

  [Corr 보정 (shr=0.3)]
    Fold 1: n=12, mean=-4.92%, Sharpe=-2.73, t=-2.67, MDD=-48.5%
    Fold 2: n=12, mean=-2.03%, Sharpe=-0.81, t=-0.79, MDD=-30.3%
    Fold 3: n=12, mean=-3.67%, Sharpe=-1.71, t=-1.67, MDD=-38.3%
    Fold 4: n=12, mean=-1.31%, Sharpe=-0.42, t=-0.41, MDD=-42.1%
    Fold 5: n=13, mean=8.61%, Sharpe=0.71, t=0.73, MDD=-39.3%
    평균: Sharpe -0.991, 수익률 -0.67%/리밸
    최고: Fold 5 (Sharpe 0.71) | 최저: Fold 1 (Sharpe -2.73)

  [카테고리 best 1개씩]
    Fold 1: n=12, mean=-2.60%, Sharpe=-1.45, t=-1.41, MDD=-39.1%
    Fold 2: n=12, mean=3.33%, Sharpe=0.55, t=0.54, MDD=-23.6%
    Fold 3: n=12, mean=-3.13%, Sharpe=-0.88, t=-0.86, MDD=-39.0%
    Fold 4: n=12, mean=1.01%, Sharpe=0.29, t=0.29, MDD=-28.9%
    Fold 5: n=13, mean=8.11%, Sharpe=0.67, t=0.68, MDD=-52.1%
    평균: Sharpe -0.164, 수익률 1.34%/리밸
    최고: Fold 5 (Sharpe 0.67) | 최저: Fold 1 (Sharpe -1.45)

총 소요: 2882.2s
=== 완료 ===
