import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllFunds,
  getMonthlyForTicker,
  fmtNum,
  PRICE_FACTORS,
  FACTOR_DESCRIPTIONS,
  type Fundamental,
} from "@/lib/data";
import PriceChart from "@/components/PriceChart";
import FactorScoreChart from "@/components/FactorScoreChart";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllFunds().map((f) => ({ ticker: f.ticker }));
}

export async function generateMetadata({ params }: { params: { ticker: string } }) {
  const fund = getAllFunds().find((f) => f.ticker === params.ticker);
  return { title: fund ? `${fund.name} (${params.ticker})` : params.ticker };
}

export default function StockDetail({ params }: { params: { ticker: string } }) {
  const fund = getAllFunds().find((f) => f.ticker === params.ticker);
  if (!fund) notFound();

  const monthly = getMonthlyForTicker(params.ticker);
  // 가격 데이터 (월말)
  const priceSeries = monthly
    .map((m) => ({
      date: m.Date,
      close: parseFloat(m.Close),
    }))
    .filter((p) => Number.isFinite(p.close));

  // 가격 팩터 시계열 (월말 값)
  const factorSeries = monthly.map((m) => {
    const obj: Record<string, any> = { date: m.Date };
    for (const f of PRICE_FACTORS) {
      const v = parseFloat((m as any)[f]);
      if (Number.isFinite(v)) obj[f] = v;
    }
    return obj;
  });

  // z-score 표준화 (전 종목 평균 0, std 1) — 단순화: 자기 자신 series에 대해 표준화
  function zscore(arr: number[]): number[] {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length) || 1;
    return arr.map((v) => (v - mean) / std);
  }

  const factorZ: Record<string, number[]> = {};
  for (const f of PRICE_FACTORS) {
    factorZ[f] = zscore(factorSeries.map((r) => r[f]).filter((v) => v != null));
  }
  const zSeries = factorSeries
    .filter((r) => r.momentum_12_1 != null)
    .map((r, i) => ({
      date: r.date,
      ...Object.fromEntries(PRICE_FACTORS.map((f) => [f, factorZ[f][i] ?? null])),
    }));

  // 펀더멘털 z-score (KOSPI 200 평균)
  const allFunds = getAllFunds();
  function fundZ(key: keyof Fundamental, v: number | null): number | null {
    if (v == null) return null;
    const vals = allFunds.map((f) => f[key]).filter((x): x is number => typeof x === "number");
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    return (v - mean) / std;
  }

  const fundZScores = {
    PER: fundZ("PER", fund.PER),
    PBR: fundZ("PBR", fund.PBR),
    ROE: fundZ("ROE", fund.ROE),
    PSR: fundZ("PSR", fund.PSR),
    DividendYield: fundZ("DividendYield", fund.DividendYield),
    DebtEquity: fundZ("DebtEquity", fund.DebtEquity),
    ForeignOwnership: fundZ("ForeignOwnership", fund.ForeignOwnership),
    OperatingMargin: fundZ("OperatingMargin", fund.OperatingMargin),
  };

  // 가중치 (전체 기간 평균, summary에서 가져올 수도 있지만 재계산)
  // z-score 표준화 자체로는 score 안 만들고, 펀더멘털 z 만 보여줌

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <Link href="/stocks" className="text-sm text-ink-dim hover:text-ink">
            ← Stocks
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            {fund.name} <span className="num text-ink-dim">({fund.ticker})</span>
          </h1>
        </div>
        <div className="text-xs text-ink-faint">월말 데이터 {monthly.length}개</div>
      </header>

      {/* 펀더멘털 카드 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">펀더멘털 (2025Q3 스냅샷)</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Fund label="PER" value={fmtNum(fund.PER)} z={fundZScores.PER} />
          <Fund label="PBR" value={fmtNum(fund.PBR)} z={fundZScores.PBR} />
          <Fund label="ROE %" value={fmtNum(fund.ROE)} z={fundZScores.ROE} />
          <Fund label="PSR" value={fmtNum(fund.PSR)} z={fundZScores.PSR} />
          <Fund label="배당 %" value={fmtNum(fund.DividendYield)} z={fundZScores.DividendYield} />
          <Fund label="부채 %" value={fmtNum(fund.DebtEquity)} z={fundZScores.DebtEquity} />
          <Fund label="외국인 %" value={fmtNum(fund.ForeignOwnership)} z={fundZScores.ForeignOwnership} />
          <Fund
            label="영업이익률"
            value={fund.OperatingMargin != null ? `${(fund.OperatingMargin * 100).toFixed(1)}%` : "—"}
            z={fundZScores.OperatingMargin}
          />
        </div>
        <div className="mt-3 text-xs text-ink-faint">
          * z = KOSPI 200 평균 대비 표준화 점수. 음수 = 평균보다 낮음, 양수 = 높음.
        </div>
      </section>

      {/* 가격 차트 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">가격 (월말)</h2>
        {priceSeries.length > 1 ? (
          <PriceChart data={priceSeries} />
        ) : (
          <div className="text-sm text-ink-faint">가격 데이터 없음</div>
        )}
      </section>

      {/* 가격 팩터 시계열 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
        <h2 className="mb-1 text-lg font-semibold">5개 가격 팩터 (z-score)</h2>
        <p className="mb-3 text-xs text-ink-faint">
          종목 내 표준화 점수. 높을수록 해당 팩터 강세.
        </p>
        {zSeries.length > 0 ? <FactorScoreChart data={zSeries} /> : <div className="text-sm text-ink-faint">데이터 없음</div>}
      </section>

      {/* 팩터 설명 */}
      <section className="rounded-lg border border-gray-800 bg-bg-card p-5 text-sm">
        <h3 className="mb-2 font-semibold">팩터 정의</h3>
        <ul className="space-y-1 text-ink-dim">
          {PRICE_FACTORS.map((f) => (
            <li key={f}>
              <span className="font-mono text-ink">{f}</span> — {FACTOR_DESCRIPTIONS[f]}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Fund({ label, value, z }: { label: string; value: string; z: number | null }) {
  const zCls = z == null ? "muted" : z > 1 ? "up" : z < -1 ? "down" : "ink-dim";
  const zTxt = z == null ? "—" : z.toFixed(2);
  return (
    <div className="rounded border border-gray-800 bg-bg-elev p-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="mt-1 flex items-baseline justify-between">
        <div className="text-lg font-semibold num">{value}</div>
        <div className={`num text-sm ${zCls}`}>z={zTxt}</div>
      </div>
    </div>
  );
}
