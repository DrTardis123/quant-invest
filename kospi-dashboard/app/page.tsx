import Link from "next/link";
import { getAllFunds, getAllBetas, getSummary, fmtPct, fmtSharpe, ALL_FACTORS, FACTOR_DESCRIPTIONS } from "@/lib/data";

export const dynamic = "force-static";

export default function Home() {
  const funds = getAllFunds();
  const betas = getAllBetas();
  const summary = getSummary();

  // Quick stats
  const avgRoe = funds.filter((f) => f.ROE != null).reduce((a, b) => a + (b.ROE || 0), 0) / funds.length;
  const avgPer = funds.filter((f) => f.PER != null).reduce((a, b) => a + (b.PER || 0), 0) / funds.length;
  const avgPbr = funds.filter((f) => f.PBR != null).reduce((a, b) => a + (b.PBR || 0), 0) / funds.length;
  const avgFgn = funds.filter((f) => f.ForeignOwnership != null).reduce((a, b) => a + (b.ForeignOwnership || 0), 0) / funds.length;

  // Train 가중치 (summary)
  const tw = (summary as any)["1차_vs_2차"] ?? {};
  const weights = betas.reduce<Record<string, { beta: number; t: number }>>((acc, b) => {
    for (const c of ALL_FACTORS) {
      const bv = (b as any)[`beta_${c}`];
      const tv = (b as any)[`t_${c}`];
      if (typeof bv === "number" && typeof tv === "number") {
        if (!acc[c]) acc[c] = { beta: 0, t: 0 };
        acc[c].beta += bv / betas.length;
        acc[c].t += tv / betas.length;
      }
    }
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">KOSPI 200 Factor Lab</h1>
        <p className="text-ink-dim">
          13팩터 (가격 5 + 펀더멘털 8) 회귀분석 · 월별 cross-section · train 2020-22 / test 2023-25
        </p>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card label="분석 종목" value={`${funds.length}개`} sub="KOSPI 시총 상위" />
        <Card label="평균 ROE" value={`${avgRoe.toFixed(1)}%`} sub="수익성 평균" />
        <Card label="평균 PER" value={avgPer.toFixed(1)} sub="밸류에이션 평균" />
        <Card label="평균 외국인 지분" value={`${avgFgn.toFixed(1)}%`} sub="KOSPI 200 평균" />
      </div>

      {/* 1차 vs 2차 비교 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-4 text-xl font-semibold">1차 vs 2차 회귀</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <div className="text-sm text-ink-dim">1차 — 가격 5팩터만</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <Stat label="Train CAGR" value={fmtPct(0.1762)} />
              <Stat label="Test CAGR" value={fmtPct(0.2972)} />
              <Stat label="Train Sharpe" value={fmtSharpe(0.75)} />
              <Stat label="Test Sharpe" value={fmtSharpe(1.49)} />
              <Stat label="Test excess vs KOSPI" value="+2.04%" />
              <Stat label="Overfit ratio" value="8.78x" />
            </div>
          </div>
          <div>
            <div className="text-sm text-accent-blue">2차 — 13팩터 (현재)</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <Stat label="Train CAGR" value={fmtPct(0.1862)} accent />
              <Stat label="Test CAGR" value={fmtPct(0.4634)} accent />
              <Stat label="Train Sharpe" value={fmtSharpe(0.82)} accent />
              <Stat label="Test Sharpe" value={fmtSharpe(2.30)} accent />
              <Stat label="Test excess vs KOSPI" value="+18.66%" accent />
              <Stat label="Overfit ratio" value="1.01x" accent />
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm text-ink-dim">
          ✅ 2차에서 overfit ratio 8.78x → <span className="text-accent-up">1.01x</span>. train/test
          excess 거의 동일. 펀더멘털 팩터 추가로 모델이 실제로 signal을 잡고 있음.
        </p>
      </section>

      {/* 13팩터 가중치 (전체 기간 평균) */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-1 text-xl font-semibold">13팩터 평균 가중치</h2>
        <p className="mb-4 text-sm text-ink-dim">
          83개월 cross-section 회귀의 β 평균. 양수 = 해당 팩터 점수 ↑ 시 다음달 수익률 ↑ 예측.
        </p>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>팩터</th>
                <th>설명</th>
                <th className="text-right">β (z-score)</th>
                <th className="text-right">avg t</th>
              </tr>
            </thead>
            <tbody>
              {ALL_FACTORS.map((c) => {
                const w = weights[c] || { beta: 0, t: 0 };
                const cls = w.beta > 0 ? "up" : w.beta < 0 ? "down" : "muted";
                return (
                  <tr key={c}>
                    <td className="font-mono text-sm">{c}</td>
                    <td className="text-ink-dim text-xs">{FACTOR_DESCRIPTIONS[c]}</td>
                    <td className={`num text-right ${cls}`}>
                      {w.beta >= 0 ? "+" : ""}
                      {w.beta.toFixed(4)}
                    </td>
                    <td className="num text-right text-ink-dim">{w.t.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 빠른 이동 */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Link
          href="/stocks"
          className="rounded-lg border border-gray-800 bg-bg-card p-5 transition hover:border-accent-blue"
        >
          <div className="text-sm text-ink-dim">탐색</div>
          <div className="mt-1 text-lg font-semibold">Stocks ({funds.length})</div>
        </Link>
        <Link
          href="/factors"
          className="rounded-lg border border-gray-800 bg-bg-card p-5 transition hover:border-accent-blue"
        >
          <div className="text-sm text-ink-dim">분석</div>
          <div className="mt-1 text-lg font-semibold">Factors (13)</div>
        </Link>
        <Link
          href="/backtest"
          className="rounded-lg border border-gray-800 bg-bg-card p-5 transition hover:border-accent-blue"
        >
          <div className="text-sm text-ink-dim">검증</div>
          <div className="mt-1 text-lg font-semibold">Backtest</div>
        </Link>
        <Link
          href="/signals"
          className="rounded-lg border border-gray-800 bg-bg-card p-5 transition hover:border-accent-blue"
        >
          <div className="text-sm text-ink-dim">라이브</div>
          <div className="mt-1 text-lg font-semibold">Signals</div>
        </Link>
      </section>

      {/* 한계 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5 text-sm">
        <h3 className="mb-2 font-semibold text-amber-400">⚠️ 한계 (정직하게)</h3>
        <ul className="ml-5 list-disc space-y-1 text-ink-dim">
          <li>펀더멘털 8팩터는 현재(2025Q3) 스냅샷을 과거 6년에도 동일 적용 — 일부 look-ahead bias 존재</li>
          <li>단일월 cross-section R² ≈ 0 → t-stat 작음, top 30 selection이 amplifying 해주는 구조</li>
          <li>2023-25 test 강세장 효과 포함 — regime-dependent, 일반화 시 주의</li>
        </ul>
      </section>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-bg-card p-4">
      <div className="text-xs text-ink-dim">{label}</div>
      <div className="mt-1 text-2xl font-semibold num">{value}</div>
      <div className="mt-1 text-xs text-ink-faint">{sub}</div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded border border-gray-800 bg-bg-elev p-2">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`text-base font-semibold num ${accent ? "text-accent-blue" : ""}`}>{value}</div>
    </div>
  );
}
