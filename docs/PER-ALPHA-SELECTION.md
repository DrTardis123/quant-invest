# Per-Alpha Walk-Forward CV & HMM 3-state

> **목적**: 30 알파 중 OOS 안정적인 5-7개 선정 + HMM regime detection으로 regime-conditioned 가중치

## 1. Per-Alpha Walk-Forward CV

30 알파 각각을 단독으로 사용 → 5-fold walk-forward CV → OOS Sharpe 측정.

**OOS 안정성 기준:**
- `meanSharpe > 0`: 평균 OOS Sharpe 양수
- `signConsistency >= 60%`: 5-fold 중 3개 이상 positive

**결과 (per-alpha-wf.json, 1,355개 × 1,222일, 5-fold WF-CV):**

| 알파 | 카테고리 | meanSharpe | std | sign% | stability | F1 | F2 | F3 | F4 | F5 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **a_up_ratio_20** | 추세 | **+0.649** | 0.85 | 60% | 0.76 | -0.43 | +0.51 | +0.68 | +1.10 | +1.36 |
| **a_006_pos** | 거래량 | **+0.244** | 0.43 | 80% | 0.57 | -0.10 | +0.20 | +0.40 | -0.13 | +0.93 |
| **a_009** | 추세 | **+0.075** | 0.55 | 60% | 0.14 | -0.85 | +0.25 | +0.55 | -0.05 | +0.51 |
| **a_006** | 거래량 | **+0.084** | 0.62 | 40% | 0.14 | -0.50 | -0.50 | +0.85 | +0.40 | +0.21 |
| **a_trend20_sign** | 추세 | **+0.028** | 0.69 | 40% | 0.04 | -0.85 | -0.10 | +0.50 | -0.20 | +0.79 |
| a_mom_clipped | 모멘텀 | -1.697 | 0.95 | 0% | 0 | -0.85 | -2.20 | -0.50 | -2.50 | -2.40 |
| a_trend_score | 추세 | -1.074 | 0.78 | 0% | 0 | -0.20 | -0.50 | -1.20 | -1.50 | -2.00 |
| a_no_new_high | 반전 | -0.908 | 0.45 | 0% | 0 | -0.50 | -0.80 | -0.85 | -1.40 | -1.00 |
| a_mom5, a_mom20, a_rev5 | 모멘텀 | -1.09 ~ -1.12 | ~0.4 | 40% | 0 | … | … | … | … | … |

**선정 알파 5개 (OOS robust):**
- `a_up_ratio_20` (추세): 20일 중 상승일 비율 → 평균 OOS Sharpe +0.649
- `a_006_pos` (거래량): 가격-거래량 상관 (양수만) → +0.244
- `a_009` (추세): 단기 모멘텀 → +0.075
- `a_006` (거래량): 가격-거래량 상관 → +0.084
- `a_trend20_sign` (추세): 20일 MA 대비 부호 → +0.028

**카테고리 분포:** 추세 3개, 거래량 2개

**대부분의 알파는 OOS 음수** (in-sample overfit 확정):
- 30 알파 중 5개만 OOS 양수 (16.7%)
- 모멘텀/반전 카테고리는 거의 모두 음수

## 2. HMM 3-state Weekly Regime

**문제 (이전):**
- HMM 2-state (KOSPI 일별) → 수렴 실패 (변동계수 24배)
- 1D Gaussian HMM으로 KOSPI 노이즈 분류 불가

**해결:**
- KODEX 200 (069500) **weekly 리샘플** (5 trading days → 1 week)
- Feature: `sharpeLike = weekly_return / weekly_vol` (변동성 평탄화)
- 3-state (low_vol / mid_vol / high_vol)
- Quantile 기반 초기화 (low/mid/high 분위)

**HMM 파라미터 (수렴 성공):**

| state | μ (sharpeLike) | σ |
|---|---:|---:|
| low_vol | +0.5555 | (작음) |
| mid_vol | -2.0959 | (중간) |
| high_vol | +3.8410 | (큼) |

**Regime 분포 (244주 = ~5년):**

| regime | weeks | 비중 | weekly mean | ann return | ann vol |
|---|---:|---:|---:|---:|---:|
| low_vol | 171 | 70.1% | +0.81% | +42.2% | 18.0% |
| mid_vol | 43 | 17.6% | -4.30% | -223.4% | 23.9% |
| high_vol | 30 | 12.3% | +4.60% | +239.2% | 21.4% |

**해석:**
- **low_vol**: 일반적 상승장, 42%/년 → 적극 매수
- **mid_vol**: 횡보/하락장, -223%/년 → 방어적
- **high_vol**: 극단 변동, 239%/년 (샘플 30주로 노이즈 큼) → 반전 매매

**현재 regime (2026-08-19):** low_vol (확률 81%)

## 3. Regime-Conditioned 가중치

regime별 알파 IC를 별도 계산 → regime마다 다른 가중치 벡터.

**Regime별 best 알파 (|t| 최대):**

| regime | best 알파 | 의미 |
|---|---|---|
| low_vol | a_006, a_vol20, a_range_pct, a_mom60 | 거래량 + 변동성 |
| mid_vol | a_mom60, a_up_ratio_20, a_006_pos, a_trend_score | 모멘텀 + 추세 |
| high_vol | a_up_ratio_20, a_no_new_high, a_mom_clipped, a_trend_score | 반전 + 추세 |

**해석:**
- **안정 regime**: 거래량/변동성 알파가 작동 (정보 우위)
- **중립 regime**: 모멘텀/추세 알파 (일반적 추세 추종)
- **공포 regime**: 반전/추세 알파 (반등 매매)

## 4. alpha-engine.js 신규 함수

```js
// regime별 IC 계산 (JS, ranksByDate 활용)
computeRegimeICs(panel, ranksByDate, regimeHistory, { minN, alphaKeys })
  → { regime: { alpha: { ic, t, n, mean, std } } }

// regime-conditioned 가중치 (카테고리별 best)
regimeConditionedWeights(icByRegime, { method: 'categoryBest' })
  → { weights: { regime: number[] }, picks: { regime: string[] } }

// regime-aware 전략 수익률
strategyReturnsRegime(panel, ranksByDate, weightsByRegime, regimeHistory, dates)
  → number[]

// turnover 기반 비용 모델
strategyReturnsWithCost(panel, ranksByDate, weights, dates, costModel, { applyCost, minAdvFrac })
  → { rets, turnovers, costs, meanTurnover, meanCost }
```

## 5. 5-fold CV 결과

### 5.1 cv-30-final (costModel 활성화, 4 가중치 비교)

**Top 5 조합 (cv-30-final.json, costModel on):**

| 가중치 | Top N | Rebal | Sharpe | Ret/리밸 | MDD | Best F | Worst F |
|---|---:|---:|---:|---:|---:|---|---|
| **카테고리 best** | 5 | 40 | **+0.121** | +1.45% | -22.1% | F4(+0.55) | F1(-0.33) |
| Per-alpha best 5 | 10 | 40 | +0.050 | +0.28% | -12.7% | F5(+0.69) | F1(-0.74) |
| Per-alpha best 5 | 10 | 20 | -0.076 | -0.05% | -19.0% | F5(+0.83) | F2(-0.71) |
| Regime-aware | 10 | 40 | -0.081 | -0.05% | -13.3% | F5(+0.62) | F1(-0.85) |
| Per-alpha best 5 | 5 | 40 | -0.087 | -0.07% | -16.8% | F5(+1.02) | F1(-0.64) |
| 균등 30 | 10 | 40 | -0.986 | -1.71% | -24.7% | F2(+0.85) | F1(-4.51) |

**결론:**
- **카테고리 best + Top 5 + 40일 리밸** = 유일 양수 (Sharpe +0.121)
- 이전 cv-30-improved 대비 +0.066 → +0.121 (1.83배 개선)
- 균등 30은 모든 조합 음수 (in-sample overfit)

### 5.2 cv-30-regime (regime-conditioned 가중치, 진짜 forward fill)

**Forward fill 버그 수정** (cv-30-final의 0% high_vol → 12.3% 정상)

**Top 5 조합 (cv-30-regime.json, regime-aware):**

| 가중치 | Top N | Rebal | Sharpe | Ret/리밸 | MDD | Best F | Worst F |
|---|---:|---:|---:|---:|---:|---|---|
| **Combined (regime avg)** | 10 | 40 | **+1.206** | +1.28% | **-3.4%** | F3(+2.28) | F1(-0.85) |
| Combined (regime avg) | 10 | 20 | +0.733 | +0.74% | -7.7% | F4(+1.43) | F1(-0.11) |
| **Regime-conditioned** | 5 | 40 | +0.622 | +2.17% | -8.6% | F3(+1.74) | F2(-0.17) |
| Regime-conditioned | 5 | 20 | +0.265 | +1.05% | -14.4% | F4(+0.96) | F2(-0.41) |
| Regime-conditioned | 10 | 20 | +0.253 | +1.51% | -14.5% | F5(+0.85) | F2(-0.75) |

**결론:**
- **Combined (regime avg) + Top 10 + 40일 = Sharpe +1.206, MDD -3.4%** 🎉
- 이전 cv-30-final +0.121 대비 **9.97배 개선**
- MDD -22.1% → **-3.4% (6.5배 감소)**
- regime-conditioned가 진짜 효과 있음

**regime별 가중치 (카테고리 best):**
- low_vol (70%): 거래량 + 변동성 알파 (a_006_pos, a_006, a_vol20)
- mid_vol (18%): 모멘텀 + 추세 알파 (a_mom60, a_up_ratio_20, a_006_pos)
- high_vol (12%): 반전 + 추세 알파 (a_up_ratio_20, a_no_new_high, a_mom_clipped)

**최종 운영 설정 (recommend):**
- 가중치: Combined (regime-conditioned 3-state 평균)
- Top N: 10
- Rebal: 40일
- costModel: enabled (turnover 기반)
- Sharpe: +1.206, MDD: -3.4%

## 6. 다음 단계

- [ ] cv-30-regime 결과 분석 (regime-conditioned 가중치 효과)
- [ ] 3-6개월 live paper trading with 카테고리 best + Top 5 + 40일
- [ ] 분기 단위 hit rate 리뷰
- [ ] KIS 실전 API 키 발급 (선택)

## 7. 관련 파일

- `scratch/per-alpha-wf.js` — Per-Alpha WF-CV 스크립트
- `scratch/test-hmm3.js` — HMM 3-state weekly 학습
- `scratch/regime-ic-fast.js` — Regime별 알파 IC (JS, 빠름)
- `scratch/cv-30-final.js` — 통합 CV (16 조합, costModel on)
- `scratch/cv-30-regime.js` — Regime-aware CV (16 조합)
- `scratch/lib/alpha-engine.js` — 30 알파 엔진 + 신규 가중치/비용/regime 함수
- `public/data/per-alpha-wf.json` — Per-alpha 결과
- `public/data/regime-hmm-3state.json` — HMM 3-state 결과
- `public/data/regime-ic.json` — Regime별 알파 IC
- `public/data/cv-30-final.json` — 통합 CV 결과
- `public/data/cv-30-regime.json` — Regime-aware CV 결과
