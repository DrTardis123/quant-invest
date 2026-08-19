export const dynamic = "force-static";
export const metadata = { title: "Signals · KOSPI 200" };

export default function SignalsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Signals</h1>
        <p className="text-sm text-ink-dim">일별 라이브 시그널 (상한가 / 거래대금 / 외국인 순매수)</p>
      </header>

      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold text-amber-400">⏳ 데이터 파이프라인 미연결</h2>
        <p className="mb-4 text-sm text-ink-dim">
          이 페이지는 정적 placeholder입니다. 일별 시그널을 추가하려면 아래 데이터 소스 중 하나를 선택해
          파이프라인을 구성해야 합니다.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DataSource
            name="Naver Finance 일봉 (polling.finance.naver.com)"
            pros={["무료, API 키 불필요", "상한가/하한가 즉시 확인 가능", "Rate limit 0.3s safe"]}
            cons={["약간의 스크래핑 필요", "Service 약관 주의"]}
            effort="M (1-2시간)"
          />
          <DataSource
            name="KRX 정보데이터시스템 (data.krx.co.kr)"
            pros={["공식 데이터", "전 종목 일봉/수급"]}
            cons={["JavaScript-heavy 페이지, scrap 어려움", "Download 버튼 POST 필요"]}
            effort="L (반나절)"
          />
          <DataSource
            name="OpenDart (opendart.fss.or.kr)"
            pros={["DART 공식, 재무제표"]}
            cons={["API 키 필요 (무료 발급)", "재무제표는 분기별"]}
            effort="S (30분)"
          />
          <DataSource
            name="Vercel Cron + GitHub Actions"
            pros={["매일 자정 자동 갱신", "JSON으로 빌드 시점에 포함 가능"]}
            cons={["Hobby: 일 1회 cron만 무료", "캐시 설정 필요"]}
            effort="S (30분)"
          />
        </div>
      </section>

      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">다음 단계</h2>
        <ol className="ml-5 list-decimal space-y-2 text-sm text-ink-dim">
          <li>데이터 소스 선택 (Naver 추천)</li>
          <li>
            <span className="font-mono text-ink">scripts/fetch-signals.mjs</span> 작성 — 일 1회 실행
          </li>
          <li>
            <span className="font-mono text-ink">data/signals.json</span> 커밋 (GitHub Actions 자동화)
          </li>
          <li>이 페이지에서 <code>fetch(&apos;/data/signals.json&apos;)</code>로 로드 + 테이블 표시</li>
          <li>Vercel Cron으로 매일 09:00 자동 갱신</li>
        </ol>
      </section>

      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">예상 화면 (mockup)</h2>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>종목</th>
                <th>이름</th>
                <th className="text-right">상한가</th>
                <th className="text-right">종가</th>
                <th className="text-right">등락률</th>
                <th className="text-right">거래량</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-ink-faint">
                <td>2026-08-15</td>
                <td>005930</td>
                <td>—</td>
                <td className="num text-right">—</td>
                <td className="num text-right">—</td>
                <td className="num text-right">—</td>
                <td className="num text-right">—</td>
              </tr>
              <tr className="text-ink-faint">
                <td>2026-08-14</td>
                <td>000660</td>
                <td>—</td>
                <td className="num text-right">—</td>
                <td className="num text-right">—</td>
                <td className="num text-right">—</td>
                <td className="num text-right">—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-faint">위 데이터는 placeholder. 실제 데이터 fetch 후 채워짐.</p>
      </section>
    </div>
  );
}

function DataSource({ name, pros, cons, effort }: { name: string; pros: string[]; cons: string[]; effort: string }) {
  return (
    <div className="rounded border border-gray-800 bg-bg-elev p-4">
      <div className="font-mono text-sm text-ink">{name}</div>
      <div className="mt-2 text-xs">
        <div className="up">+ {pros.join(" / ")}</div>
        <div className="down">- {cons.join(" / ")}</div>
        <div className="mt-1 text-ink-faint">작업량: {effort}</div>
      </div>
    </div>
  );
}
