# KOSPI 200 Factor Dashboard

KOSPI 200 (199 종목) 13팩터 (가격 5 + 펀더멘털 8) 회귀분석 + 백테스트 결과를 보여주는 정적 대시보드.

## 페이지

| 경로 | 설명 |
|---|---|
| `/` | 홈 — 요약, 1차 vs 2차 비교, 13팩터 평균 가중치 |
| `/stocks` | 199개 종목 리스트 (펀더멘털 테이블) |
| `/stocks/[ticker]` | 종목 상세 (펀더멘털 z-score, 가격 차트, 팩터 시계열) — SSG 199개 |
| `/factors` | 13팩터 가중치 + 안정성 + 월별 β 시계열 차트 |
| `/backtest` | Train/test 비교, 4종 overfit 진단 (T1-T4) |
| `/signals` | 일별 시그널 (placeholder, 데이터 파이프라인 가이드) |

## 스택

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS (다크 테마)
- Recharts (차트)
- 정적 데이터 (JSON) — SSG로 빌드 시 페이지 미리 생성

## 실행

```bash
# 의존성 설치
npm install

# 데이터 변환 (CSV → JSON) — kospi-factor/의 CSV를 읽어서 data/에 JSON 생성
npm run convert-data

# 개발 서버
npm run dev
# → http://localhost:3000

# 프로덕션 빌드 + 시작
npm run build
npm start
```

## 데이터 흐름

```
kospi-factor/*.csv.gz, *.csv, *.json
  ↓ scripts/convert-csv.mjs (CSV → JSON, 압축 해제, 정제)
data/*.json (~1.7 MB)
  ↓ Next.js SSG (빌드 시점에 한 번 로드)
정적 HTML 페이지 × ~210개
```

## 정적 페이지 수

- `/`, `/stocks`, `/factors`, `/backtest`, `/signals` = 5개
- `/stocks/[ticker]` = 199개 (KOSPI 200)
- **합계 ~204개 정적 페이지**
- 빌드 시간: ~30-60초
- HTML 총합: ~5-10MB
- Vercel Hobby 무료 플랜 OK

## Vercel 배포

```bash
# Vercel CLI 설치
npm i -g vercel

# 첫 배포 (대화형)
vercel

# 이후
vercel --prod
```

또는 GitHub 연동:
1. GitHub repo push
2. vercel.com → New Project → Import repo
3. 자동 빌드/배포

## 데이터 갱신 (regression 재실행 후)

1. `kospi-factor/` 에서 Python 분석 재실행
2. `npm run convert-data` — 최신 CSV → JSON
3. `npm run build` — 새 데이터로 정적 페이지 재생성
4. `vercel --prod` — 배포

## Signals 페이지 활성화 (선택)

상한가/외국인/거래대금 등 일별 시그널을 라이브로 보여주려면:

1. `scripts/fetch-signals.mjs` 작성 (Naver Finance polling API)
2. GitHub Actions cron (매일 09:00 KST) → `data/signals.json` 커밋
3. `/signals` 페이지에서 JSON fetch + 테이블 렌더
4. Vercel은 자동 rebuild

## 한계 (대시보드 외 모델 한계)

- 펀더멘털 8팩터는 현재(2025Q3) 스냅샷을 과거에도 동일 적용 — 일부 look-ahead bias
- 단일월 cross-section R² ≈ 0, top 30 selection이 amplifying
- 2023-25 test는 강세장 효과 — regime-dependent

자세한 분석은 `kospi-factor/round2_summary.json` 참조.
