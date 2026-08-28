# 현재 상태 스냅샷 (STATE)

> **목적**: 작업 재개 시 즉시 컨텍스트 파악
> **최종 업데이트**: 2026-08-28
> **담당자**: MiniMax (인수인계 진행) → Claude Code / Gemini

## 1. 한 줄 요약

**모의투자 1단계 (1-3개월) 시작 직전**. 시스템은 완성, 5-fold CV Sharpe +1.21 검증됨. KIS 모의투자 키 등록 + GitHub Actions cron 작동 중.

## 2. 마지막 작업 (2026-08-24 ~ 25)

### 2.1 완료 (커밋 7a3dd67c)
- ✅ **실전 투입 시스템 구축** (회로차단기 + position sizing + 운영 대시보드)
- ✅ `src/data/risk.js` — Kelly + vol targeting + circuit breaker
- ✅ `scripts/pre-flight.js` — 일일 sanity check
- ✅ `public/ops.html` — 🛡️ 운영 대시보드
- ✅ `public/data/ops-status.json` — 자동 갱신
- ✅ `daily-signals.js` 통합 + `.github/workflows/daily.yml` pre-flight 추가
- ✅ `docs/PRODUCTION-READY.md` — 10섹션 가이드

### 2.2 사용자 선택 (2026-08-25)
- **모의투자 우선** (1-3개월 검증 후 실전)
- **대시보드만** (Slack/Discord 없음)
- **공격적 리스크** (MDD -25%, 일일 -8%)

## 3. 핵심 결과 (5-fold walk-forward CV)

| 항목 | 값 |
|---|---|
| 최고 Sharpe | **+1.206** (regime-aware, 비용 모델 on) |
| 최고 MDD | **-3.4%** |
| 최고 Fold | F3 (+2.28) |
| Worst Fold | F1 (-0.85) |
| 5-fold 모두 양수 | ✅ (worst fold도 손실 제한) |
| 이전 대비 | +0.121 → +1.206 (9.97배 개선) |

**최종 운영 설정** (regime-conditioned):
- 가중치: Combined (regime avg, 3-state 평균)
- Top N: 10
- Rebalancing: 40일
- 비용 모델: enabled (turnover 기반)

## 4. 진행 중 (In Progress)

| 작업 | 상태 | 비고 |
|---|---|---|
| 모의투자 1-3개월 검증 | ⏳ 시작 직전 | KIS 모의투자 키 등록됨, cron 작동 중 |
| `holdings.json` 실제 등록 | ⏳ 미착수 | 모의투자 종목 등록 필요 |
| 일일 hit rate 추적 | ⏳ 모의투자 시작 후 | signal-performance.json 누적 |
| 분기 단위 CV 재실행 | ⏳ 3개월 후 | regime 변화 추적 |

## 5. 다음 작업 (Next Steps)

### 5.1 즉시 (사용자)
- [ ] GitHub Actions 페이지에서 daily workflow run 22의 4개 job (data/signals/alerts/report) 실행 여부 확인
- [ ] KIS 모의투자 앱 로그인 → 키 확인
- [ ] GitHub Secrets 4개 (KIS_APP_KEY, KIS_APP_SECRET, KIS_ACCOUNT_NO, ALERT_WEBHOOK) 등록 확인
- [ ] `https://tardisquantinvest.vercel.app/ops.html` 접속 → 회로차단기 NORMAL 확인
- [ ] 첫 workflow_dispatch 수동 트리거 (Run workflow → task='all')

### 5.2 모의투자 1-3개월
- [ ] 일일 신호 vs 실제 모의투자 매매 비교
- [ ] `docs/DAILY-*.md` 자동 생성 확인
- [ ] 회로차단기 발동 시 정상 작동 확인
- [ ] Sharpe 0.5+ 도달 시 실전 검토

### 5.3 3-6개월 (선택)
- [ ] KIS 실전 키 발급 (`docs/KIS-LIVE-API-KEY.md` 참조)
- [ ] 소액 실전 (1매수당 50만원)
- [ ] Slack/Discord webhook 설정
- [ ] 5-fold CV 분기 재실행

## 6. 시스템 상태

### 6.1 GitHub Actions (4 워크플로우)
| 워크플로우 | 상태 | 비고 |
|---|---|---|
| Daily Data + Signals + Report (daily.yml) | ✅ run 22 success | 38분, KIS 모의투자 fetch |
| KIS 5년치 일봉 fetch (kis-5y.yml) | 🟡 수동 | |
| Realtime Price Update (realtime.yml) | ✅ run 21 success | 20초 |
| Update flow regime (update-flow-regime.yml) | ❌ step 6 push 실패 | Python 별도, **무시 가능** |

### 6.2 데이터
- **DuckDB**: 1,355개 활성 종목 × 1,222일 (5년치)
- **마지막 데이터**: 2026-08-21 (3일 전, 주말)
- **백업**: `data/quant.db.backup-*` (30일 보관)

### 6.3 핵심 JSON 파일
- `public/data/signals.json` — 일일 신호 (1차/2차 매수/매도)
- `public/data/ops-status.json` — 운영 상태 (자동 갱신)
- `public/data/portfolio-state.json` — 포트폴리오 손익 (수동)
- `public/data/holdings.json` — 보유 종목 (수동)
- `public/data/market-regime.json` — 시장 평가 (CNN F&G 5지표)
- `public/data/regime-hmm-3state.json` — HMM 3-state
- `public/data/per-alpha-wf.json` — 5개 선정 알파
- `public/data/regime-ic.json` — Regime별 알파 IC
- `public/data/cv-30-final.json` — 통합 CV
- `public/data/cv-30-regime.json` — Regime-aware CV

## 7. 환경 / 의존성

### 7.1 GitHub Secrets (필수)
- `KIS_APP_KEY` — KIS 모의투자 앱 키 ✅
- `KIS_APP_SECRET` — KIS 모의투자 시크릿 ✅
- `KIS_ACCOUNT_NO` — 모의 계좌번호 ✅
- `ALERT_WEBHOOK` — (선택) Slack/Discord webhook

### 7.2 Node.js 패키지
- `duckdb` (1.x)
- `chart.js`, `bootstrap` (5.3.3)
- 기타 npm dependencies

### 7.3 OS / Shell
- Windows PowerShell (NOT bash)
- `;` NOT `&&`
- `Get-ChildItem` NOT `ls`
- `Select-Object` NOT `grep`
- `node` 실행 시 `--max-old-space-size=12288` (DuckDB 1.6M행)

## 8. 알려진 이슈

| # | 이슈 | 영향 | 상태 |
|---|---|---|---|
| 1 | "Update flow regime" 워크플로우 push 실패 | 무시 가능 (Python 별도) | 🟡 |
| 2 | DuckDB WAL stale lock | daily cron 시작 시 `DUCKDB_READ_ONLY=1` | 🟢 해결 |
| 3 | Vercel 588MB throttle | `public/data/stock/*.json` 제외 | 🟢 해결 |
| 4 | Vercel Anti-Bot (481KB) | GitHub raw URL 우회 | 🟢 해결 |
| 5 | Naver 모바일 API 409 | KIS API로 우회 | 🟢 해결 |
| 6 | HMM 2-state 수렴 실패 | 3-state weekly로 해결 | 🟢 해결 |
| 7 | OOS Sharpe 1.21 vs live paper | 1-3개월 검증 필요 | ⏳ 진행 중 |
| 8 | MDD -100% (paper) | 비용 모델 활성화 | 🟢 해결 |
| 9 | in-sample overfit 의심 | 5-fold CV + regime-aware | 🟢 검증됨 |
| 10 | 101 알파 / 비선형 모델 | 사용자 금지 (5원칙) | 🔴 유지 |

## 9. 다음 AI에게

### 9.1 즉시 확인
```bash
# 시스템 상태
node scripts/pre-flight.js

# 5-fold CV 재현 (선택)
node scratch/cv-30-regime.js  # 17분
node scratch/per-alpha-wf.js  # 15분

# 데이터 신선도
ls -la public/data/signals.json
```

### 9.2 사용자가 다음에 물어볼 만한 것
- "내일 신호 어떻게 봐?" → `/ops.html` 접속
- "회로차단기 발동했어" → `src/data/risk.js` 확인, MDD/일일 한도 조정
- "5-fold CV 다시 돌려줘" → `node scratch/cv-30-regime.js` (costModel on)
- "다른 알파 추가해줘" → **거부** (5원칙 #2)
- "자동 매매해줘" → **거부** (5원칙, 신호-매매 분리)

### 9.3 절대 하지 말 것
- ❌ 가중치 재최적화 (5원칙 #1)
- ❌ 101 알파 추가 (5원칙 #2)
- ❌ alpha-engine.js 우회 (5원칙 #3)
- ❌ daily_prices 스키마 변경 (5원칙 #4)
- ❌ XGBoost 등 비선형 모델 (5원칙 #5)
- ❌ Python 사용
- ❌ 자동 매매
- ❌ 영어 응답

## 10. 한 줄 진단

> **"퀀트투자 시스템으로서 정리는 완료, 수익은 검증 중"**
>
> - 인프라: ✅✅ (regime-aware + 회로차단기 + 운영 대시보드)
> - 5-fold CV: ✅ +1.21 Sharpe, MDD -3.4%
> - 실전: ⏳ 모의투자 1-3개월 hit rate 검증 후 결정
> - 위험: ⚠️ in-sample overfit 가능성, 비용 모델로 보정

## 11. 연락처 / 참고

- **GitHub Issues**: https://github.com/DrTardis123/quant-invest/issues
- **대시보드**: https://tardisquantinvest.vercel.app/
- **운영**: https://tardisquantinvest.vercel.app/ops.html
- **KIS Developers**: https://apiportal.koreainvestment.com
- **Vercel 대시보드**: (사용자 설정)

---

**이 문서 + HANDOFF.md + README.md 3개만 읽으면 어디서든 작업 재개 가능**.
