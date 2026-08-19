import Link from "next/link";
import { getAllFunds, fmtNum } from "@/lib/data";

export const dynamic = "force-static";

export const metadata = {
  title: "Stocks · KOSPI 200",
};

export default function StocksPage() {
  const funds = getAllFunds();

  // 정렬: 시총 desc (이미 snapshot이 정렬되어 있다고 가정)
  // 단, 시총 데이터가 여기엔 없으므로 이름순 fallback
  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stocks</h1>
          <p className="text-sm text-ink-dim">
            KOSPI 시총 상위 {funds.length}개 · 펀더멘털 스냅샷 (2025Q3 기준)
          </p>
        </div>
        <div className="text-xs text-ink-faint">정렬: ticker asc</div>
      </header>

      <div className="overflow-x-auto rounded-lg border border-gray-800 bg-bg-card">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>이름</th>
              <th className="text-right">PER</th>
              <th className="text-right">PBR</th>
              <th className="text-right">ROE %</th>
              <th className="text-right">PSR</th>
              <th className="text-right">배당 %</th>
              <th className="text-right">부채 %</th>
              <th className="text-right">외국인 %</th>
              <th className="text-right">영업이익률</th>
            </tr>
          </thead>
          <tbody>
            {funds.map((s) => (
              <tr key={s.ticker}>
                <td className="num">
                  <Link href={`/stocks/${s.ticker}`} className="text-accent-blue hover:underline">
                    {s.ticker}
                  </Link>
                </td>
                <td>{s.name}</td>
                <td className="num text-right">{fmtNum(s.PER)}</td>
                <td className="num text-right">{fmtNum(s.PBR)}</td>
                <td className="num text-right">{fmtNum(s.ROE)}</td>
                <td className="num text-right">{fmtNum(s.PSR)}</td>
                <td className="num text-right">{fmtNum(s.DividendYield)}</td>
                <td className="num text-right">{fmtNum(s.DebtEquity)}</td>
                <td className="num text-right">{fmtNum(s.ForeignOwnership)}</td>
                <td className="num text-right">
                  {s.OperatingMargin != null ? `${(s.OperatingMargin * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
