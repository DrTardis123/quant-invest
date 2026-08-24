# 실전 투입 가이드 (Production-Ready)

> **상태**: 모의투자 우선, 1-3개월 검증 후 실전 투입
> **시스템 버전**: Combined (regime avg) + Top 10 + 40일 리밸 — Sharpe +1.21 / MDD -3.4% (5-fold CV)
> **대시보드**: `/ops.html`

## 1. 사용자 선택 (2026-08-25)

| 항목 | 선택 | 비고 |
|---|---|---|
| 투입 범위 | **모의투자 우선** | 1-3개월 검증 후 실전 |
| 알림 | **대시보드만** | Slack/Discord 없음 |
| 리스크 한도 | **공격적** | MDD -25%, 일일 -8% |

## 2. 시스템 안전장치 (구축 완료)

### 2.1 회로차단기 (Circuit Breaker) — `src/data/risk.js`

| 트리거 | 임계값 | 동작 |
|---|---|---|
| MDD 한도 | -25% | ⛔ 자동 정지 (신호 생성 차단) |
| 일일 손실 | -8% | ⛔ 자동 정지 |
| 주간 손실 | -15% | ⚠️ 경고 |
| 연속 손실 | 5일 | ⚠️ 경고 |

**동작:**
- `portfolio-state.json`에서 MDD/일일/주간/연속손실 추적
- `ops-status.json`에 회로차단기 상태 기록
- `daily-signals.js` 시작 시 회로차단기 평가 → halt면 exit 1
- `/ops.html` 대시보드에서 실시간 상태 확인

### 2.2 Position Sizing — `src/data/risk.js`

**Kelly Criterion (half-Kelly) + Vol Targeting 결합:**

```
weight = min(Kelly_fraction, vol_target, max_position_pct)
weight = max(weight, min_position_pct)
weight = min(weight, 1/total_positions × 1.2)
```

| 파라미터 | 기본값 | 의미 |
|---|---:|---|
| `maxPositionPct` | 10% | 단일 종목 최대 비중 |
| `minPositionPct` | 2% | 단일 종목 최소 비중 |
| `maxTotalPositions` | 10개 | 동시 보유 한도 |
| `kellyFraction` | 0.5 (half-Kelly) | 보수적 Kelly |
| `maxKellyFraction` | 25% | Kelly cap |
| `targetVol` | 15% (연환산) | 목표 변동성 |
| `kellyMinSharpe` | 0.3 | Sharpe < 0.3이면 Kelly 비활성 |

**예시:**
- totalEquity = 10,000,000원
- recentSharpe = 1.2 (백테스트), recentVol = 0.15
- 신호 Top 10 → Kelly 6% (1.2 × 0.1 × 0.5), vol_target 7.5% (0.15/0.2)
- → min(6%, 7.5%, 10%) = 6% per slot
- 10종목 × 60만원 = 6,000만원 (현금 4,000만원)

### 2.3 Pre-flight 검증 — `scripts/pre-flight.js`

매 신호 생성 전 sanity check:
- DB 데이터 신선도 (2일 이내)
- 유니버스 크기 (1,000개 이상)
- 회로차단기 상태
- holdings.json 유효성

**실패 시:** 신호 생성 차단, ops-status.json에 기록

## 3. 모의투자 셋업 (사용자 작업)

### 3.1 KIS 모의투자 API 키 발급

1. **KIS Developers Portal** 가입: https://apiportal.koreainvestment.com
2. **모의투자 앱** 등록:
   - 앱 이름: `quant-invest-mock`
   - 서비스: `모의투자` (Real은 실제 돈)
   - redirect URL: `http://localhost:5000`
3. **발급 정보**:
   - `KIS_APP_KEY` (앱 키)
   - `KIS_APP_SECRET` (앱 시크릿)
   - 모의 계좌번호 (`KIS_ACCOUNT_NO`, 예: `000-00-000000`)
4. **GitHub Secret 등록**:
   - Repo → Settings → Secrets and variables → Actions
   - `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_ACCOUNT_NO` 추가
5. **일 200건 한도**: 모의투자는 1일 200건 fetch 가능. 5년치 1회성 + 매일 증분 fetch로 충분.

상세 가이드: `docs/KIS-LIVE-API-KEY.md` (모의투자 키 발급 절차 동일)

### 3.2 holdings.json 등록 (선택)

`public/data/holdings.json`에 보유 종목 등록:

```json
[
  {
    "code": "005930",
    "name": "삼성전자",
    "shares": 10,
    "avgPrice": 70000,
    "currentPrice": 72000,
    "stopLoss": -0.08,
    "takeProfit": 0.20,
    "buyDate": "2026-01-15"
  }
]
```

- `code`: 종목코드 (6자리)
- `name`: 종목명
- `shares`: 보유 수량
- `avgPrice`: 평균 매수가
- `currentPrice`: 현재가 (자동 갱신 또는 수동)
- `stopLoss`: 손절 비율 (예: -0.08 = -8%)
- `takeProfit`: 익절 비율 (예: 0.20 = +20%)

**미등록 시:** stop-alert가 작동하지 않음 (대시보드만 갱신)

### 3.3 GitHub Actions cron 활성화

`.github/workflows/daily.yml`은 이미 작성되어 있어 push 시 자동 활성화:

- 16:30 KST (07:30 UTC) — 데이터 fetch
- 17:00 KST (08:00 UTC) — 일일 신호 (pre-flight 포함)
- 17:30 KST (08:30 UTC) — 손절/익절 알림
- 18:00 KST (09:00 UTC) — 일일 리포트

**수동 트리거:**
- GitHub → Actions → "Daily Data + Signals + Report" → Run workflow
- task 선택: `all` / `data` / `signals` / `alerts` / `report`

## 4. 일일 운영 (사용자 작업)

### 4.1 장 마감 후 (16:30 ~ 18:00 KST)

GitHub Actions가 자동 실행 → `signals.json`, `ops-status.json`, `alerts.json` 갱신.

### 4.2 대시보드 확인

`https://yourdomain.com/ops.html` 접속:
- 회로차단기 상태 (NORMAL / WARNING / HALT)
- 일일 신호 (1차매수, 1차매도)
- Position Sizing 추천 (Kelly + vol targeting)
- 보유 종목 (PnL, 손절/익절)
- Pre-flight 상태

### 4.3 매매 결정

**원칙: "신호는 시스템이, 매매는 사람이"**

1. `1차매수` 신호 확인 → `Position Sizing 추천`의 비중 참고
2. **본인이 판단**해서 매수/매도 결정
3. 체결 후 `holdings.json` 업데이트 (수동)
4. `stopLoss` / `takeProfit` 도달 시 `stop-alert.js`가 GitHub Issue 자동 생성

### 4.4 비상 대응

| 상황 | 대응 |
|---|---|
| 회로차단기 HALT | **신호 무시**, 보유 종목 손절/익절만 실행 |
| 일일 손실 -8% | **매수 금지**, 다음 날 회복 확인 |
| MDD -20% (5% 남음) | **포지션 축소** (각 5%로) |
| 데이터 신선도 실패 | `/update` 수동 실행, fetch 후 재시도 |
| 회로차단기 강제 해제 | `holdings.json`의 `forcedOverride: true` 추가 후 pre-flight 무시 |

## 5. 검증 단계 (1-3개월)

### 5.1 1주차: 모의투자 셋업 + 첫 신호 확인

- [ ] KIS 모의투자 키 발급 + GitHub Secret 등록
- [ ] 첫 cron 실행 (workflow_dispatch → `all`)
- [ ] `ops.html` 접속 → 회로차단기 NORMAL 확인
- [ ] 1차매수 신호 5-10개 확인 → 모의투자 앱에서 동일 종목 매수
- [ ] `holdings.json` 등록 → 손절/익절 기준 설정

### 5.2 2-4주차: 신호 추적

- [ ] 일일 신호 vs 실제 모의투자 수익 비교
- [ ] `signal-performance.json` 자동 누적 확인
- [ ] 회로차단기 발동 여부 확인
- [ ] Position Sizing 추천이 적절한지 검토

### 5.3 1-3개월: hit rate + Sharpe

- [ ] 모의투자 Sharpe 계산 (목표: 0.5+)
- [ ] 5-fold CV 결과 (Sharpe +1.21)와 비교
- [ ] 회로차단기 발동 시 정상 작동 확인
- [ ] hit rate 50% 이상이면 실전 투입 검토

### 5.4 3-6개월: 실전 투입 결정

| 모의투자 결과 | 실전 투입 |
|---|---|
| Sharpe >= 0.5, hit rate >= 50% | ✅ 소액 (1매수당 50만원) |
| Sharpe 0.2 ~ 0.5 | ⚠️ 추가 검증 (1개월) |
| Sharpe < 0.2 | ❌ 전략 재검토 |

## 6. 실전 키 전환 (선택)

3-6개월 모의투자 성공 시 KIS 실전 키 발급:
- 모의투자 endpoint → 실전 endpoint로 변경
- `KIS_IS_PAPER='false'`
- `docs/KIS-LIVE-API-KEY.md` 참조

**주의:**
- 1일 200건 → 5,000건 (실전)
- 실제 돈 → 손실 리스크
- 세금/수수료 별도
- 비상 정지 메커니즘 반드시 작동 확인

## 7. 운영 메트릭

### 7.1 일일 점검

- `ops.html` → 회로차단기 NORMAL 확인
- `signals.json` → 1차매수/1차매도 카운트 확인
- `alerts.json` → 손절/익절 알림 확인

### 7.2 주간 점검

- `docs/DAILY-*.md` → 일일 리포트 (자동 생성)
- `signal-performance.json` → 누적 hit rate
- MDD 추이 (급격한 증가 시 포지션 축소)

### 7.3 월간 점검

- Sharpe, MDD, hit rate 종합 평가
- `cv-30-regime.json` 다시 실행 → regime 변화 추적
- 5-fold CV 재실행 (분기 1회)

## 8. 비상 정지 메커니즘

**자동 정지:**
- MDD -25% 초과
- 일일 손실 -8% 초과
- 데이터 신선도 2일 초과
- 유니버스 < 1,000개

**수동 정지:**
- `holdings.json`에 `{"code": "STOP", "_halt": true}` 추가
- 또는 `portfolio-state.json`의 `mdd`를 `-0.30`으로 수동 설정
- `daily-signals.js` 실행 시 회로차단기가 halt로 평가

**강제 해제 (비추천):**
- `src/data/risk.js`의 `DEFAULTS.mddLimit`을 `-0.50`으로 임시 변경
- 단, 다음 deploy 시 원복됨

## 9. 관련 파일

| 파일 | 용도 |
|---|---|
| `src/data/risk.js` | 회로차단기 + position sizing |
| `scripts/pre-flight.js` | 일일 sanity check |
| `scripts/daily-signals.js` | 신호 생성 (pre-flight + sizing 통합) |
| `public/ops.html` | 운영 대시보드 |
| `public/data/ops-status.json` | 운영 상태 (자동 갱신) |
| `public/data/portfolio-state.json` | 포트폴리오 손익 추적 |
| `public/data/holdings.json` | 보유 종목 (수동 갱신) |
| `public/data/holdings.template.json` | 보유 종목 템플릿 |
| `.github/workflows/daily.yml` | 일일 cron (pre-flight 포함) |
| `docs/PRODUCTION-READY.md` | 본 문서 |
| `docs/KIS-LIVE-API-KEY.md` | KIS API 키 발급 (모의/실전) |
| `docs/OPERATIONS-GUIDE.md` | 일일/주간/월간 운영 가이드 |
| `docs/ALERT-RUNBOOK.md` | 문제 대응 매뉴얼 |
| `docs/PER-ALPHA-SELECTION.md` | 5-fold CV + HMM 3-state |

## 10. 변경 이력

- **2026-08-25**: 실전 투입 시스템 구축
  - `src/data/risk.js` 신규 — Kelly + vol targeting + circuit breaker
  - `scripts/pre-flight.js` 신규 — 일일 sanity check
  - `public/ops.html` 신규 — 운영 대시보드
  - `daily-signals.js` 수정 — position sizing + risk gate
  - `daily.yml` 수정 — pre-flight 단계 추가
  - `holdings.template.json` 업데이트 — 모의투자용
  - `docs/PRODUCTION-READY.md` 신규 — 본 문서
