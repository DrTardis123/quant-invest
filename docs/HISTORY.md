# 퀀트 투자 대시보드 - 진행 히스토리

> 최종 업데이트: 2026-08-21 (8/21)  
> GitHub: https://github.com/DrTardis123/quant-invest  
> 프로덕션: https://tardisquantinvest.vercel.app/

## 📊 현재 상태 요약

| 영역 | 상태 | 비고 |
|---|---|---|
| 메인 페이지 (index.html) | ✅ 3탭 (TOP 20 / 관심종목 / 10종목) | 시장 평가 카드, 실시간 가격 |
| 탐색 페이지 (explore.html) | ✅ 6탭 (급등락/신고저/히트맵/전체/섹터/수급) | |
| 분석 페이지 (analysis.html) | ✅ 8탭 (분포/상관/최적화/백테스트/10종목/분석/신호/로그) | 매트릭스 분석 추가 |
| **매트릭스 14개 요소** | ✅ 통합 | 골든/정배열/MA/캔들/ADX/OBV/스윙/Polarity/라운드/ATR/BB/RSI/MACD/피보나치/이격도/매물대 |
| **KOSPI/KOSDAQ 검증** | ✅ 200개 × 30일 백필 (1,800 × 30 = 5.4만 row) | |
| **신호 추적** | ✅ buy1/buy2/sell1/sell2 백필 (KOSPI/KOSDAQ) | KOSDAQ buy1 +8.14% 우세 |
| **시장 평가 (CNN F&G)** | ✅ 1-100 점수, 5지표 종합, 60일 시계열 | 현재 38점 (하락장) |
| **등급별 수익률** | ✅ A/B/C/D/F quantile 기반 | B sell1 -28% > C sell1 -4% |
| **ETF/우선주 자동제외** | ✅ 78% 제외 | |
| **GitHub Actions 자동 갱신** | ✅ 평일 17:00 KST | |
| **KIS API 5년치** | ⏳ 키 발급 대기 | 코드 완료 |
| **Web Push 알림** | ⏸️ 미구현 | 다음 작업 |

---

## 🚀 진행 내역 (8/11 ~ 8/21, 10일간)

### 1단계: 기반 구축 (8/11~13)
- **0d94c9d** initial commit: quant invest dashboard
- **dbaaa31** Naver 모바일 API → 데스크톱 HTML 스크래핑 (안티봇 우회)
- **5b09a31** 상세페이지: 수급/기술/회귀 3개 탭 + 기술지표 + 팩터 기여도
- **525edfd** 데이터 자동 갱신 (3,920 종목 + 지수 + 점수)

### 2단계: 7팩터 시스템 (8/13)
- **384487d** 7팩터 확장 (유동성+수급 추가, 80/85)
- **720e79d** 백테스트 7팩터 가중치 + factor_scores에 liquidity/supply 컬럼
- **5470be2** 7팩터 메타 (Sharpe-균형 가중치)
- **bfd9c53** 13개월 시뮬 기반 Sharpe 최적 가중치 (10/25/25/15/15/5/5)
- **d8ef345** 시작 시 top 20만 fetch (1.2MB → 6KB, 모바일 5분 → 0.5초)
- **198fbc6** stock/*.json을 serverless function으로 (588MB deploy throttle 회피)
- **da14a9f** 거래정지 -80, 거래주의 -30, 코스닥 -3
- **a62b756** 1차 vs 2차 회귀분석 비교 차트
- **ecb9565** 20개 UX 보완 (관심종목/비교/급등/신고가/수급/다크/슬라이더/단축키)
- **e61e212** 과적화 정밀 진단 (인샤풀 26%만 OOS 유지)

### 3단계: 매트릭스 시스템 (8/14~18)
- **a8f37ff** 분할 매수/매도 + 매물대 분석 (Volume Profile)
- **2b6e25e** 1차/2차매수 활성 조건 완화 + POC/지지선 가산 점수
- **5249550** 매트릭스 5개 요소 + RSI/MACD/피보나치/이격도
- **95ee176** ADX(추세 강도) + 캔들 패턴(반전 신호) 매트릭스 통합
- **d7db181** OBV/스윙로우하이/Polarity/라운드넘버 4개 매트릭스
- **2c1a8fc** 매트릭스 가산 점수 균등화 + 활성 조건 다중화
- **ab9f626** 종목 상세 모달에 🎯 매트릭스 탭 추가 (12번째)
- **02f61da** 매트릭스 3안 강화 (지지선/라운드 2개 이상 + OBV)
- **8bd95f9** 매트릭스 검증 200개 + 신호 추적 KPI + stock 200개 export
- **7573bfc** 매수/매도가 매트릭스 매입가 기준으로 통일 (웹서칭 검증)

### 4단계: 3페이지 split + PWA (8/18~19)
- **784a3a4** PWA + Service Worker + Chart.js lazy + common.js
- **529ad02** 페이지 3분할 (메인 2탭 + 탐색 6탭 + 분석 7탭)
- **dbbe1a3** 메인 페이지에 💼 10종목 탭 추가 (3탭)
- **c6d211b** 📈 신호 추적 시스템 (1차/2차 매수·매도 실제 수익률 검증)

### 5단계: 등급 시스템 + 시장 평가 (8/19)
- **b494775** 스윙(중단기) 투자 기준으로 매수/매도 가격 재설계
- **5c594c0** ETF 자동제외 + 매트릭스 강화 + 점수 기여도 + KOSDAQ export
- **bfd305f** 매트릭스 점수 누적 막대
- **b032c37** **시장 평가 점수 (CNN Fear & Greed 5지표, 1-100)**
  - 추세 25% + 모멘텀 20% + Breadth 25% + 신고저 15% + 변동성 15%
  - 만점 방지 95 상한
  - 현재 38점 (하락장) → 매트릭스 50점 종목 → 조정 47.6점
- **d4b17b2** KOSDAQ 매트릭스 분석 + 등급 (A/B/C/D/F)
- **a870d7e** 등급별 수익률 + 시장 평가 시계열
- **48131ca** 종목 모달 매트릭스 탭에 시장 반영 점수

### 6단계: 200개 백필 + 자동화 (8/19~21)
- **fd92876** 매트릭스 200개 백필 (KOSPI 442개 × 30일, KOSDAQ 1491개 × 30일)
- **5042333** KOSPI 200 13-factor regression dashboard (Next.js 14)
- **ff75e76** 4개 추가 작업 (screener / factors interactive / signals / sector-neutral)
- **1606b1e** 팩터 crowding 모니터 (HHI + 7팩터 exposure)
- **27b1917** GitHub Actions 자동 갱신 (매트릭스 200 + 등급별 + 시계열)
- **4431965** KIS API 5년치 fetch + Naver 모바일 API User-Agent + KOSPI 5년치 지수

### 7단계: Regime + 가중치 (8/20~21)
- **780c1fe** 외국인 flow regime (3-tier) UI 배지
- **90d8dbc** regime-conditioned 가중치 (risk-on/off/normal)
- **ec503ff** 외국인 flow regime 자동 갱신 (cron)

---

## 📁 핵심 파일 구조

```
quant-invest/
├── public/
│   ├── index.html            (메인 3탭)
│   ├── explore.html          (탐색 6탭)
│   ├── analysis.html         (분석 8탭)
│   ├── js/
│   │   ├── app.js             (메인)
│   │   ├── common.js          (포맷 유틸)
│   │   └── ...
│   └── data/                  (JSON 출력)
├── src/
│   ├── factors/index.js       (7팩터 + calculateAll)
│   ├── data/
│   │   ├── signals.js         (매트릭스 14개 요소)
│   │   ├── market.js          (CNN F&G 시장 평가)
│   │   ├── filters.js         (ETF/우선주 제외)
│   │   └── naver.js           (Naver API)
│   ├── scoring/
│   │   ├── backtest.js
│   │   └── optimizer.js
│   ├── db/connection.js       (DuckDB)
│   └── ...
├── scripts/
│   ├── update.js              (메인 갱신 + export)
│   ├── backfill-signal-performance.js
│   ├── backfill-matrix-200.js (NEW)
│   ├── grade-performance.js   (NEW)
│   ├── market-regime-history.js (NEW)
│   ├── fetch-kis-5y.js        (NEW - KIS API)
│   ├── fetch-kospi200-5y.js
│   └── ...
├── .github/workflows/
│   ├── daily.yml              (평일 17:00 KST 자동 갱신)
│   ├── kis-5y.yml             (NEW - KIS 5년치 수동)
│   ├── realtime.yml
│   └── update-flow-regime.yml
├── docs/
│   ├── KIS-API-GUIDE.md       (NEW)
│   └── HISTORY.md             (이 파일)
└── ...
```

---

## 📈 매트릭스 시스템

### 14개 요소 (signals.js)
1. **MA/정배열** (5/20/60/120) — 골든크로스 +10, 정배열 +10, ma20↑ +5
2. **캔들 패턴** — Bullish Engulfing +10, Hammer +10, Doji -7
3. **ADX** (14) — STRONG UP +7, STRONG DOWN -3
4. **OBV** — UP +5, ma20↑ +7, DOWN -3
5. **스윙 L/H** (lookback=5) — Low 근접 +5, High 돌파 -3
6. **Polarity Flip** (60일) — 지지선↔저항선 변환 +5
7. **라운드 넘버** — 100/1000/5000/10000 단위 +5
8. **ATR** (14) — 동적 손절 (MA20-2×ATR)
9. **BB** (20, 2σ) — 상단/하단 밴드
10. **52주 고저** — 신고가/신저가
11. **RSI** (14) — 과매수/과매도
12. **MACD** + 0선 크로스
13. **피보나치** (60일) — 23.6/38.2/61.8/78.6 되돌림
14. **이격도** — MA20 대비 ±%
15. **매물대** — POC, Value Area, 지지/저항

### 4개 활성 조건 (다중화)
- **1안**: 골든크로스 OR (정배열 + 거래량 + ma20↑)
- **2안**: 강상승 캔들 + ADX STRONG UP + OBV UP
- **3안**: (POC/지지선/라운드 2개 이상) + OBV UP
- **4안**: Polarity + 캔들 + ADX STRONG + OBV UP

### 5개 가격 (스윙 투자 기준)
- **2차매수** = MA60 (눌림목)
- **1차매수** = MA20 (추세 진입)
- **현재가** = 실시간
- **1차매도** = min(MA20×1.15, BB상단, 52주고가-3%) + MA20+10% floor
- **2차매도** = min(MA20×1.30, 52주고가-1%) + MA20+20% floor
- **손절** = max(MA20-10%, MA20-2×ATR)

### 등급 (A/B/C/D/F, quantile 기반)
- A: p90+ (90분위 이상)
- B: p70+
- C: p40+
- D: p20+
- F: <p20

---

## 📊 시장 평가 점수 (CNN F&G 5지표)

| 지표 | 가중치 | 설명 |
|---|---:|---|
| 추세 (Trend) | 25% | KOSPI > MA60 > MA120 정배열 강도 + 이격도 |
| 모멘텀 (Momentum) | 20% | KOSPI 5d/20d 변화율 |
| Breadth | 25% | 전 종목 MA20/MA60 위 비율 |
| 신고가/신저가 | 15% | 52주 신고가 - 신저가 비율 |
| 변동성 (Volatility) | 15% | KOSPI 20d 변동성 (낮을수록 좋음) |

**점수 매핑**: 80+ 강한상승 / 60+ 상승 / 40+ 중립 / 20+ 하락 / 0 강한하락  
**매트릭스 반영**: `raw × 0.8 + 시장평가 × 0.2` (0~100 클램프)

---

## 🔄 자동 갱신 흐름

```
매일 평일 17:00 KST (08:00 UTC)
  ↓
.github/workflows/daily.yml
  ↓
npm run update (scripts/update.js)
  ↓
1. 종목 목록 갱신
2. 일봉 (증분)
3. 7팩터 점수 계산
4. exportStatic():
   - TOP 20 (top.json, 6KB)
   - 신호 추적 백필 (signal-performance*.json)
   - 시장 평가 (market-regime.json)
   - 시장 평가 시계열 (market-regime-history.json)
   - 등급별 수익률 (grade-performance.json)
   - 매트릭스 200 백필 (matrix-backfill-200*.json)
   - 분포/상관/포트폴리오/최적화 등
  ↓
변경 시 자동 commit + push
  ↓
Vercel 자동 deploy
```

---

## 📱 페이지 구조

### 메인 (index.html) - 3탭
- **🏆 TOP 20** — 7팩터 점수 상위 20개 + 시장 평가 카드
- **⭐ 관심종목** — localStorage
- **💼 10종목** — 동적 포트폴리오

### 탐색 (explore.html) - 6탭
- **🚀 급등/급락** — 등락률
- **📈 신고/신저** — 52주 신고저
- **🟥 히트맵** — 섹터별 색상
- **📈 전체** — 정렬/필터
- **🏷️ 섹터** — 섹터별 통계
- **💰 수급** — 외국인/기관 매매동향

### 분석 (analysis.html) - 8탭
- **📊 분포** — 점수 분포 + 등급 도넛
- **🔗 상관** — 7팩터 상관관계
- **🎯 최적화** — 회귀/그리드 가중치
- **⏪ 백테스트** — Sharpe/MDD
- **💼 10종목** — 동적 포트폴리오
- **🔍 분석 진단** — K-fold + Bootstrap + Regime
- **📈 신호 추적** — 1차/2차 매수·매도 + **🎯 매트릭스 분석** (KOSPI/KOSDAQ 토글 + 등급별 수익률 + 시장 반영 점수)
- **📋 로그** — 갱신 이력

### 종목 상세 모달 (12번째 매트릭스 탭)
- 5개 가격 매트릭스
- 매트릭스 5개 요소 후보
- 14개 보조지표
- 신호 점수 + 점수 기여도 + 누적 막대
- **시장 반영 점수** (NEW)

---

## 🛠️ 기술 스택

- **Backend**: Node.js 24, DuckDB (WAL lock 회피: DUCKDB_READ_ONLY=1)
- **Frontend**: HTML/JS, Bootstrap 5.3, Alpine.js 3.14, Chart.js 4 (lazy load)
- **Data**: Naver Finance (desktop HTML), Yahoo Finance, KIS API
- **Deploy**: Vercel (cleanUrls, serverless functions)
- **CI/CD**: GitHub Actions (평일 17:00 KST)
- **PWA**: manifest.json, Service Worker (offline + cache)

---

## 🔑 사용자 작업 (미완료)

### KIS API 키 발급
1. https://apiportal.koreainvestment.com 에서 모의투자 앱 등록
2. APP KEY/SECRET 발급
3. `.env`에 추가 또는 GitHub Secrets 등록
4. `node scripts/fetch-kis-5y.js` 또는 GitHub Actions 수동 실행

자세한 가이드: [docs/KIS-API-GUIDE.md](KIS-API-GUIDE.md)

---

## 📅 다음 작업 후보

1. **Web Push 알림** 📱 — Service Worker 푸시 + Notification API
2. **KIS API 5년치 fetch** (위 가이드 따라)
3. **매트릭스 분석 페이지 강화** — 시계열 + 추천 종목
4. **한투 KIS API 실전 키 발급** (모의 → 실전)
5. **DART API 재무제표** — ROE/매출액/부채비율 추가
6. **외인/기관 순매수 실시간** — Naver API 폐쇄 우회
