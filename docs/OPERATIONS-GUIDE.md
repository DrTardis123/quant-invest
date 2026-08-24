# 퀀트투자 운영 가이드

> **"신호는 시스템이, 매매는 사람이."**

## 📌 시스템 핵심 원칙

1. **자동**: 데이터 수집, 신호 계산, 알림
2. **사람**: 매수/매도 실행, 포지션 사이징, 손절/익절
3. **검증**: 모든 신호는 과거 데이터로 backtest 후 노출
4. **보수**: in-sample overfit 방지를 위해 walk-forward CV 결과 사용

---

## 🌅 일일 루틴 (10분)

### 1. 대시보드 확인 (5분)
- https://tardisquantinvest.vercel.app
- 메인 페이지 (index.html) 진입
- 확인 사항:
  - ⭐ 매트릭스 점수 상위 10종목
  - 📊 시장 평가 점수 (CNN F&G 5지표)
  - 🔥 활성 신호 (1차매수 / 2차매수 / 1차매도 / 2차매도)
  - 📈 KOSPI/KOSDAQ 당일 동향

### 2. 신호 분석 (3분)
- **1차매수 🟢** 종목 = 메인 매수 후보
  - 매트릭스 점수 60+ + 매수 조건 4개 중 1개 이상 활성
- **2차매수 🟡** = 눌림목 매수 (이미 1차 보유시 추가 매수)
- **1차매도 🔵** = 손절 신호 (즉시 매도 검토)
- **2차매도 🟢** = 익절 신호 (1차 매도 후 추가 상승시)

### 3. 매매 결정 (2분)
- 신호만으로 매매 ❌ → 본인 판단 추가
- 체크리스트:
  - [ ] 매트릭스 점수 60+?
  - [ ] 손익비 1:3 이상? (손절 -7%, 익절 +21%)
  - [ ] 매수 이유 3개 이상?
  - [ ] 시장 평가 30+ (공포 < 중립)?
  - [ ] 이미 5종목 이상 보유 중 아닌지?

---

## 🔔 알림 설정

### GitHub Actions Slack/이메일
- `.github/workflows/daily.yml` 자동 알림
- 일일 갱신 / 신호 생성 / 5년치 갱신 모두 알림

### 수동 알림 (텔레그램/슬랙 봇)
- `scripts/daily-signals.js` 결과 → 웹훅 (TBD)

---

## 📊 주요 파일 위치

### 일일 신호 (자동 갱신)
- `public/data/signals.json` - 당일 매수/매도 신호
- `public/data/signal-performance.json` - 신호 추적 (1차매수 후 +10d 수익률)
- `public/data/market-regime.json` - 시장 평가 (CNN F&G)

### 대시보드
- `public/index.html` - 메인 (메인/포트폴리오/신호/매매 4탭)
- `public/analysis.html` - 분석 (분포/상관/회귀/매트릭스/백테스트)
- `public/explore.html` - 탐색 (급등락/히트맵/섹터/수급)

### 백테스트 결과
- `docs/CV-30-SUMMARY.md` - 5-fold walk-forward CV (가장 신뢰)
- `docs/ALPHA-30-IC.md` - 30 알파 IC 분석
- `docs/BACKTEST-ALPHA-3Y.md` - 3년 OOS 백테스트
- `docs/QUANT-IMPROVEMENTS-SUMMARY.md` - 개선 작업 요약

### 운영 스크립트
- `scripts/update.js` - 메인 갱신
- `scripts/daily-signals.js` - [신규] 일일 신호 생성
- `scripts/stop-alert.js` - [신규] 손절/익절 알림
- `scripts/daily-report.js` - [신규] 일일 리포트

---

## 🎯 매매 신호 해석

### 매트릭스 점수
| 점수 | 등급 | 의미 | 행동 |
|---|---|---|---|
| 80+ | A | 강한 매수 신호 | 적극 매수 검토 |
| 60-80 | B | 매수 신호 | 분할 매수 (1차) |
| 40-60 | C | 중립 | 관망 |
| 20-40 | D | 매도 신호 | 매도 검토 (손절) |
| 0-20 | F | 강한 매도 | 즉시 매도 (손절) |

### 1차매수 조건 (4개 중 1개)
1. **골든크로스**: 5일선 > 20일선 > 60일선 (정배열)
2. **눌림목**: 20일선 지지 후 반등
3. **지지선**: 볼린저밴드 하단 or 52주 저점
4. **구조적**: 거래량 증가 + 거래대금 5억+

### 2차매수 조건
- 1차매수 종목이 눌림 (5-10% 조정)
- 60일선 지지 확인

### 1차매도 (손절)
- 매입가 -7% 도달
- OR 매트릭스 점수 20 이하로 하락
- OR 거래량 급감 + 거래대금 1억 미만

### 2차매도 (익절)
- 1차매도가 진입 후 +5~10% 추가 상승
- OR 매트릭스 점수 80+ 유지 어려움
- OR 거래량 피크아웃 (고점 신호)

---

## 📅 주간/월간 리뷰

### 매주 일요일 (30분)
- `scripts/weekly-report.js` 실행 (또는 cron 자동)
- `docs/WEEKLY-*.md` 확인
- 보유 종목 손익 정리
- 다음 주 매매 계획

### 매월 1일 (1시간)
- `scripts/monthly-report.js` 실행
- 신호 hit rate (1차매수 후 +10d 평균 수익률)
- 잘못된 신호 분석 (false positive)
- 알파 가중치 재평가

---

## 🔧 문제 해결

### 데이터 누락
```bash
# 1일 갱신
$env:EXPORT_ONLY = '1'
node scripts/update.js

# 5년치 1회성
node scripts/fetch-kis-5y.js
```

### DuckDB lock
```bash
$env:DUCKDB_READ_ONLY = '1'  # 읽기 전용 (자식 process도 적용)
```

### GitHub Actions 실패
- Settings → Actions → 실패한 워크플로우 → Re-run jobs
- 또는 .github/workflows/daily.yml 수동 실행

### 자세한 내용은 [ALERT-RUNBOOK.md](./ALERT-RUNBOOK.md) 참조

---

## 📞 연락 / 참고

- GitHub: https://github.com/DrTardis123/quant-invest
- Vercel: https://tardisquantinvest.vercel.app
- 일일 cron: 16:30 KST (GitHub Actions)
- 알림: GitHub Issues / Slack (설정시)
