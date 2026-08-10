# 📊 퀀트 투자 대시보드

한국 주식 멀티팩터 퀀트 점수화 + 로컬/클라우드 대시보드.

- **팩터 5종**: 가치 / 모멘텀 / 퀄리티 / 저변동성 / 성장
- **전략 5종**: 밸런스 / 가치 / 성장 / 모멘텀 / 방어 (가중치 즉시 변경)
- **시각화 8개**: TOP 픽, 히트맵, 섹터, 레이더, 상관, 분포, 등급, 백테스트
- **데이터**: 네이버 금융 (무료) 또는 KIS Developers (선택)
- **호스팅**: Vercel + GitHub Actions (로컬 서버 24시간 안 켜도 됨)

## 🚀 빠른 시작 (호스팅 / Vercel)

### 1. GitHub에 코드 올리기

```powershell
# 프로젝트 폴더에서
cd C:\Users\LG\Documents\quant_invest
git init
git add .
git commit -m "initial commit"
git branch -M main

# GitHub에서 빈 repo 만든 후 (https://github.com/new)
git remote add origin https://github.com/Drtardis/quant-invest.git
git push -u origin main
```

### 2. Vercel 연결

1. https://vercel.com 접속 → GitHub 계정으로 가입
2. "Add New Project" → 방금 만든 `quant-invest` repo 선택
3. Framework Preset: **Other** (자동 감지)
4. **Deploy** 클릭 → 1~2분 후 `https://quant-invest-xxx.vercel.app` 생성

### 3. GitHub Actions 로 데이터 갱신 세팅

- 자동으로 평일 17:00 KST 에 실행됨
- 첫 데이터는 **수동으로 1회 트리거** 필요:
  - GitHub repo → **Actions** 탭 → "Daily Data Update" → **Run workflow**
  - 초기 풀백필이므로 30~60분 걸림

### 4. (선택) KIS API 키 추가

더 정확한 데이터를 원하면 KIS API 키 발급:

1. https://apiportal.koreainvestment.com/ → 회원가입 → API 신청
2. GitHub repo → **Settings** → **Secrets and variables** → **Actions** → New repository secret:
   - `KIS_APP_KEY`: 발급받은 앱키
   - `KIS_APP_SECRET`: 발급받은 앱시크릿
3. 다음 Actions 실행 시 자동으로 KIS 모드로 전환

### 5. (선택) 대시보드에서 수동 갱신 버튼 활성화

Vercel에서:
1. Vercel 프로젝트 → **Settings** → **Environment Variables**
2. 추가:
   - `GITHUB_PAT`: GitHub Personal Access Token (생성: https://github.com/settings/tokens, `repo` 권한 필요)
   - `GITHUB_REPO`: `Drtardis/quant-invest`

그러면 우측 상단 "지금 갱신" 버튼이 동작합니다.

---

## 💻 로컬 개발

로컬에서도 같은 대시보드를 쓸 수 있습니다 (Express + DuckDB 풀버전).

```powershell
cd C:\Users\LG\Documents\quant_invest
npm install            # 처음 1회
npm start              # http://localhost:3000
```

**로컬의 장점** (호스팅 버전에는 없는 기능):
- 백테스트 (DuckDB + 과거 점수 이력)
- 수동 갱신 즉시 반영
- 데이터 즉시 갱신 (15:30 장 마감 후 5분 안에 시도 가능)

**자동 시작 등록** (PC 부팅 시 자동 실행):
```powershell
.\install-autostart.bat
```

---

## 📁 프로젝트 구조

```
quant-invest/
├── .github/workflows/daily.yml   # GitHub Actions: 평일 17:00 KST 자동 갱신
├── api/                          # Vercel Functions
│   ├── health.js                 # 상태 확인
│   ├── update.js                 # 수동 갱신 (GitHub Actions 트리거)
│   └── backtest.js               # 호스팅에서는 비활성 (로컬 권장)
├── public/                       # Vercel 정적 파일
│   ├── index.html
│   ├── css/style.css
│   ├── js/                       # 대시보드 로직
│   └── data/                     # GitHub Actions 가 생성하는 JSON
│       ├── strategies-static.json
│       ├── top.json
│       ├── all.json
│       ├── sectors.json
│       ├── heatmap.json
│       ├── correlation.json
│       ├── distribution.json
│       ├── log.json
│       ├── meta.json
│       └── stock/{code}.json     # 종목별 상세
├── scripts/
│   └── update.js                 # 데이터 갱신 스크립트 (GitHub Actions 전용)
├── src/                          # Node.js 백엔드 (로컬 개발용)
│   ├── data/                     # 네이버/KIS 클라이언트
│   ├── factors/                  # 팩터 계산
│   ├── scoring/                  # 등급/섹터/상관/히트맵
│   ├── strategies.js
│   ├── config/
│   ├── db/                       # DuckDB
│   ├── scheduler/                # cron
│   └── server/                   # Express (로컬)
├── tests/
├── vercel.json                   # Vercel 설정 (rewrite)
├── package.json
└── start.bat                     # 로컬 시작 스크립트
```

## ⚙️ 환경 변수

로컬용 (`.env` 파일):
```env
PORT=3000
DATA_SOURCE=naver                # naver | kis
KIS_APP_KEY=...                  # KIS 사용 시
KIS_APP_SECRET=...
UPDATE_HOUR=17
UPDATE_MINUTE=0
```

Vercel 환경변수:
- `GITHUB_PAT` (선택) — 수동 갱신 버튼용
- `GITHUB_REPO` (선택) — `Drtardis/quant-invest` 형식

GitHub Actions Secrets:
- `KIS_APP_KEY` (선택)
- `KIS_APP_SECRET` (선택)

## 🔧 데이터 갱신 흐름

```
GitHub Actions (17:00 KST)
   ↓
네이버 금융 (또는 KIS)
   ↓
DuckDB (메모리 → 파일)
   ↓
팩터 계산
   ↓
JSON 파일 (public/data/*.json)
   ↓
git commit & push
   ↓
Vercel 자동 배포
   ↓
전 세계에서 https://quant-invest.vercel.app 접속
```

## 📊 팩터 정의

| 팩터 | 가중치 | 지표 |
|---|---|---|
| **가치** (Value) | 35% | PER ↓, PBR ↓, PSR ↓ (낮을수록 좋음) |
| **모멘텀** (Momentum) | 20% | 12M - 1M 수익률 (Jegadeesh-Titman) |
| **퀄리티** (Quality) | 20% | ROE ↑, ROA ↑, 부채비율 ↓ |
| **저변동성** (Low Vol) | 15% | 60일 일별수익률 표준편차 ↓ |
| **성장** (Growth) | 10% | 매출 YoY, 순이익 YoY |

전략 프로파일로 가중치를 자유롭게 변경 가능.

## 🛠 기술 스택

- **런타임**: Node.js 20+
- **DB**: DuckDB (컬럼형 OLAP, 분석에 최적)
- **백엔드**: Express (로컬) / Vercel Functions (호스팅)
- **프론트**: Alpine.js + Bootstrap 5 + Chart.js (CDN, 빌드 불필요)
- **스케줄러**: node-cron (로컬) / GitHub Actions (호스팅)
- **데이터**: 네이버 금융 JSON API (무료, 키 불필요) / KIS Open API (선택)

## 📝 라이선스

MIT
