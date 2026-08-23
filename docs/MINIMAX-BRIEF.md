# 미니맥스 작업 지시서 — 퀀트 데이터 기반 구축

> 작성: 2026-08-23
> 배경 문서: `docs/BACKTEST-ALPHA-3Y.md` (버그 검증 및 수정 내역)
> 이 문서 하나만 읽고도 작업 가능하도록 자족적으로 씀

---

## 0. 지금 상황 요약

알파 8개 + 가중치 최적화 백테스트를 검증한 결과, 코드 버그 9개를 수정한 뒤
**수확 가능한 신호가 없다**는 결론이 나왔다. 다만 정확한 표현은 "신호가 없다"가 아니라
**"있는지 없는지 판정할 데이터가 안 된다"** 이다.

측정된 근거:

| 항목 | 현재 |
|---|---|
| 롱숏(상하위 20%) 8개 알파 전부 | t값 -1.48 ~ -0.06, **t=2 넘는 것 0개** |
| 롱온리 Top 3~30 벤치마크 대비 초과 | 최고 +0.5%p, t=0.07 (사실상 0) |
| 5년 비중첩 매매 | **62회** |
| 탐지 가능한 최소 Sharpe (95%) | **0.88** — 관측 Sharpe 0.1~0.6은 한계 아래 |
| 5년 이력 종목 | **87개** (전체 3,921개 중 2.2%) |
| 유동성 필터 후 | 평균 **35종목** (거래대금 중앙값 2.27억) |
| 상장폐지 종목 | **0개** (생존편향) |
| `factor_scores` 이력 | **1일치 스냅샷만** (3,779종목 × 1일) |

즉 병목은 알파나 가중치가 아니라 **데이터의 폭·깊이**다.

---

## 1. 먼저: 하지 말 것

콜드 스타트로 이 문서를 받았다면 아래는 **하지 마라**. 이미 해봤고 안 되는 것들이다.

1. **가중치 재최적화 금지**
   walk-forward 3개 fold에서 전부 벤치마크에 졌고, Deflated Sharpe 26.3%다.
   귀무가설 하 기대 최대 Sharpe(1.00)가 실제 탐색 최대(0.72)보다 높다.
   즉 노이즈에서 무작위로 뽑아도 이보다 잘 나온다. 더 정교한 최적화는 과적합만 심화시킨다.

2. **WorldQuant 101 알파 추가 투입 금지**
   지금 8개도 롱숏 t값이 전부 2 미만이다. 유니버스 35종목에서 알파를 늘리면
   다중비교 문제만 커진다. 유니버스부터 넓히고 나서 할 일이다.

3. **`scratch/lib/alpha-engine.js`를 우회해 알파 SQL을 각 스크립트로 복사 금지**
   원래 버그(a_041의 vwap 오류, NaN 0.5 치환, tie-break 없음)가 4개 파일에
   똑같이 퍼져 있던 이유가 복붙이었다. 알파 정의 수정은 **엔진 한 곳에서만** 한다.

4. **`daily_prices` 스키마 변경 금지**
   `code, date, open, high, low, close, volume, trading_value, market_cap` 그대로 쓴다.
   기존 파이프라인(`scripts/update.js`, `src/factors/index.js`)이 의존한다.

5. **비선형 모델(랜덤포레스트 등) 금지** — 표본 62개에서는 의미 없다.

---

## 2. T1 (최우선) — KRX 전종목 일별시세 5년치 수집

### 왜 이게 1순위인가

유니버스 87종목과 생존편향, 두 문제를 **한 번에** 해결한다.
그리고 기존 수집 경로는 둘 다 막혀 있다:

- **Naver 일봉**: 데스크톱 페이지네이션이 **30페이지(300일) cap**.
  `scripts/fetch-naver-5y.js:20`에 `Math.min(30, ...)`로 박혀 있다.
  이래서 3,584종목이 250~499일에 머물러 있다. 5년치는 원천적으로 불가.
- **KIS 모의투자 API**: `docs/KIS-API-GUIDE.md`에 따르면 **200건/일** 한도.
  종목당 13페이지 필요 → 하루 15종목. 이래서 87종목에서 멈췄다.

### 권장 경로: KRX 정보데이터시스템 (data.krx.co.kr)

**핵심 이점: 날짜 1건 호출 = 그 날짜의 전 종목 시세.**
종목별 루프가 아니라 날짜별 루프이므로 5년 = 약 1,222회 호출로 끝난다.
(종목별 방식이면 3,900종목 × 13페이지 = 50,700회)

그리고 **상장폐지 종목이 자동으로 포함된다.** 과거 날짜를 조회하면 그 시점에
상장돼 있던 종목이 전부 나오기 때문이다. 생존편향이 구조적으로 해결된다.

```
POST http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd
Content-Type: application/x-www-form-urlencoded
Referer: http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd
User-Agent: (일반 브라우저 UA)

body:
  bld=dbms/MDC/STAT/standard/MDCSTAT01501
  mktId=ALL
  trdDd=YYYYMMDD
  share=1
  money=1
```

응답은 `OutBlock_1` 배열이고, 항목별로 대략 아래 필드를 갖는다
(**정확한 필드명은 응답 1건을 그대로 찍어서 반드시 먼저 확인할 것** — 아래는 예상값):

| 예상 필드 | 의미 | → daily_prices |
|---|---|---|
| `ISU_SRT_CD` | 단축코드 6자리 | `code` |
| `ISU_ABBRV` | 종목명 | `stocks.name` |
| `TDD_OPNPRC` / `TDD_HGPRC` / `TDD_LWPRC` / `TDD_CLSPRC` | 시/고/저/종 | `open/high/low/close` |
| `ACC_TRDVOL` | 거래량 | `volume` |
| `ACC_TRDVAL` | 거래대금 | `trading_value` |
| `MKTCAP` | 시가총액 | `market_cap` |
| `MKT_NM` | KOSPI/KOSDAQ | `stocks.market` |

주의사항:
- 숫자에 콤마가 들어있다 → `Number(String(v).replace(/,/g,''))`
- 휴장일은 빈 배열이 온다 → 스킵
- 호출 간 **200~300ms 지연**을 넣어라. 과속하면 차단된다
- 우선주/ETF/ETN/스팩은 `src/factors`의 `isExcludedProduct()`로 거를 수 있으나,
  **저장 단계에서 거르지 마라.** 일단 전부 저장하고 분석 단계에서 필터링한다
- 중단·재개가 가능해야 한다. 이미 받은 날짜는 건너뛰도록 `daily_prices`에
  해당 `trdDd`의 행이 있는지 먼저 확인
- upsert는 기존 방식 그대로:
  `INSERT ... ON CONFLICT (code, date) DO UPDATE SET ...`

### 신규 파일

`scripts/fetch-krx-daily.js` 로 새로 만들어라. 기존 fetch 스크립트는 건드리지 마라.

```bash
# 사용 예 (인자 설계는 자유, 다만 재개 가능해야 함)
node scripts/fetch-krx-daily.js --from 2021-08-01 --to 2026-08-22
```

### T1 완료 기준 (숫자로 검증)

```sql
-- ① 5년 이력 종목 수: 87 → 800 이상
SELECT COUNT(*) FROM (
  SELECT code FROM daily_prices WHERE date >= '2021-08-22'
  GROUP BY code HAVING COUNT(*) >= 1000);

-- ② 전체 행 수: 1,201,106 → 3,000,000 이상
SELECT COUNT(*) FROM daily_prices;

-- ③ 상장폐지 종목이 실제로 들어왔는가 (0이면 T1 실패)
SELECT COUNT(*) FROM (
  SELECT code, MAX(date) mx FROM daily_prices GROUP BY code
) WHERE mx < DATE '2026-06-01';

-- ④ trading_value 결측률이 5% 미만인가
SELECT SUM(CASE WHEN trading_value IS NULL OR trading_value <= 0 THEN 1 ELSE 0 END)
       * 100.0 / COUNT(*) FROM daily_prices WHERE date >= '2021-08-22';
```

**③이 0이면 상장폐지 종목이 안 들어온 것이고, 생존편향이 그대로다. 반드시 확인하라.**

### 대안 경로 (KRX가 막힐 경우)

- **KIS 실전계좌 키로 전환** — 모의투자보다 한도가 훨씬 크다.
  정확한 한도는 KIS Developers 포털에서 직접 확인할 것. `src/data/kis.js`의
  endpoint만 실전(`openapi.koreainvestment.com:9443`)으로 바꾸면 된다
- **pykrx / FinanceDataReader (Python)** — Node 프로젝트지만 수집만 Python으로
  하고 CSV로 떨궈 DuckDB에 `read_csv_auto`로 넣어도 된다. 수집은 1회성이므로
  언어 통일보다 속도가 중요하다

---

## 3. T2 — 수집 후 재검증 (T1 끝나면 바로)

수정된 검증 스크립트가 이미 있다. **새로 만들지 말고 그대로 돌려라.**

```bash
node scratch/is-there-signal.js      # 핵심: 롱숏에 신호가 있는가
node scratch/test-alphas-batch.js    # 알파별 IC + Newey-West t
node scratch/backtest-3y-5y.js       # 기간별 벤치마크 대비
node scratch/optimize-weights.js     # walk-forward
```

이 스크립트들은 **결정론적**이다. 같은 DB면 소수점까지 같은 값이 나온다.
수집 전 기준 체크섬 (`grep -v "총 소요" | md5sum` 앞 12자리):

```
backtest-3y-5y    : 0343b6314514
optimize-weights  : becf5f8fd290
test-alphas-batch : 90a607a87fe5
sim-top3-swing    : bdab0435ca39
```

T1 수행 전에 위 값과 다르게 나오면 **환경이나 DB가 이미 다른 것**이니 먼저 원인을 찾아라.

### 판정 기준

`is-there-signal.js`의 **2번 섹션(롱숏)** 만 보면 된다.

- 상하위 20% 롱숏에서 **t ≥ 2** 가 나오면 → 진짜 종목 선별력이 있다. 그때부터 전략화
- 여전히 |t| < 2 → 이 알파 8개는 폐기. T3로 넘어간다

유니버스가 35 → 300종목이 되면 Grinold 법칙상 정보비율이 약 √(300/35) ≈ **2.9배**
개선될 여지가 있다. 지금 최고 t값이 1.46이므로 이론상 t≈4까지 가능하다.
다만 **생존편향이 제거되면서 성과가 내려가는 효과가 동시에 발생**한다.
두 효과 중 어느 쪽이 큰지는 돌려봐야 안다.

---

## 4. T3 — 팩터 히스토리 구축 (T1·T2 이후)

### 문제

`factor_scores`에 **날짜가 1개뿐이다** (3,779종목 × 1일 스냅샷).
컬럼은 이미 잘 갖춰져 있다:
`value_score, momentum_score, quality_score, volatility_score, growth_score, liquidity_score, supply_score, total_score, rank`

즉 **비가격 팩터(밸류/퀄리티/수급)는 지금 백테스트가 불가능하다.** 과거 시점의
점수가 없기 때문이다.

### 해야 할 일

가격 파생 팩터(`momentum`, `volatility`, `liquidity`)는 `daily_prices`만으로
과거 시점 재계산이 가능하다. **이것부터 하라.** T1이 끝나면 즉시 가능하다.

`value`, `quality`, `growth`는 재무 데이터가 필요한데, 여기서 **가장 중요한 함정**은
**point-in-time(PIT)** 이다. 2022년 백테스트에 2026년에 조회한 재무제표를 쓰면
미래참조가 된다. 반드시 **재무제표 발표일 기준**으로 그 시점에 알 수 있었던
데이터만 써야 한다. PIT 재무 데이터 확보가 어렵다면 **차라리 이 팩터들을 빼라.**
잘못 넣으면 백테스트가 화려해지고 실전은 망한다.

`supply_score`(수급, 외국인·기관 순매수)는 일별 데이터라 PIT 문제가 덜하다.
`scripts/fetch-supply-industry.js`가 이미 있으니 이력 확보 가능성을 먼저 확인하라.

### 권장 순서

1. `momentum` / `volatility` / `liquidity` 이력 재계산 (daily_prices만으로 가능)
2. `supply` 이력 확보 가능한지 조사
3. `value` / `quality` / `growth` 는 **PIT 확보가 확인된 경우에만**

---

## 5. 작업 순서 요약

```
T1  KRX 전종목 5년 일별시세 수집        ← 지금 여기부터
     └ 완료 기준 ①~④ SQL로 검증 (특히 ③ 상장폐지 종목)
T2  scratch/is-there-signal.js 재실행
     └ 롱숏 t ≥ 2 ?  ─ Yes → 전략화 단계로
                      └ No  → T3
T3  가격 파생 팩터 이력 재계산 → 재검증
     └ 그 다음에 PIT 확인된 재무 팩터
```

**가중치 최적화는 T2에서 롱숏 t ≥ 2가 나온 뒤에야 의미가 생긴다.**

---

## 6. 참고 파일

| 파일 | 내용 |
|---|---|
| `scratch/lib/alpha-engine.js` | 알파 계산·랭킹·시뮬·통계 공용 엔진. 수정 내역 9가지 주석 포함 |
| `scratch/is-there-signal.js` | 롱숏 신호 진단 (판정용 핵심) |
| `scratch/verify-vs-benchmark.js` | **수정 전** 버그 로직 보존본. 진단 재현용 |
| `docs/BACKTEST-ALPHA-3Y.md` | 버그 9개 상세 + 수정 후 결과 전문 |
| `docs/KIS-API-GUIDE.md` | KIS 키 발급 및 한도 |
| `src/db/connection.js` | DuckDB 연결. `DUCKDB_READ_ONLY=1` 지원 |
| `src/factors/index.js` | 운영 팩터 계산. `isExcludedProduct()` 여기 있음 |
| `scripts/update.js` | 운영 일일 업데이트 파이프라인 |

### 주의

- `scratch/`는 `.gitignore`에 있어 **git 추적 대상이 아니다.** 되돌릴 수 없으니
  기존 파일 덮어쓰기 전에 사본을 떠라
- DB는 `data/quant.db` 단일 파일이다. **T1 시작 전에 파일 복사로 백업하라**
  (`data/quant.db`도 gitignore 대상이라 git으로 복구 불가)
- 분석 스크립트는 전부 읽기 전용으로 돌려라: `DUCKDB_READ_ONLY=1`
- KIS/기타 API 키는 `.env`에 있고 절대 커밋하지 마라
