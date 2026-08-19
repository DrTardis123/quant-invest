"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Fundamental } from "@/lib/data";

const FILTERS: { key: keyof Fundamental; label: string; step: number; format: "num" | "pct" }[] = [
  { key: "PER", label: "PER", step: 1, format: "num" },
  { key: "PBR", label: "PBR", step: 0.1, format: "num" },
  { key: "ROE", label: "ROE %", step: 1, format: "num" },
  { key: "PSR", label: "PSR", step: 0.5, format: "num" },
  { key: "DividendYield", label: "배당수익률 %", step: 0.1, format: "num" },
  { key: "DebtEquity", label: "부채비율 %", step: 5, format: "num" },
  { key: "ForeignOwnership", label: "외국인 지분 %", step: 5, format: "num" },
  { key: "OperatingMargin", label: "영업이익률 %", step: 1, format: "pct" },
];

export default function ScreenerClient({ funds }: { funds: Fundamental[] }) {
  const [filters, setFilters] = useState<Record<string, { min?: number; max?: number }>>({});
  const [sortKey, setSortKey] = useState<keyof Fundamental>("ForeignOwnership");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    let rows = funds.filter((f) => {
      if (query && !`${f.ticker} ${f.name}`.toLowerCase().includes(query.toLowerCase())) {
        return false;
      }
      for (const [k, range] of Object.entries(filters)) {
        const v = f[k as keyof Fundamental] as number | null;
        if (v == null) return false;
        if (range.min != null && v < range.min) return false;
        if (range.max != null && v > range.max) return false;
      }
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey] as number | null;
      const bv = b[sortKey] as number | null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return rows;
  }, [funds, filters, sortKey, sortDir, query]);

  const reset = () => {
    setFilters({});
    setQuery("");
  };

  const applyPreset = (name: "value" | "quality" | "foreign") => {
    const next: Record<string, { min?: number; max?: number }> = {};
    if (name === "value") {
      next.PER = { max: 15 };
      next.PBR = { max: 1.5 };
      next.PSR = { max: 2 };
    } else if (name === "quality") {
      next.ROE = { min: 10 };
      next.DebtEquity = { max: 100 };
      next.OperatingMargin = { min: 10 }; // % (display unit)
    } else if (name === "foreign") {
      next.ForeignOwnership = { min: 30 };
    }
    setFilters(next);
  };

  const setHeaderSort = (k: keyof Fundamental) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Screener</h1>
        <p className="text-sm text-ink-dim">
          199개 KOSPI 종목 · 8개 펀더멘털 자유 필터링 · 정렬
        </p>
      </header>

      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-bg-card p-4">
        <span className="text-sm text-ink-dim">프리셋:</span>
        <button
          onClick={() => applyPreset("value")}
          className="rounded border border-gray-700 bg-bg-elev px-3 py-1 text-xs hover:border-accent-blue"
        >
          💎 가치주 (PER ≤ 15, PBR ≤ 1.5, PSR ≤ 2)
        </button>
        <button
          onClick={() => applyPreset("quality")}
          className="rounded border border-gray-700 bg-bg-elev px-3 py-1 text-xs hover:border-accent-blue"
        >
          ⭐ 우량주 (ROE ≥ 10%, 부채 ≤ 100%, OPM ≥ 10%)
        </button>
        <button
          onClick={() => applyPreset("foreign")}
          className="rounded border border-gray-700 bg-bg-elev px-3 py-1 text-xs hover:border-accent-blue"
        >
          🌍 외국인 매집 (외국인 ≥ 30%)
        </button>
        <button onClick={reset} className="ml-auto rounded border border-gray-700 bg-bg-elev px-3 py-1 text-xs text-ink-dim hover:border-red-500">
          리셋
        </button>
        <input
          type="text"
          placeholder="🔍 검색 (ticker / 이름)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded border border-gray-700 bg-bg-elev px-3 py-1 text-sm text-ink placeholder:text-ink-faint"
        />
      </section>

      <section className="rounded-lg border border-gray-800 bg-bg-card p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {FILTERS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label className="text-xs text-ink-dim">{f.label}</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step={f.step}
                  placeholder="min"
                  value={filters[f.key as string]?.min ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value);
                    setFilters((prev) => ({
                      ...prev,
                      [f.key as string]: { ...prev[f.key as string], min: v },
                    }));
                  }}
                  className="w-full rounded border border-gray-700 bg-bg-elev px-2 py-1 text-sm num"
                />
                <span className="text-ink-faint">~</span>
                <input
                  type="number"
                  step={f.step}
                  placeholder="max"
                  value={filters[f.key as string]?.max ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value);
                    setFilters((prev) => ({
                      ...prev,
                      [f.key as string]: { ...prev[f.key as string], max: v },
                    }));
                  }}
                  className="w-full rounded border border-gray-700 bg-bg-elev px-2 py-1 text-sm num"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-gray-800 bg-bg-card">
        <div className="flex items-center justify-between border-b border-gray-800 p-3">
          <div className="text-sm">
            <span className="text-ink-dim">결과: </span>
            <span className="font-semibold text-accent-blue">{filtered.length}</span>
            <span className="text-ink-dim"> / {funds.length} 종목</span>
          </div>
          <div className="text-xs text-ink-faint">정렬: {sortKey} {sortDir === "desc" ? "↓" : "↑"}</div>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <Th k="ticker" cur={sortKey} dir={sortDir} onClick={setHeaderSort}>
                  Ticker
                </Th>
                <th>이름</th>
                {FILTERS.map((f) => (
                  <Th key={f.key} k={f.key} cur={sortKey} dir={sortDir} onClick={setHeaderSort}>
                    {f.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((s) => (
                <tr key={s.ticker}>
                  <td className="num">
                    <Link href={`/stocks/${s.ticker}`} className="text-accent-blue hover:underline">
                      {s.ticker}
                    </Link>
                  </td>
                  <td>{s.name}</td>
                  {FILTERS.map((f) => {
                    const v = s[f.key] as number | null;
                    let display = "—";
                    if (v != null) {
                      if (f.format === "pct") display = (v * 100).toFixed(1) + "%";
                      else display = v.toFixed(f.step < 1 ? 2 : 1);
                    }
                    return (
                      <td key={f.key} className="num text-right">
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 200 && (
          <div className="p-3 text-center text-xs text-ink-faint">
            상위 200개만 표시. ({filtered.length - 200}개 더 있음 — 필터를 더 좁혀보세요)
          </div>
        )}
        {filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-ink-dim">
            조건에 맞는 종목이 없습니다. 필터를 완화해보세요.
          </div>
        )}
      </section>
    </div>
  );
}

function Th<K extends string>({
  k,
  cur,
  dir,
  onClick,
  children,
}: {
  k: K;
  cur: K;
  dir: "asc" | "desc";
  onClick: (k: K) => void;
  children: React.ReactNode;
}) {
  const active = cur === k;
  return (
    <th
      onClick={() => onClick(k)}
      className={`cursor-pointer select-none ${active ? "text-accent-blue" : ""}`}
    >
      {children}
      {active && <span className="ml-1">{dir === "desc" ? "▼" : "▲"}</span>}
    </th>
  );
}
