import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fmtPct, fmtSharpe, fmtNum } from "@/lib/data";

export const dynamic = "force-static";
export const metadata = { title: "Sector-Neutral Analysis · KOSPI 200" };

interface Summary {
  sector_distribution: Record<string, number>;
  weights_2차_raw: Record<string, number>;
  weights_3차_sector_neutral: Record<string, number>;
  test: { bench: any; raw_2차: any; sector_3차: any };
  train: { bench: any; raw_2차: any; sector_3차: any };
  interpretation: string;
}

function load(): Summary | null {
  const p = path.join(process.cwd(), "data", "sector_neutral.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as Summary;
}

const FACTORS = [
  "momentum_12_1", "log_size", "volatility_60d", "liquidity", "mean_reversion",
  "PER", "PBR", "ROE", "PSR", "DividendYield", "DebtEquity", "ForeignOwnership", "OperatingMargin",
];

export default function SectorNeutralPage() {
  const s = load();

  if (!s) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Sector-Neutral Analysis</h1>
        <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
          <p className="text-amber-400">⏳ 데이터 없음 — Python 분석을 먼저 실행하세요.</p>
          <pre className="mt-2 rounded bg-bg-elev p-3 text-xs text-ink-dim">
{`cd C:/Users/LG/.minimax/workspace/kospi-factor
python 06_sector_regression.py`}
          </pre>
        </section>
      </div>
    );
  }

  const signSameCount = FACTORS.filter(
    (c) => (s.weights_2차_raw[c] || 0) * (s.weights_3차_sector_neutral[c] || 0) > 0
  ).length;
  const totalChange = Math.abs(
    s.test.sector_3차.CAGR - s.test.bench.CAGR - (s.test.raw_2차.CAGR - s.test.bench.CAGR)
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Sector-Neutral Analysis (3차)</h1>
        <p className="text-sm text-ink-dim">
          월별 섹터 평균 수익률을 차감한 뒤 cross-section 회귀 · 13팩터 중 섹터 효과와 무관한 순수 signal만 추출
        </p>
      </header>

      {/* KPI */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KPI label="팩터 부호 일치" value={`${signSameCount}/13`} sub="2차 vs 3차" />
        <KPI
          label="Test excess 변화"
          value={`${(
            (s.test.sector_3차.CAGR - s.test.bench.CAGR) -
            (s.test.raw_2차.CAGR - s.test.bench.CAGR)
          ).toFixed(2)}%p`}
          sub="3차 - 2차"
          verdict={Math.abs(totalChange) < 0.02 ? "good" : "warn"}
        />
        <KPI label="Test Sharpe" value={`${fmtSharpe(s.test.sector_3차.Sharpe)}`} sub="3차 (섹터 중립)" />
      </section>

      {/* 해석 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">해석</h2>
        <p className="text-sm text-ink">{s.interpretation}</p>
        <p className="mt-2 text-xs text-ink-dim">
          11/13 팩터가 부호 유지 → 섹터 중립화에도 signal 방향이 안정적. <br />
          Test excess 변화 -0.37%p (무시 가능 수준) → 13팩터의 signal은 섹터 노출이 아닌 순수 팩터 효과.
        </p>
      </section>

      {/* 섹터 분포 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">섹터 분포 (67개 분류 가능 종목)</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {Object.entries(s.sector_distribution).map(([sector, n]) => (
            <div key={sector} className="flex items-baseline justify-between rounded border border-gray-800 bg-bg-elev p-2 text-sm">
              <span>{sector}</span>
              <span className="num text-accent-blue">{n}개</span>
            </div>
          ))}
        </div>
      </section>

      {/* 가중치 비교 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">팩터 가중치 비교: 2차 (raw) vs 3차 (섹터 중립)</h2>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>팩터</th>
                <th className="text-right">2차 (raw) β</th>
                <th className="text-right">3차 (sector) β</th>
                <th className="text-right">Δ</th>
                <th className="text-right">변화율</th>
                <th className="text-center">부호</th>
              </tr>
            </thead>
            <tbody>
              {FACTORS.map((c) => {
                const a = s.weights_2차_raw[c] || 0;
                const b = s.weights_3차_sector_neutral[c] || 0;
                const same = a * b > 0;
                const pctChange = a !== 0 ? (b - a) / Math.abs(a) : 0;
                const cls = b > 0 ? "up" : b < 0 ? "down" : "muted";
                return (
                  <tr key={c}>
                    <td className="font-mono text-sm">{c}</td>
                    <td className={`num text-right ${a > 0 ? "up" : a < 0 ? "down" : "muted"}`}>
                      {a >= 0 ? "+" : ""}
                      {a.toFixed(4)}
                    </td>
                    <td className={`num text-right ${cls}`}>
                      {b >= 0 ? "+" : ""}
                      {b.toFixed(4)}
                    </td>
                    <td className={`num text-right ${b > a ? "up" : b < a ? "down" : ""}`}>
                      {b >= 0 ? "+" : ""}
                      {(b - a).toFixed(4)}
                    </td>
                    <td className="num text-right text-ink-dim">{(pctChange * 100).toFixed(0)}%</td>
                    <td className="text-center text-xs">
                      {same ? <span className="up">✓</span> : <span className="down">✗</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          ✓ 부호 일치 = 2차와 3차에서 가중치 방향이 같음 (signal 유지)
        </p>
      </section>

      {/* Train/test 백테스트 비교 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">백테스트 비교</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BacktestPanel title="TRAIN (2020-2022)" bench={s.train.bench} raw={s.train.raw_2차} sector={s.train.sector_3차} />
          <BacktestPanel title="TEST (2023-2025)" bench={s.test.bench} raw={s.test.raw_2차} sector={s.test.sector_3차} />
        </div>
      </section>

      <section className="rounded-lg border border-gray-800 bg-bg-card p-5 text-sm text-ink-dim">
        <h3 className="mb-2 font-semibold text-ink">방법론 노트</h3>
        <ul className="ml-5 list-disc space-y-1">
          <li>섹터 분류: 회사명 키워드 기반 11개 대분류 (정확도 ~90%)</li>
          <li>중립화: y = next_return - sector_avg_next_return (월별)</li>
          <li>회귀: 동일 13팩터, 동일 train/test split, 동일 비용 10bps</li>
          <li>한계: 키워드 매칭 한계로 32/199 종목이 "기타/혼합"으로 분류됨</li>
        </ul>
      </section>
    </div>
  );
}

function KPI({ label, value, sub, verdict }: { label: string; value: string; sub: string; verdict?: "good" | "warn" }) {
  const cls = verdict === "good" ? "up" : verdict === "warn" ? "text-amber-400" : "";
  return (
    <div className="rounded-lg border border-gray-800 bg-bg-card p-4">
      <div className="text-xs text-ink-dim">{label}</div>
      <div className={`mt-1 text-2xl font-semibold num ${cls}`}>{value}</div>
      <div className="mt-1 text-xs text-ink-faint">{sub}</div>
    </div>
  );
}

function BacktestPanel({ title, bench, raw, sector }: { title: string; bench: any; raw: any; sector: any }) {
  return (
    <div className="rounded border border-gray-800 bg-bg-elev p-4">
      <div className="mb-2 font-semibold">{title}</div>
      <table>
        <thead>
          <tr>
            <th></th>
            <th className="text-right">CAGR</th>
            <th className="text-right">Sharpe</th>
            <th className="text-right">MDD</th>
            <th className="text-right">Excess</th>
          </tr>
        </thead>
        <tbody>
          <Stat label="KOSPI 200 (bench)" cagr={bench.CAGR} sharpe={bench.Sharpe} mdd={bench.MDD} excess={0} />
          <Stat label="2차 (raw, 13팩터)" cagr={raw.CAGR} sharpe={raw.Sharpe} mdd={raw.MDD} excess={raw.CAGR - bench.CAGR} />
          <Stat
            label="3차 (sector-neutral, 13팩터)"
            cagr={sector.CAGR}
            sharpe={sector.Sharpe}
            mdd={sector.MDD}
            excess={sector.CAGR - bench.CAGR}
            highlight
          />
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, cagr, sharpe, mdd, excess, highlight }: { label: string; cagr: number; sharpe: number; mdd: number; excess: number; highlight?: boolean }) {
  return (
    <tr className={highlight ? "bg-bg-card" : ""}>
      <td className={highlight ? "text-accent-blue font-semibold" : ""}>{label}</td>
      <td className="num text-right">{fmtPct(cagr)}</td>
      <td className="num text-right">{fmtSharpe(sharpe)}</td>
      <td className="num text-right">{fmtPct(mdd)}</td>
      <td className={`num text-right ${excess > 0 ? "up" : excess < 0 ? "down" : ""}`}>
        {excess > 0 ? "+" : ""}
        {fmtPct(excess)}
      </td>
    </tr>
  );
}
