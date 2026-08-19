import { getAllBetas, ALL_FACTORS, FACTOR_DESCRIPTIONS } from "@/lib/data";
import FactorRow from "@/components/FactorRow";
import BetaTimeSeries from "@/components/BetaTimeSeries";

export const dynamic = "force-static";
export const metadata = { title: "Factors · KOSPI 200" };

export default function FactorsPage() {
  const betas = getAllBetas();
  const n = betas.length;

  // 팩터별 통계
  const stats = ALL_FACTORS.map((c) => {
    const betaKey = `beta_${c}` as const;
    const tKey = `t_${c}` as const;
    const mean_beta = betas.reduce((a, b) => a + ((b as any)[betaKey] || 0), 0) / n;
    const mean_t = betas.reduce((a, b) => a + ((b as any)[tKey] || 0), 0) / n;
    const positiveMonths = betas.filter((b) => ((b as any)[betaKey] || 0) * mean_beta > 0).length;
    return {
      factor: c,
      description: FACTOR_DESCRIPTIONS[c],
      mean_beta,
      mean_t,
      sign_agreement: positiveMonths / n,
    };
  });

  // 팩터별 시계열
  const seriesByFactor: Record<string, { ym: string; beta: number }[]> = {};
  for (const c of ALL_FACTORS) {
    const betaKey = `beta_${c}` as const;
    seriesByFactor[c] = betas.map((b) => ({
      ym: b.YearMonth,
      beta: (b as any)[betaKey] || 0,
    }));
  }

  // 전체 시계열 차트용
  const ts = betas.map((b) => {
    const obj: any = { ym: b.YearMonth };
    for (const c of ALL_FACTORS) obj[c] = (b as any)[`beta_${c}`];
    return obj;
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Factors</h1>
        <p className="text-sm text-ink-dim">
          13팩터 (가격 5 + 펀더멘털 8) · {n}개월 cross-section 회귀 · <span className="text-amber-400">팩터 행 클릭 시 상세 차트 펼쳐짐</span>
        </p>
      </header>

      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">팩터별 평균 가중치 + 안정성</h2>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>팩터</th>
                <th>설명</th>
                <th className="text-right">β (z-score)</th>
                <th className="text-right">avg t</th>
                <th className="text-right">부호 일치율</th>
                <th>해석</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <FactorRow
                  key={s.factor}
                  factor={s.factor}
                  description={s.description}
                  data={seriesByFactor[s.factor]}
                  meanBeta={s.mean_beta}
                  meanT={s.mean_t}
                  signAgreement={s.sign_agreement}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          팩터 행 클릭 → 그 팩터만 따로 본 월별 β 시계열 + 분포 통계
        </p>
      </section>

      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">전체 팩터 β 시계열 (오버레이)</h2>
        <BetaTimeSeries data={ts} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FactorGroup title="가격 팩터 (5)" factors={["momentum_12_1", "log_size", "volatility_60d", "liquidity", "mean_reversion"]} stats={stats} />
        <FactorGroup
          title="펀더멘털 팩터 (8)"
          factors={["PER", "PBR", "ROE", "PSR", "DividendYield", "DebtEquity", "ForeignOwnership", "OperatingMargin"]}
          stats={stats}
        />
      </section>
    </div>
  );
}

function FactorGroup({ title, factors, stats }: { title: string; factors: string[]; stats: any[] }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-bg-card p-5">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <ul className="space-y-1.5 text-sm">
        {factors.map((f) => {
          const s = stats.find((x: any) => x.factor === f);
          if (!s) return null;
          const dir = s.mean_beta > 0 ? "↑ → 다음달 +" : s.mean_beta < 0 ? "↓ → 다음달 -" : "≈";
          const dirCls = s.mean_beta > 0 ? "up" : s.mean_beta < 0 ? "down" : "muted";
          return (
            <li key={f} className="flex items-baseline justify-between border-b border-gray-800 py-1">
              <span className="font-mono text-xs">{f}</span>
              <span className={`num text-sm ${dirCls}`}>
                {dir} β={s.mean_beta.toFixed(4)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
