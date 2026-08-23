# KIS 실전투자 API 키 발급 가이드

## 왜 필요한가?

| 구분 | 모의투자 (현재) | 실전투자 |
|---|---|---|
| **호출 한도** | 200건/일 | 5,000건/일 |
| **3,921종목 5년치 fetch** | 13.5일 (200×30) | **1~2일** |
| **증분 cron (매일)** | 200종목만 가능 | 3,921종목 전부 가능 |
| **데이터** | 가상 시세 | **실전 시세** |

## 발급 절차 (한국투자증권)

### 1단계: 한국투자증권 계좌 개설
- https://www.truefriend.com 또는 모바일 앱
- 계좌 + OTP 등록 필수

### 2단계: API 포털 가입
- https://apiportal.koreainvestment.com 접속
- 한국투자증권 ID/PW로 로그인 (증권 계정과 동일)

### 3단계: 앱 등록
1. 좌측 메뉴 "앱 관리" → "앱 등록"
2. 앱 정보 입력:
   - 앱 이름: `tardis-quant-invest` (자유)
   - 사용 목적: `자동매매/데이터수집`
   - API 종류: **실전투자** 체크
   - IP 제한: `0.0.0.0/0` (Vercel/GitHub Actions IP 동적) 또는 본인 IP

### 4단계: 키 발급
- 등록 완료 후 **App Key** + **App Secret** 받음
- **두 키 모두 안전하게 보관** (절대 GitHub에 커밋 금지)

### 5단계: .env 파일 업데이트

`C:\Users\LG\Documents\quant_invest\.env`:
```bash
# 기존 모의투자
KIS_APP_KEY=your_paper_key_here
KIS_APP_SECRET=your_paper_secret_here
KIS_IS_PAPER=true
KIS_ACCT_NO=your_paper_acct_no

# 실전투자 (추가)
KIS_LIVE_APP_KEY=your_live_key_here
KIS_LIVE_APP_SECRET=your_live_secret_here
KIS_LIVE_ACCT_NO=your_live_acct_no
```

### 6단계: 코드 수정

`src/data/kis.js`의 baseUrl 변경:
```js
const baseUrl = process.env.KIS_IS_PAPER === 'true'
  ? 'https://openapivts.koreainvestment.com:29443'  // 모의
  : 'https://openapi.koreainvestment.com:9443';      // 실전
```

## 5년치 일봉 fetch 절차 (실전 키 발급 후)

### 1) 1회성 전체 fetch (배경 작업)

```powershell
cd C:\Users\LG\Documents\quant_invest
$env:KIS_IS_PAPER='false'
$env:NODE_OPTIONS='--max-old-space-size=8192'
node scripts/fetch-kis-5y.js
```

**예상 시간**: 1,355개 × 13페이지 × 0.3초/요청 = **1.5~2시간** (rate limit 적용)

### 2) 매일 증분 fetch (cron)

기존 daily.yml의 KIS step 변경:
```yaml
- name: KIS 일봉 증분 fetch
  run: |
    $env:KIS_IS_PAPER='false'
    $env:INCREMENTAL='true'
    $env:CONCURRENCY='5'  # 실전은 더 빠름
    node scripts/fetch-kis-5y.js
  env:
    KIS_LIVE_APP_KEY: ${{ secrets.KIS_LIVE_APP_KEY }}
    KIS_LIVE_APP_SECRET: ${{ secrets.KIS_LIVE_APP_SECRET }}
    KIS_LIVE_ACCT_NO: ${{ secrets.KIS_LIVE_ACCT_NO }}
```

**GitHub Secrets 추가**:
- Settings → Secrets and variables → Actions
- `KIS_LIVE_APP_KEY`, `KIS_LIVE_APP_SECRET`, `KIS_LIVE_ACCT_NO` 추가

## 비용/주의사항

### ⚠️ 절대 주의
1. **API 키 GitHub 커밋 금지** (`.env`는 `.gitignore`에 포함됨 확인)
2. **Rate limit**: 분당 20건 / 초당 5건 (실전 동일)
3. **IP 제한**: 특정 IP만 허용하면 Vercel/GitHub Actions IP가 동적이라 막힐 수 있음
4. **계좌 잔고**: 실전 API 호출 자체로 매매는 안 됨 (조회만), 잔고 0이어도 OK

### 실전 키 발급 후 기대 효과
| 작업 | 모의 (현재) | 실전 (예상) |
|---|---|---|
| 1,355개 일봉 (1년치) | 8.3h | 1.5h |
| 3,921개 일봉 (5년치) | 30h+ | **3~4h** |
| 매일 cron (3,921종목 증분) | 200건 한도 → 일부 누락 | **전부 30분 내** |
| 상장폐지 종목 | KRX 봇 차단 | **KIS는 폐지 종목도 가능** (별도 API) |

## 실전 키 발급 후 다음 작업

1. **`scripts/fetch-kis-5y.js`**: `INCREMENTAL` 모드로 매일 cron 안정화
2. **상장폐지 종목 보강**: KIS의 폐지 종목 코드 (별도 endpoint) 활용 → 생존편향 제거
3. **1,355 → 3,921 유니버스 확장**: 분석 범위 3배 → 더 robust한 IC
4. **Deflated Sharpe Ratio 재계산**: 3,921종목 × 1,222일 → DSR p-value 의미있는 수준

## 발급에 도움되는 자료

- 공식 문서: https://apiportal.koreainvestment.com → "개발 가이드"
- GitHub 예제: https://github.com/koreainvestment/open-trading-api
- 한국투자증권 고객센터: 1544-5000
