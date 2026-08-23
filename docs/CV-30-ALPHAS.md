=== 30 알파 5-fold walk-forward CV (4 가중치 방식 비교) ===

[1/4] 패널 로드 (30 알파)...
  유니버스: 1355개, 일수: 1222일 (782.5s)

[2/4] 일자별 rank + IC (forward 1d)...
  랭킹 일자: 1222
  Top 10 IC:
    a_041           — t = -492.70, IC×1000 = -469.741
    a_017           — t = 383.62, IC×1000 = 382.751
    a_mom5_neg      — t = -235.01, IC×1000 = -246.005
    a_mom5          — t = 235.01, IC×1000 = 246.005
    a_rev5          — t = 235.01, IC×1000 = 246.005
    a_055           — t = 221.31, IC×1000 = 232.457
    a_010           — t = 190.07, IC×1000 = 201.075
    a_rev10         — t = 168.68, IC×1000 = 179.217
    a_022           — t = 167.86, IC×1000 = 178.375
    a_mom20         — t = 120.90, IC×1000 = 129.466

[3/4] Cross-correlation (DuckDB SQL-only)...
  유의미 알파 (t≥2): 27개
  ranks_db: 2,367,308행
  3 페어 계산 (91.1s)
  상위 5개 cross-correlation:
    a_mom20 ↔ a_mom60                        0.488  ✅ 분산
    a_mom5 ↔ a_mom20                         0.431  ✅ 분산
    a_mom5 ↔ a_mom60                         0.224  ✅ 분산

[4/4] 5-fold walk-forward CV (4 가중치 방식)...
  리밸런싱 일자: 62개

  === 가중치 구성 ===
    균등 30 알파: a_mom5(3.3%), a_mom20(3.3%), a_mom60(3.3%), a_mom5_neg(3.3%), a_mom_clipped(3.3%)
    IC 가중치 (shr=0.3): a_041(-14.4%), a_017(11.2%), a_mom5_neg(-7.0%), a_mom5(7.0%), a_rev5(7.0%)
    Corr 보정 (shr=0.3): a_041(-14.4%), a_017(11.2%), a_mom5_neg(-7.0%), a_rev5(7.0%), a_mom5(6.8%)
    카테고리 best 1개씩: a_mom5_neg(-100.0%), a_rev5(100.0%), a_010(100.0%), a_017(100.0%), a_022(100.0%)

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
    Fold 1: n=12, mean=-8.97%, Sharpe=-2.96, t=-2.89, MDD=-72.2%
    Fold 2: n=12, mean=-2.14%, Sharpe=-0.55, t=-0.54, MDD=-54.0%
    Fold 3: n=12, mean=0.50%, Sharpe=0.07, t=0.07, MDD=-45.5%
    Fold 4: n=12, mean=-4.45%, Sharpe=-1.80, t=-1.75, MDD=-53.1%
    Fold 5: n=13, mean=11.82%, Sharpe=1.04, t=1.06, MDD=-56.0%
    평균: Sharpe -0.838, 수익률 -0.65%/리밸
    최고: Fold 5 (Sharpe 1.04) | 최저: Fold 1 (Sharpe -2.96)

  [Corr 보정 (shr=0.3)]
    Fold 1: n=12, mean=-9.23%, Sharpe=-2.97, t=-2.90, MDD=-73.3%
    Fold 2: n=12, mean=-0.87%, Sharpe=-0.21, t=-0.21, MDD=-53.8%
    Fold 3: n=12, mean=0.50%, Sharpe=0.07, t=0.07, MDD=-45.5%
    Fold 4: n=12, mean=-4.45%, Sharpe=-1.80, t=-1.75, MDD=-53.1%
    Fold 5: n=13, mean=13.34%, Sharpe=1.18, t=1.20, MDD=-56.0%
    평균: Sharpe -0.747, 수익률 -0.14%/리밸
    최고: Fold 5 (Sharpe 1.18) | 최저: Fold 1 (Sharpe -2.97)

  [카테고리 best 1개씩]
    Fold 1: n=12, mean=-11.10%, Sharpe=-3.66, t=-3.57, MDD=-77.6%
    Fold 2: n=12, mean=-4.21%, Sharpe=-1.70, t=-1.66, MDD=-43.0%
    Fold 3: n=12, mean=3.99%, Sharpe=0.61, t=0.60, MDD=-23.7%
    Fold 4: n=12, mean=-3.94%, Sharpe=-1.54, t=-1.50, MDD=-43.4%
    Fold 5: n=13, mean=-0.50%, Sharpe=-0.08, t=-0.09, MDD=-56.6%
    평균: Sharpe -1.275, 수익률 -3.15%/리밸
    최고: Fold 3 (Sharpe 0.61) | 최저: Fold 1 (Sharpe -3.66)

총 소요: 2550.0s
=== 완료 ===
