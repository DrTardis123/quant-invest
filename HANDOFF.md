# AI 도구 인수인계 가이드 (HANDOFF)

> **목적**: Claude Code / Gemini / 기타 AI 도구로 작업을 이어받을 때 필요한 모든 정보
> **최종 업데이트**: 2026-08-28
> **원작 AI**: MiniMax (agent-f1cb1bd963e6)

## 1. 프로젝트 한 줄 요약

**한국 KOSPI/KOSDAQ 퀀트 투자 대시보드** — 30 알파 + 14 매트릭스 + 5-fold walk-forward CV 기반 신호 생성, Vercel 대시보드 + GitHub Actions cron 자동 운영.

**핵심 원칙**: *"신호는 시스템이, 매매는 사람이"* (자동 매매 X, 신호만 제공)

## 2. 즉시 알아야 할 5가지

### 1) 사용자
- **이름**: DrTardis (DrTardis123)
- **언어**: **한국어** (모든 응답 한국어로)
- **투자 성향**: 스윙(중단기) 투자자, 단타 X, 매수/매도 명확한 간격
- **기준**: 거래량 X, **거래대금 O** (유동성)
- **GitHub**: https://github.com/DrTardis123/quant-invest

### 2) 환경
- **OS**: Windows (PowerShell, NOT bash)
- **Node.js**: 24
- **데이터베이스**: DuckDB 1.x (`data/quant.db`, 181MB, .gitignore)
- **Shell 주의**: `&&`, `head`, `tail`, `grep` 사용 X → `;`, `Get-ChildItem`, `Select-Object`, `Select-String` 사용
- **작업 디렉토리**: `C:\Users\LG\Documents\quant_invest\`

### 3) KIS 모의투자 API 키 등록됨 (GitHub Secrets)
- `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_ACCOUNT_NO` 등록 완료
- endpoint: `https://openapivts.koreainvestment.com:29443` (모의투자)
- 1일 200건 한도

### 4) 가장 중요한 4개 md 파일 (다른 AI 도구로 인수인계 시)
| 파일 | 용도 |
|---|---|
| [README.md](./README.md) | 프로젝트 개요 + 빠른 시작 |
| [PRODUCTION-READY.md](./docs/PRODUCTION-READY.md) | **실전 투입 가이드** (가장 최신) |
| [PER-ALPHA-SELECTION.md](./docs/PER-ALPHA-SELECTION.md) | 30 알파 5-fold CV + HMM 3-state 결과 |
| [OPERATIONS-GUIDE.md](./docs/OPERATIONS-GUIDE.md) | 일일/주간/월간 운영 |
| [STATE.md](./STATE.md) | **현재 상태 스냅샷** (필수) |

### 5) 마지막 커밋
- `7a3dd67c` — 실전 투입 시스템 (회로차단기 + position sizing + 운영 대시보드)
- 이전: `0e8bd36` — per-alpha + HMM 3-state + regime-conditioned CV (Sharpe +1.21)

## 3. 코드 진입점

### 3.1 핵심 파일 (수정 가능)
```
src/
  data/
    signals.js           — 14개 매트릭스 + 신호 평가 (매우 중요)
    factors/index.js     — 7-factor 가중치 (가치/모멘텀/퀄리티/저변동성/성장/유동/수급)
    market.js            — 시장 평가 (CNN F&G 5지표)
    filters.js           — 제외 종목 (ETF/우선주/스팩)
    risk.js              — 회로차단기 + position sizing (Kelly + vol targeting)
    kis.js               — KIS API OAuth2 + 일봉 endpoint
    regime-hmm.js        — HMM 3-state (low_vol / mid_vol / high_vol)
  db/
    connection.js        — DuckDB 연결 (DUCKDB_READ_ONLY=1 read-only)

scripts/
  update.js              — 메인 갱신 (장 마감 후 cron)
  pre-flight.js          — 회로차단기 + 데이터 신선도 검증
  daily-signals.js       — 일일 신호 생성 (pre-flight + position sizing 통합)
  stop-alert.js          — 손절/익절 알림
  track-signals.js       — 신호 일지 (+10d 수익률 추적)
  daily-report.js        — 일일 리포트
  backup-db.js           — DuckDB 일일 백업 (30일 보관)
  daily-pipeline.js      — 통합 파이프라인
  fetch-kis-5y.js        — KIS 5년치 일봉 (incremental)
  dev-server.js          — 로컬 개발 서버 (포트 5180)

scratch/lib/alpha-engine.js  — 30 알파 엔진 (실험/연구용, 프로덕션 X)
```

### 3.2 웹 대시보드
```
public/
  index.html             — 메인 (12탭)
  analysis.html          — 분석 (8탭)
  explore.html           — 탐색 (6탭)
  ops.html               — 🛡️ 운영 대시보드 (회로차단기, 신호, holdings, position sizing)
  css/dark.css           — 다크 테마 (Bootstrap override)
  js/dark.js             — 사이드바 동적 삽입
  js/app.js              — 매트릭스 차트, 신호, 매매, regime 가중치
  data/                  — JSON 데이터 (signals.json, market-regime.json 등)
```

## 4. 시스템 작동 흐름

### 4.1 일일 파이프라인 (GitHub Actions cron)

```
[16:30 KST] → npm run update (data fetch)
              ├─ 1. 종목 목록 갱신 (3,920개)
              ├─ 2. KIS 모의투자 일봉 증분 fetch (~5-10분)
              ├─ 3. DuckDB 저장
              └─ 4. public/data/*.json export
              ↓
[17:00 KST] → scripts/pre-flight.js
              ├─ DB 신선도 (5일 이내)
              ├─ 유니버스 (1,000개+)
              └─ 회로차단기 평가
              ↓
              → scripts/daily-signals.js
                ├─ 매트릭스 계산 (Top 300)
                ├─ 1차/2차 매수/매도 신호 추출
                ├─ Position sizing (Kelly + vol targeting)
                └─ signals.json + ops-status.json 저장
              ↓
[17:30 KST] → scripts/stop-alert.js (holdings.json 보유 종목 손절/익절)
[18:00 KST] → scripts/daily-report.js (마크다운 일일 리포트)
[매일 자정] → scripts/backup-db.js (DuckDB 백업 30일 보관)
```

### 4.2 사용자가 보는 화면
- `https://tardisquantinvest.vercel.app/` — 메인 (대시보드)
- `https://tardisquantinvest.vercel.app/ops.html` — 🛡️ **운영 대시보드** (회로차단기 + 일일 신호 + holdings)

## 5. 핵심 원칙 (사용자 지시)

> 5번 다 중요. 위반 시 작업 거부.

1. **가중치 재최적화 금지** — 5-fold CV에서 결정된 가중치 그대로 사용
2. **101 알파 추가 투입 금지** — 30 알파 시스템 유지
3. **alpha-engine.js 우회 금지** — 모든 알파 계산은 alpha-engine.js 사용
4. **daily_prices 스키마 변경 금지** — DuckDB 테이블 구조 유지
5. **비선형 모델 금지** — XGBoost 등 사용 안 함 (선형 가중치만)

추가:
- **Python 사용 X** — Node.js/HTML/JS만
- **자동 매매 X** — 신호만 제공, 매매는 사람이 결정
- **한국어 응답**

## 6. 데이터 모델

### 6.1 DuckDB 테이블
```sql
-- daily_prices: 일별 시세
(code, date, open, high, low, close, volume, trading_value, market_cap)

-- stocks: 종목 메타
(code, name, market, sector, industry, listed_shares, updated_at)

-- factor_scores: 7-factor 점수
(code, date, total_score, value, momentum, quality, low_vol, growth, liquidity, supply_demand)

-- realtime_quotes, fundamentals, investor_flow, update_log
```

### 6.2 DuckDB 주의사항
- **WAL stale lock**: 다른 프로세스가 점유 중 → `DUCKDB_READ_ONLY=1` env로 read-only 모드 (자식 process에도 적용)
- **REGEXP 미지원** → LIKE 우회
- **CTE는 query scope만** → cross-query temp table 사용
- **BigInt 반환** → JS에서 `Number()` 변환
- **read-write 모드**: temp table 생성 시 필요 (`delete process.env.DUCKDB_READ_ONLY`)

## 7. 30 알파 시스템 (alpha-engine.js)

### 7.1 6 카테고리 × 5 알파
| 카테고리 | 알파 |
|---|---|
| 모멘텀 | a_mom5, a_mom20, a_mom60, a_mom5_neg, a_mom_clipped |
| 반전 | a_053, a_055, a_rev5, a_rev10, a_no_new_high |
| 거래량 | a_006, a_010, a_vol_rank, a_006_pos, a_dolv_rank |
| 변동성 | a_017, a_034, a_vol20, a_range_pct, a_path5 |
| 추세 | a_009, a_022, a_trend20_sign, a_trend_score, a_up_ratio_20 |
| 유동성 | a_028, a_041, a_liq_lev, a_liq_rank, a_liq_score |

### 7.2 OOS Robust 5개 (per-alpha walk-forward CV)
1. **a_up_ratio_20** (추세) — Sharpe +0.649, sign 60%
2. **a_006_pos** (거래량) — Sharpe +0.244, sign 80%
3. **a_009** (추세) — Sharpe +0.075, sign 60%
4. **a_006** (거래량) — Sharpe +0.084, sign 40%
5. **a_trend20_sign** (추세) — Sharpe +0.028, sign 40%

### 7.3 5-fold CV (regime-aware, 현실적 비용)
- **최고**: Combined (regime avg) + Top 10 + 40일 = **Sharpe +1.206, MDD -3.4%**
- 이전 cv-30-final +0.121 대비 9.97배 개선
- 5-fold best F3(+2.28), worst F1(-0.85)

## 8. HMM 3-state Regime

- **데이터**: KODEX 200 (069500) weekly resample
- **Feature**: `sharpeLike = weekly_return / weekly_vol` (변동성 평탄화)
- **3-state**: low_vol / mid_vol / high_vol
- **분포**: low 70%, mid 18%, high 12%
- **regime별 best 알파**:
  - low_vol: 거래량/변동성 (a_006, a_vol20, a_range_pct)
  - mid_vol: 모멘텀/추세 (a_mom60, a_up_ratio_20, a_006_pos)
  - high_vol: 반전/추세 (a_up_ratio_20, a_no_new_high, a_mom_clipped)

## 9. 회로차단기 (Circuit Breaker)

| 트리거 | 임계값 | 동작 |
|---|---|---|
| MDD | -25% | ⛔ 자동 정지 |
| 일일 손실 | -8% | ⛔ 자동 정지 |
| 주간 손실 | -15% | ⚠️ 경고 |
| 연속 손실 | 5일 | ⚠️ 경고 |

**동작**: `src/data/risk.js` → `portfolio-state.json` 추적 → `daily-signals.js` 시작 시 halt면 exit 1

## 10. Position Sizing

```
weight = min(Kelly_fraction, vol_target, max_position_pct)
weight = max(weight, min_position_pct)
weight = min(weight, 1/total_positions × 1.2)
```

| 파라미터 | 기본값 |
|---|---:|
| maxPositionPct | 10% |
| minPositionPct | 2% |
| maxTotalPositions | 10 |
| Kelly (half-Kelly 25% cap) | sharpe × 0.1 × 0.5 |
| targetVol | 15% (연환산) |

## 11. GitHub Actions Secrets (필수)

| Secret | 용도 |
|---|---|
| `KIS_APP_KEY` | KIS 모의투자 앱 키 |
| `KIS_APP_SECRET` | KIS 모의투자 시크릿 |
| `KIS_ACCOUNT_NO` | 모의 계좌번호 |
| `ALERT_WEBHOOK` | (선택) Slack/Discord webhook URL |

설정 위치: GitHub Repo → Settings → Secrets and variables → Actions

## 12. 자주 사용하는 명령어

```powershell
# 데이터 갱신 (incremental)
node scripts/update.js

# 일일 신호 생성 (pre-flight + position sizing 통합)
node scripts/daily-signals.js

# 회로차단기 + 데이터 신선도 검증
node scripts/pre-flight.js

# 5-fold CV (regime-aware)
node scratch/cv-30-regime.js

# Per-alpha walk-forward CV
node scratch/per-alpha-wf.js

# HMM 3-state weekly
node scratch/test-hmm3.js

# Regime별 알파 IC
node scratch/regime-ic-fast.js

# 로컬 개발 서버
node scripts/dev-server.js  # http://localhost:5180

# DB 백업
node scripts/backup-db.js
```

## 13. 알려진 이슈 / 트러블슈팅

| 이슈 | 해결 |
|---|---|
| DuckDB WAL stale lock | `DUCKDB_READ_ONLY=1` env (자식 process에도) |
| Vercel 588MB throttle | `public/data/stock/*.json` .vercelignore + .gitignore |
| Vercel Anti-Bot (481KB 챌린지) | `raw.githubusercontent.com` 사용 |
| Naver 모바일 API 409 | iPhone Safari User-Agent + Accept + Referer |
| Naver 일봉 30페이지 cap = 1.2년 | KIS API 우회 (모의 200건/일) |
| DuckDB 일봉 130일 cap | `LOOKBACK_DAYS=100` |
| PowerShell `;` 사용 | bash `&&` X |
| 한글 깨짐 (CP949) | `Get-Content -Encoding UTF8` |
| Cycle 회피 | `src/data/filters.js ↔ src/factors/index.js` 양방향 require 금지 |
| OOM (DuckDB 1.6M행) | `--max-old-space-size=12288` |
| HMM 수렴 실패 (KOSPI) | KODEX 200 weekly + 3-state |
| 다중 가설 보정 한계 | N=1,653,654 큼 → BONF/BH 둘 다 23개 |
| "Update flow regime" 워크플로우 push 실패 | Python 별도, 무시 가능 |

## 14. 작업 인수인계 체크리스트

새 AI 도구로 작업 시작 시:

- [ ] **README.md** 읽기 (프로젝트 개요)
- [ ] **STATE.md** 읽기 (현재 상태)
- [ ] **PRODUCTION-READY.md** 읽기 (실전 가이드)
- [ ] **PER-ALPHA-SELECTION.md** 읽기 (CV 결과)
- [ ] `git log --oneline -10` (최근 커밋)
- [ ] `git status` (변경 사항)
- [ ] `ls public/data/` (JSON 데이터 목록)
- [ ] `node scripts/pre-flight.js` (시스템 상태)
- [ ] GitHub Actions Secrets 확인 (KIS 키)
- [ ] 사용자 한국어 preference 확인
- [ ] **5가지 핵심 원칙 숙지**

## 15. 관련 링크

- **GitHub**: https://github.com/DrTardis123/quant-invest
- **대시보드**: https://tardisquantinvest.vercel.app/
- **운영 대시보드**: https://tardisquantinvest.vercel.app/ops.html
- **GitHub Actions**: https://github.com/DrTardis123/quant-invest/actions
- **KIS Developers**: https://apiportal.koreainvestment.com

---

**문서 끝**. 이 문서만 읽으면 어느 AI 도구로도 작업을 이어받을 수 있어야 함. 빠진 게 있으면 STATE.md와 함께 업데이트할 것.
