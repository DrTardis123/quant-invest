import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-static";
export const metadata = { title: "Signals · KOSPI 200" };

interface SignalRow {
  code: string;
  name: string;
  closePrice: number;
  changeRate: number;
  changePrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  tradingValue: number; // 억원 단위
  marketStatus: string;
  isUpperLimit: boolean;
  isLowerLimit: boolean;
}

interface Signals {
  fetched_at: string;
  n_total: number;
  n_valid: number;
  market_open: boolean;
  upper_limit: SignalRow[];
  lower_limit: SignalRow[];
  top_turnover: SignalRow[];
  top_gainers: SignalRow[];
  top_losers: SignalRow[];
}

function loadSignals(): Signals | null {
  const p = path.join(process.cwd(), "data", "signals.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Signals;
}

const KRW0 = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const KRW1 = (n: number) => `${n.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`;
const PCT = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function SignalsPage() {
  const s = loadSignals();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Signals</h1>
        <p className="text-sm text-ink-dim">
          일별 라이브 시그널 (상한가 / 거래대금 / 등락률) · Naver Finance polling API
        </p>
      </header>

      {!s ? (
        <NoData />
      ) : (
        <>
          {/* 메타 */}
          <section className="rounded-lg border border-gray-800 bg-bg-card p-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div>
                <span className="text-ink-faint">수집 시각: </span>
                <span className="num text-ink">
                  {new Date(s.fetched_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                </span>
              </div>
              <div>
                <span className="text-ink-faint">응답: </span>
                <span className="num text-ink">{s.n_valid} / {s.n_total}</span>
              </div>
              <div>
                <span className="text-ink-faint">시장: </span>
                <span className={s.market_open ? "up" : "text-ink-dim"}>
                  {s.market_open ? "OPEN" : "CLOSE"}
                </span>
              </div>
              <div className="ml-auto text-xs text-ink-faint">
                갱신: <code>node scripts/fetch-signals.mjs</code>
              </div>
            </div>
          </section>

          {/* 상한가 / 하한가 */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <LimitPanel title="상한가 (Upper Limit)" emoji="🚀" rows={s.upper_limit} />
            <LimitPanel title="하한가 (Lower Limit)" emoji="💥" rows={s.lower_limit} />
          </section>

          {/* 거래대금 top 30 */}
          <Section title="거래대금 상위 30" emoji="💰">
            <Table
              cols={["ticker", "name", "changeRate", "tradingValue", "closePrice", "volume"]}
              rows={s.top_turnover}
            />
          </Section>

          {/* 등락률 top 20 */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="상위 20 (등락률 ↑)" emoji="📈">
              <Table
                cols={["ticker", "name", "changeRate", "closePrice", "tradingValue"]}
                rows={s.top_gainers}
              />
            </Section>
            <Section title="하위 20 (등락률 ↓)" emoji="📉">
              <Table
                cols={["ticker", "name", "changeRate", "closePrice", "tradingValue"]}
                rows={s.top_losers}
              />
            </Section>
          </section>
        </>
      )}

      <section className="rounded-lg border border-gray-800 bg-bg-card p-5 text-sm">
        <h3 className="mb-2 font-semibold">데이터 파이프라인</h3>
        <p className="mb-2 text-ink-dim">
          <code>scripts/fetch-signals.mjs</code> — 199개 KOSPI 종목을 Naver polling API로 일괄 조회.
          배치 20개씩, 약 10-15초 소요.
        </p>
        <pre className="overflow-x-auto rounded bg-bg-elev p-3 text-xs text-ink-dim">
          {`# 로컬 실행
cd kospi-dashboard
node scripts/fetch-signals.mjs

# 자동 갱신 (GitHub Actions, 매일 16:00 KST)
- name: Fetch signals
  run: node scripts/fetch-signals.mjs
  working-directory: kospi-dashboard
- name: Commit & push
  run: |
    git add kospi-dashboard/data/signals.json
    git commit -m "data(signals): $(date +%H:%M) KST 갱신" || exit 0
    git push`}
        </pre>
      </section>
    </div>
  );
}

function NoData() {
  return (
    <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
      <h2 className="mb-3 text-lg font-semibold text-amber-400">⏳ 시그널 데이터 없음</h2>
      <p className="mb-3 text-sm text-ink-dim">
        <code>data/signals.json</code>이 아직 생성되지 않았습니다. 로컬에서 실행:
      </p>
      <pre className="rounded bg-bg-elev p-3 text-xs text-ink">cd kospi-dashboard && node scripts/fetch-signals.mjs</pre>
    </section>
  );
}

function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
      <h2 className="mb-3 text-lg font-semibold">
        {emoji} {title}
      </h2>
      {children}
    </section>
  );
}

function LimitPanel({ title, emoji, rows }: { title: string; emoji: string; rows: SignalRow[] }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-bg-card p-5">
      <h2 className="mb-3 text-lg font-semibold">
        {emoji} {title}{" "}
        <span className="text-sm font-normal text-ink-faint">({rows.length}개)</span>
      </h2>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-ink-faint">해당 종목 없음 (오늘 ±30% 종목 0개)</div>
      ) : (
        <Table
          cols={["ticker", "name", "changeRate", "closePrice", "tradingValue"]}
          rows={rows}
        />
      )}
    </section>
  );
}

function Table({ cols, rows }: { cols: string[]; rows: SignalRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} className={["changeRate", "tradingValue", "closePrice", "volume"].includes(c) ? "text-right" : ""}>
                {COL_LABEL[c] || c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              {cols.map((c) => (
                <td
                  key={c}
                  className={
                    "num " +
                    (c === "changeRate" ? "text-right " + (r.changeRate > 0 ? "up" : r.changeRate < 0 ? "down" : "") : "") +
                    (["tradingValue", "closePrice", "volume"].includes(c) ? "text-right" : "")
                  }
                >
                  {renderCell(c, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COL_LABEL: Record<string, string> = {
  ticker: "Ticker",
  name: "이름",
  changeRate: "등락률",
  tradingValue: "거래대금",
  closePrice: "현재가",
  volume: "거래량",
};

function renderCell(col: string, r: SignalRow): React.ReactNode {
  switch (col) {
    case "ticker":
      return r.code;
    case "name":
      return r.name;
    case "changeRate":
      return PCT(r.changeRate);
    case "tradingValue":
      return KRW1(r.tradingValue);
    case "closePrice":
      return KRW0(r.closePrice);
    case "volume":
      return r.volume.toLocaleString("ko-KR");
    default:
      return "—";
  }
}
