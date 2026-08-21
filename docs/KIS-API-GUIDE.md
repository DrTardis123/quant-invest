# KIS API 키 발급 가이드 (모의투자)

## 1. KIS Developers 포털 가입
- https://apiportal.koreainvestment.com 접속
- "회원가입" → 개인/법인 선택 → 본인인증 (핸드폰 인증)
- 가입 완료 후 로그인

## 2. 앱 등록
- 상단 메뉴: "API 신청" → "앱 등록"
- 앱 정보:
  - 앱명: `퀀트투자`
  - 앱 설명: `KOSPI/KOSDAQ 5년치 일봉 fetch`
  - 사용 API: `국내주식` (REST API)
  - 사용 여부: 모두 체크
- 등록 완료 → **APP KEY** + **APP SECRET** 발급 (한 번만 보임!)

## 3. .env 파일에 추가
프로젝트 루트 (`C:\Users\LG\Documents\quant_invest\.env`) 파일 생성:

```env
# KIS API (모의투자)
KIS_APP_KEY=여기에_APP_KEY_입력
KIS_APP_SECRET=여기에_APP_SECRET_입력
KIS_ACCOUNT_NO=12345678-01
KIS_IS_PAPER=true
```

## 4. GitHub Actions Secrets 등록
- https://github.com/DrTardis123/quant-invest/settings/secrets/actions
- "New repository secret" 클릭
  - Name: `KIS_APP_KEY` → Value: APP KEY
  - Name: `KIS_APP_SECRET` → Value: APP SECRET
  - (선택) `KIS_ACCOUNT_NO` → Value: 계좌번호

## 5. 실행
### 로컬
```bash
cd C:\Users\LG\Documents\quant_invest
node scripts/fetch-kis-5y.js
```

### GitHub Actions
- https://github.com/DrTardis123/quant-invest/actions
- "KIS 5년치 일봉 fetch" → "Run workflow" 클릭
- N: `300`, market: `BOTH` → Run

## 6. KIS API 일봉 endpoint
- **모의투자**: `https://openapivts.koreainvestment.com:29443`
- **실전**: `https://openapi.koreainvestment.com:9443`
- 일봉: `GET /uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
  - tr_id: `FHKST03010100` (모의/실전 동일)
  - 1회 호출 = 최대 100건 (페이지네이션 필요)
  - 5년치 = ~1,260 거래일 = 13페이지

## 7. 주의사항
- 모의투자 키는 일별 호출 한도: 보통 200건/일
- 5년치 300종목 × 13페이지 = 3,900건 → 하루에 다 못 받을 수 있음
- 작은 N(100)부터 시작 권장
- KIS API 키는 **절대 GitHub에 커밋 금지** (.env는 .gitignore에 있음)

## 8. 문제 해결
- "토큰 발급 실패" → APP KEY/SECRET 다시 확인
- "조회 실패" (tr_id 오류) → 모의/실전 endpoint 일치 확인
- "조회 한도 초과" → 다음 날 다시 시도
- 일봉 안 옴 → 해당 종목 상장일 이전
