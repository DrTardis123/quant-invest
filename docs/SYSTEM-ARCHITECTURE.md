# 퀀트투자 시스템 아키텍처

## 🎯 시스템 역할

> **신호 제공자** (decision support) — 실제 매매는 사람이 직접
> **자동화 범위**: 데이터 수집 → 알파 계산 → 신호 추출 → 알림
> **사람 판단**: 매수/매도 실행, 포지션 사이징, 손절/익절 타이밍

## 📐 시스템 흐름도

```
[ 데이터 소스 ]
  ↓ 매일 16:30 자동 fetch (KIS API)
  │
  ├→ 3,921 종목 일봉 (DuckDB)
  ├→ 실시간 시세 (5분 지연)
  └→ 외국인/기관 flow (Yahoo Finance 등)
  ↓
[ 일일 갱신 파이프라인 ] (GitHub Actions cron)
  │
  ├→ scripts/update.js (전체)
  ├→ scripts/backfill-matrix-200.js
  └→ scripts/fetch-kis-5y.js (5년치 1회성)
  ↓
[ DuckDB: data/quant.db ]
  ↓
[ 신호 생성 ] (매일 17:00)
  │
  ├→ 30 알파 계산 (alpha-engine.js)
  ├→ 가중치 (카테고리 best 6 알파)
  ├→ Top 3 선정 (Best Score)
  └→ 매트릭스 14개 요소 (signals.js)
  ↓
[ 신호 추적 + 알림 ]
  │
  ├→ public/data/signals.json (당일 신호)
  ├→ public/data/signal-performance.json (누적)
  ├→ 매수/매도 알림 (Kakao/이메일/슬랙)
  └→ 손절/익절 알림 (보유 종목 추적)
  ↓
[ 사용자 ] ← 사람이 보고 결정
  │
  ├→ index.html (메인 대시보드)
  ├→ analysis.html (분석)
  └→ explore.html (탐색)
```

## 🗂️ 파일 구조

```
quant-invest/
├── docs/                          ← 문서
│   ├── SYSTEM-ARCHITECTURE.md     ← 시스템 구조
│   ├── OPERATIONS-GUIDE.md        ← 운영 가이드
│   ├── KIS-API-GUIDE.md           ← KIS API 사용법
│   ├── KIS-LIVE-API-KEY.md         ← 실전 키 발급
│   ├── ALPHA-30-IC.md              ← 30 알파 IC 분석
│   ├── CV-30-ALPHAS.md             ← 5-fold CV 결과
│   ├── CV-30-SUMMARY.md            ← CV 분석
│   ├── QUANT-IMPROVEMENTS-SUMMARY.md ← 개선 작업 요약
│   ├── BACKTEST-ALPHA-3Y.md        ← 3년 OOS 백테스트
│   ├── HISTORY.md                  ← 전체 진행 히스토리
│   └── ALERT-RUNBOOK.md            ← 문제 대응 매뉴얼
│
├── public/                        ← 배포 (Vercel)
│   ├── index.html                 ← 메인 (3탭)
│   ├── explore.html               ← 탐색 (6탭)
│   ├── analysis.html              ← 분석 (8탭)
│   ├── css/
│   │   ├── style.css              ← 기존 CSS
│   │   ├── dark.css               ← 다크 테마
│   │   └── dashboard-redesign.css ← AlphaSignal 스타일
│   ├── js/
│   │   ├── app.js                 ← 메인 앱
│   │   ├── common.js              ← 공통
│   │   ├── strategies.js          ← 전략
│   │   ├── reweight.js            ← 가중치
│   │   ├── api.js                 ← API
│   │   ├── notifications.js       ← 알림
│   │   └── dark.js                ← 다크 테마
│   └── data/                      ← JSON 데이터
│       ├── signals.json
│       ├── signal-performance.json
│       ├── matrix-verify-top200.json
│       ├── market-regime.json
│       └── regime-weights.json
│
├── src/                           ← 소스
│   ├── data/
│   │   ├── kis.js                 ← KIS API 클라이언트
│   │   ├── signals.js             ← 매트릭스 + 신호 계산
│   │   ├── market.js              ← 시장 평가
│   │   ├── filters.js             ← ETF/우선주 제외
│   │   └── regime-hmm.js          ← HMM regime (실험)
│   ├── factors/
│   │   └── index.js               ← 7팩터 계산
│   └── db/
│       └── connection.js          ← DuckDB 연결
│
├── scripts/                       ← 운영 스크립트
│   ├── update.js                  ← 메인 갱신
│   ├── fetch-kis-5y.js            ← 5년치 1회성
│   ├── backfill-matrix-200.js     ← 매트릭스 백필
│   ├── daily-signals.js           ← [신규] 일일 신호 생성
│   ├── stop-alert.js              ← [신규] 손절/익절 알림
│   ├── daily-report.js            ← [신규] 일일 리포트
│   └── weekly-report.js           ← [신규] 주간 리포트
│
├── .github/workflows/
│   ├── daily.yml                  ← [정리] 매일 cron
│   └── kis-5y.yml                 ← 5년치 1회성
│
└── data/                          ← DuckDB (gitignore)
    └── quant.db
```

## ⏰ 시간표 (KST)

| 시간 | 작업 | cron | 스크립트 |
|---|---|---|---|
| 15:30 | 장 마감 | - | - |
| 16:00 | 당일 일봉 fetch (KIS) | - | `fetch-kis-5y.js` |
| 16:30 | 일일 갱신 (전체) | `30 7 * * 1-5` | `update.js` |
| 17:00 | 30 알파 계산 + 신호 생성 | `0 8 * * 1-5` | `daily-signals.js` |
| 17:30 | 손절/익절 알림 (보유 종목) | `30 8 * * 1-5` | `stop-alert.js` |
| 18:00 | 당일 신호 JSON export | `0 9 * * 1-5` | `update.js` (EXPORT_ONLY) |
| 일 23:00 | 주간 리포트 | `0 14 * * 0` | `weekly-report.js` |
| 매일 자정 | 일일 리포트 (어제 신호) | `0 15 * * *` | `daily-report.js` |

## 🔐 보안

- KIS API 키: `.env` (gitignore) + GitHub Secrets
- KIS 모의투자 사용 중 (1일 200건 한도)
- 실전 키 발급은 [KIS-LIVE-API-KEY.md](./KIS-LIVE-API-KEY.md) 참조

## 📊 데이터 흐름

### 일일 갱신 (3,921 종목)
```
GitHub Actions cron (매일 16:30 KST)
  ↓
KIS API OAuth2 토큰 발급
  ↓
3,921개 × 1일 = 200건 (모의투자 한도)
  ↓
DuckDB INSERT (idempotent)
  ↓
매트릭스/팩터 재계산
  ↓
JSON export → public/data/
  ↓
Vercel 자동 배포
```

### 5년치 1회성
```
GitHub Actions 수동 트리거 (kis-5y.yml)
  ↓
1,355개 × 1,260일 = ~13 페이지/종목
  ↓
8.3h 소요 (모의투자, rate limit 적용)
  ↓
DuckDB UPSERT
  ↓
신호 계산 인프라 셋업
```

## 🚨 문제 발생시

1. GitHub Actions 실패 → 이메일/Slack 알림 자동
2. 데이터 누락 → `scripts/fetch-kis-5y.js` 수동 실행
3. DuckDB lock → `DUCKDB_READ_ONLY=1` 환경변수
4. 신호 없음 → [ALERT-RUNBOOK.md](./ALERT-RUNBOOK.md) 참조
