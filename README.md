# 📊 퀀트 투자 대시보드

> **"신호는 시스템이, 매매는 사람이."**
> 30 알파 (모멘텀/반전/거래량/변동성/추세/유동성) + 14개 매트릭스 + 5-fold walk-forward CV
> KOSPI/KOSDAQ 1,355개 종목 × 1,222일 (5년치) 일봉 데이터 기반

## 🎯 시스템 역할

| | 시스템 | 사람 |
|---|---|---|
| **데이터 수집** | ✅ 자동 (cron) | - |
| **신호 생성** | ✅ 자동 (장 마감 후) | - |
| **알림** | ✅ Slack/이메일/대시보드 | 수신 |
| **매수/매도 실행** | - | ✅ 직접 |
| **포지션 사이징** | 추천 (Kelly + vol) | ✅ 직접 결정 |
| **손절/익절** | 알림 (매트릭스 변화) | ✅ 직접 실행 |

## 🚀 빠른 시작

### 라이브 대시보드
- 🌐 https://tardisquantinvest.vercel.app
- 📱 모바일 / 데스크톱 / PWA 지원

### 로컬 실행
```bash
# 1. 저장소 클론
git clone https://github.com/DrTardis123/quant-invest.git
cd quant-invest

# 2. 의존성 설치
npm install

# 3. 환경변수 (.env)
# KIS_APP_KEY=your_key
# KIS_APP_SECRET=your_secret
# KIS_ACCOUNT_NO=your_account
# KIS_IS_PAPER=true

# 4. 일일 갱신
node scripts/update.js

# 5. 로컬 서버 (테스트)
node scripts/dev-server.js
# http://localhost:5180
```

## 📁 문서

### 운영
- 📐 [SYSTEM-ARCHITECTURE.md](./docs/SYSTEM-ARCHITECTURE.md) — 시스템 구조
- 📋 [OPERATIONS-GUIDE.md](./docs/OPERATIONS-GUIDE.md) — 일일/주간/월간 운영 가이드
- 🚨 [ALERT-RUNBOOK.md](./docs/ALERT-RUNBOOK.md) — 문제 대응 매뉴얼
- 📊 [HISTORY.md](./docs/HISTORY.md) — 전체 진행 히스토리

### 데이터
- 🔑 [KIS-API-GUIDE.md](./docs/KIS-API-GUIDE.md) — KIS 모의투자 API 사용법
- 🔑 [KIS-LIVE-API-KEY.md](./docs/KIS-LIVE-API-KEY.md) — 실전투자 키 발급

### 분석 결과
- 📈 [ALPHA-30-IC.md](./docs/ALPHA-30-IC.md) — 30 알파 IC 분석
- 🔄 [CV-30-ALPHAS.md](./docs/CV-30-ALPHAS.md) — 5-fold walk-forward CV
- 📊 [CV-30-SUMMARY.md](./docs/CV-30-SUMMARY.md) — CV 결과 분석
- 📋 [QUANT-IMPROVEMENTS-SUMMARY.md](./docs/QUANT-IMPROVEMENTS-SUMMARY.md) — 개선 작업 요약
- 🔬 [BACKTEST-ALPHA-3Y.md](./docs/BACKTEST-ALPHA-3Y.md) — 3년 OOS 백테스트

## 🏗️ 시스템 구성

### 30 알파 (6 카테고리)
- **모멘텀** (5): a_mom5, a_mom20, a_mom60, a_mom5_neg, a_mom_clipped
- **반전** (5): a_053, a_055, a_rev5, a_rev10, a_no_new_high
- **거래량** (5): a_006, a_010, a_vol_rank, a_006_pos, a_dolv_rank
- **변동성** (5): a_017, a_034, a_vol20, a_range_pct, a_path5
- **추세** (5): a_009, a_022, a_trend20_sign, a_trend_score, a_up_ratio_20
- **유동성** (5): a_028, a_041, a_liq_lev, a_liq_rank, a_liq_score

### 가중치 4가지
1. **균등 30 알파**: 1/30 = 3.3% each
2. **IC 가중치**: t-statistic 비례
3. **Cross-correlation 보정**: IC × 독립성 (Ledoit-Wolf style)
4. **카테고리 best 1개씩**: 6 알파 (분산 극대화) — **권장**

### 5-fold walk-forward CV 결과
**최고**: 카테고리 best + Top 3 + 40일 리밸 — **Sharpe +0.066**, MDD -25.9%

### 14개 매트릭스 요소
- 골든크로스 / 정배열
- 60일선 지지 / 볼린저밴드
- 52주 저점 / RSI
- MACD / 피보나치
- 이격도 / ADX
- 캔들 패턴 / OBV
- 스윙 로우/하이 / Polarity / 라운드

## ⏰ 자동화 (GitHub Actions cron)

| 시간 (KST) | 작업 | 스크립트 |
|---|---|---|
| 16:30 (월~금) | 데이터 fetch + 갱신 | `scripts/update.js` |
| 17:00 (월~금) | 일일 신호 생성 | `scripts/daily-signals.js` |
| 17:30 (월~금) | 손절/익절 알림 | `scripts/stop-alert.js` |
| 18:00 (월~금) | 일일 리포트 | `scripts/daily-report.js` |
| 매일 자정 | DuckDB 백업 | `scripts/backup-db.js` |
| 일요일 23:00 | 주간 리포트 | (예정) |

## 📦 기술 스택

- **Backend**: Node.js 24, DuckDB 1.x (AlphaSignal 호환)
- **Frontend**: HTML/CSS/JS (Bootstrap 5.3 + 다크 테마)
- **Deploy**: Vercel + GitHub Actions
- **Data**: KIS Developers API (모의투자)
- **Math**: alpha-engine.js (30 알파 + 5-fold CV + Deflated Sharpe)
- **PWA**: Service Worker (오프라인 지원)

## 🛡️ 보안

- KIS API 키: `.env` (gitignore) + GitHub Secrets
- 모의투자 키만 사용 (1일 200건 한도)
- 실전 키는 사용자 판단 하에 발급 ([KIS-LIVE-API-KEY.md](./docs/KIS-LIVE-API-KEY.md))

## 📜 라이선스

MIT License — 개인 사용/연구 목적

## 🤝 기여

이슈/PR 환영. 단, 자동 매매 실행은 포함하지 않음 (사용자 판단 영역).
