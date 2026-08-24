# 문제 대응 매뉴얼 (RUNBOOK)

> 시스템 장애 / 데이터 오류 / 신호 이상 발생 시 빠른 대응을 위한 매뉴얼

## 🚨 긴급 연락

- GitHub Issues: https://github.com/DrTardis123/quant-invest/issues
- Vercel 대시보드: https://vercel.com/dashboard
- (선택) KIS API 키 발급: 1544-5000

---

## 1️⃣ GitHub Actions 실패

### 증상
- 이메일: "Workflow failed"
- Slack/Discord webhook 알림
- 1시간 이상 신호 갱신 안됨

### 대응
1. **GitHub → Actions 탭** → 실패한 워크플로우 클릭
2. **Re-run jobs** 버튼 클릭
3. 그래도 실패 → 로그 확인:
   - `npm install` 실패 → `package-lock.json` 갱신 필요
   - `node scripts/...` 실패 → 스크립트 버그 가능성
4. 긴급 시 **workflow_dispatch**로 수동 트리거 (작업 선택)

### 예방
- 30분마다 워크플로우 실행 (GitHub cron 한계)
- 실패시 자동 retry (GitHub Actions 기본 1회)

---

## 2️⃣ DuckDB Lock 오류

### 증상
```
IO Error: Cannot open file "C:\Users\LG\Documents\quant_invest\data\quant.db"
다른 프로세스가 파일을 사용 중
```

### 원인
- 다른 process (HMM, signals 등)가 DB를 점유 중
- `DUCKDB_READ_ONLY` 환경변수 누락

### 대응
```bash
# 1. read_only 모드로 재시도 (자동 fallback)
$env:DUCKDB_READ_ONLY = '1'
node scripts/daily-signals.js

# 2. 다른 process 종료
Get-Process node | Where-Object {$_.CommandLine -like "*quant.db*"} | Stop-Process

# 3. DuckDB lock 확인
# Windows: Handle.exe (sysinternals) 로 lock 보유 process 확인
```

### 예방
- `db.close()` 항상 호출
- 동시에 여러 script 실행하지 않기
- background watcher 종료 후 본 작업 실행

---

## 3️⃣ KIS API Rate Limit

### 증상
- "초당 거래건수 초과" 오류
- "1분당 20건 초과" 오류

### 대응
```bash
# 1. CONCURRENCY 줄이기
CONCURRENCY=1 node scripts/fetch-kis-5y.js

# 2. N 줄이기 (1회 fetch 종목 수)
N=100 node scripts/fetch-kis-5y.js

# 3. INCREMENTAL 모드 (이미 fetch한 종목은 skip)
INCREMENTAL=true N=300 CONCURRENCY=3 node scripts/fetch-kis-5y.js
```

### 예방
- `scripts/fetch-kis-5y.js`에 rate limit retry 로직 (이미 구현됨: 3s/6s/9s 대기)
- 모의투자는 200건/일 한도 → cron은 1일 1회만 실행

---

## 4️⃣ 신호 누락 (당일 신호 파일 없음)

### 증상
- `public/data/signals.json` 파일 없음 또는 오래됨
- 대시보드 "아직 데이터가 없어요. 잠시 후 새로고침 해보세요."

### 진단
```bash
# 1. 파일 존재 확인
ls public/data/signals.json

# 2. 마지막 갱신 시간
cat public/data/signals.json | jq '.updatedAt'

# 3. GitHub Actions 상태
# https://github.com/DrTardis123/quant-invest/actions
```

### 대응
```bash
# 수동 실행
$env:EXPORT_ONLY = '1'
node scripts/daily-signals.js

# 또는 GitHub Actions 수동 트리거
```

---

## 5️⃣ DuckDB 손상

### 증상
- "Database disk image is malformed"
- "IO Error: Could not set lock"

### 대응
```bash
# 1. 백업 확인
ls data/quant.db.backup-*

# 2. 백업에서 복구
cp data/quant.db.backup-YYYY-MM-DD data/quant.db

# 3. 손상 시 5년치 재fetch
mv data/quant.db data/quant.db.corrupt
node scripts/fetch-kis-5y.js  # 8-13시간 소요
```

### 예방
- 일일 cron 전 자동 백업 (`data/quant.db.backup-YYYY-MM-DD`)
- 매주 수동 백업 권장

---

## 6️⃣ Vercel 배포 실패

### 증상
- "Build failed"
- 404 Not Found

### 대응
1. **Vercel 대시보드** → Deployments → 실패한 배포 → Logs 확인
2. 일반적 원인:
   - 588MB stock/* 한도 초과 → .vercelignore 확인
   - Anti-bot 챌린지 → GitHub raw URL 사용
3. **Rollback**: 이전 successful deployment 선택 → "Promote to Production"

### 예방
- .vercelignore에 public/data/stock/* 추가
- Anti-bot 방지: GitHub raw.githubusercontent.com URL 사용

---

## 7️⃣ 신호 이상 (잘못된 매수/매도 추천)

### 증상
- 매트릭스 A 등급인데 실제 차트 보면 하락세
- 신호가 너무 많거나 적음

### 진단
```bash
# 1. 매트릭스 계산 검증
node -e "
  const sig = require('./src/data/signals');
  sig.calculateMatrix('005930').then(m => console.log(m));
"

# 2. 알파 가중치 확인
node -e "
  const e = require('./scratch/lib/alpha-engine');
  console.log(e.weights);
"

# 3. 시장 평가 확인
cat public/data/market-regime.json
```

### 대응
- 시장 평가가 극단 (공포<30, 탐욕>70) → 신호 신뢰도 ↓
- 5-fold CV 결과 다시 확인 (`docs/CV-30-SUMMARY.md`)
- 카테고리 best 가중치가 in-sample overfit → 균등 가중치로 fallback

### 예방
- 정기적 backtest 재실행 (월 1회)
- 신호 hit rate 모니터링 (`signal-performance.json`)

---

## 8️⃣ KIS API 키 문제

### 증상
- "Invalid token"
- "권한 없음"

### 대응
1. `.env` 확인:
   ```
   KIS_APP_KEY=...
   KIS_APP_SECRET=...
   KIS_ACCOUNT_NO=...
   KIS_IS_PAPER=true
   ```
2. 모의투자: https://openapivts.koreainvestment.com
3. 실전: https://openapi.koreainvestment.com
4. API 키 재발급: apiportal → 앱 관리 → 키 재발급

---

## 📞 주요 명령어 요약

```powershell
# 1. 일일 갱신 (수동)
$env:EXPORT_ONLY = '1'
node scripts/update.js

# 2. 일일 신호 (수동)
node scripts/daily-signals.js

# 3. 손절/익절 알림 (수동)
node scripts/stop-alert.js

# 4. 일일 리포트 (수동)
node scripts/daily-report.js

# 5. DuckDB 백업
$today = Get-Date -Format "yyyy-MM-dd"
Copy-Item data/quant.db "data/quant.db.backup-$today"

# 6. GitHub Actions 수동 트리거
# https://github.com/DrTardis123/quant-invest/actions → Run workflow

# 7. 로컬 서버 (테스트)
node -e "..."  # scripts/deploy-test.js
```

---

## 🛡️ 정기 점검 일정

### 매일
- [ ] GitHub Actions cron 성공 확인 (이메일/슬랙)
- [ ] 신호 갱신 (signals.json updatedAt)
- [ ] Vercel 자동 배포 확인

### 매주 (일요일)
- [ ] weekly-report.js 실행
- [ ] 보유 종목 손익 정리
- [ ] DuckDB 백업 (`data/quant.db.backup-YYYY-MM-DD`)

### 매월 1일
- [ ] 신호 hit rate 분석 (signal-performance.json)
- [ ] 잘못된 신호 (false positive) 검토
- [ ] 5-fold CV 재실행
- [ ] 카테고리 best 알파 변경 확인
- [ ] Vercel 사용량 확인 (588MB 한도)

### 분기별
- [ ] 5년치 일봉 재fetch (KIS API 검증)
- [ ] KIS API 키 갱신
- [ ] 알파 가중치 재최적화 (regime 변화 반영)
