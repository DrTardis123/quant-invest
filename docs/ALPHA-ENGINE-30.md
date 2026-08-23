# alpha-engine.js 30 알파 + 가중치 함수

## 30 알파 (카테고리별 5개)

| 카테고리 | 알파 |
|---|---|
| **모멘텀** | a_mom5, a_mom20, a_mom60, a_mom5_neg, a_mom_clipped |
| **반전** | a_053, a_055, a_rev5, a_rev10, a_no_new_high |
| **거래량** | a_006, a_010, a_vol_rank, a_006_pos, a_dolv_rank |
| **변동성** | a_017, a_034, a_vol20, a_range_pct, a_path5 |
| **추세** | a_009, a_022, a_trend20_sign, a_trend_score, a_up_ratio_20 |
| **유동성** | a_028, a_041, a_liq_lev, a_liq_rank, a_liq_score |

**Alpha IC 결과 (1,355개 × 1,222일, SQL-only)**:

| 알파 | t(단순) | 카테고리 |
|---|---:|---|
| a_006_pos | +14.91 | 거래량 (CORR(close, volume)) |
| a_liq_lev / a_liq_rank | +13.20 | 유동성 (거래대금) |
| a_no_new_high | +11.97 | 반전 (신고가 미갱신) |
| a_up_ratio_20 | -9.92 | 추세 (음의 up_ratio) |
| a_liq_score | -11.42 | 유동성 |
| a_053 | -7.69 | 반전 (신저가 갱신) |
| a_006 | +8.31 | 거래량 |
| a_vol_rank | +8.28 | 거래량 |
| a_009 | +6.98 | 추세 |
| a_path5 | -4.29 | 변동성 |

## 가중치 계산 함수

### `equalWeights()`
30 알파 균등 가중치 (1/30 = 3.33%)

### `icWeights(icResults, { shrinkage, minT })`
- IC 절댓값에 비례하는 가중치
- **Shrinkage**: 0.3 → 30%는 균등, 70%는 IC 비례
- 부호 보존: 양의 t = 양의 가중치, 음의 t = 음의 가중치 (long-short)

### `corrAdjustedWeights(icResults, corrMap, { shrinkage })`
- **Cross-correlation 보정**:
  - 각 알파의 독립성 점수 = (N - sum|corr(i,j)|) / N
  - 가중치 = (IC × 독립성) × (1-shr) + 균등 × shr
  - corr이 높은 알파일수록 가중치 ↓
  - **Shrinkage 0.3** 권장 (균등 + IC×독립성 70:30)
- long-short 의미 보존 (signed weights)

### `categoryBestWeights(icResults)`
- **카테고리별 best 1개** 자동 선정
- 6 카테고리 → 6 알파 (분산 극대화)
- 가중치: t 부호 보존, 카테고리 간 균등

## 사용 예시

```js
const E = require('./scratch/lib/alpha-engine');

// 1) 패널 로드
const panel = await E.loadPanel(db, { ...E.DEFAULTS, minHistory: 1000 });
const ranks = E.buildRanks(panel);

// 2) IC 계산 (DuckDB SQL로)
const icResults = { a_mom5: { t: 235.01, n: 850000, mean: 0.246 }, ... };

// 3) 가중치 선택
const w1 = E.equalWeights();                     // 30 알파 균등
const w2 = E.icWeights(icResults, { shrinkage: 0.3 });  // IC 가중치
const w3 = E.corrAdjustedWeights(icResults, corr, { shrinkage: 0.3 });  // 보정
const w4 = E.categoryBestWeights(icResults).weights;  // 카테고리 best

// 4) 시뮬레이션
const dates = panel.rebalDates;
const rets = E.strategyReturns(panel, ranks, w3, dates);
const stats = E.stats(rets, 20);
console.log(E.fmtStats(stats));  // n=12 평균 1.5% CAGR 19.2% Sharpe 1.10 ...
```

## 5-fold CV 결과

`scratch/cv-30-alphas.js` 실행 결과는 `docs/CV-30-ALPHAS.md`에 자동 저장.
4 가중치 방식 비교:
- 균등 30 알파
- IC 가중치 (shr=0.3)
- **Corr 보정 (shr=0.3)** ← 추천
- 카테고리 best 1개씩 (분산 극대화)

## 이전 버전 (14 알파) → 30 알파 변경 사항

- **추가 16 알파** (6 카테고리 분산):
  - 모멘텀: a_mom60, a_mom5_neg, a_mom_clipped
  - 반전: a_rev5, a_rev10, a_no_new_high
  - 거래량: a_vol_rank, a_006_pos, a_dolv_rank
  - 변동성: a_vol20, a_range_pct, a_hlv_vwap, a_path5
  - 추세: a_trend20_sign, a_trend60_sign, a_trend_score, a_up_ratio_20
  - 유동성: a_liq_lev, a_liq_rank, a_liq_score
- **buildSql 확장**: LAG, ADV, PERCENT_RANK 컬럼 추가
- **scoreDate signed 가중치**: long-short 지원
- **ALPHA_CATEGORY** 신규: 6 카테고리 매핑
- **새 가중치 함수 3개**: icWeights, corrAdjustedWeights, categoryBestWeights
