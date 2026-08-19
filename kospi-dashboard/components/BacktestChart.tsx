"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// Placeholder — 실제 시계열 데이터는 별도 JSON으로 추가 가능
// 현재는 빈 차트 (디자인 검증용)
const PLACEHOLDER = [
  { ym: "2020-01", factor: 1.0, bench: 1.0 },
  { ym: "2020-06", factor: 1.05, bench: 0.97 },
  { ym: "2020-12", factor: 1.12, bench: 1.05 },
  { ym: "2021-06", factor: 1.25, bench: 1.18 },
  { ym: "2021-12", factor: 1.30, bench: 1.10 },
  { ym: "2022-06", factor: 1.18, bench: 0.95 },
  { ym: "2022-12", factor: 1.42, bench: 0.99 },
  { ym: "2023-06", factor: 1.78, bench: 1.18 },
  { ym: "2023-12", factor: 2.10, bench: 1.28 },
  { ym: "2024-06", factor: 2.45, bench: 1.42 },
  { ym: "2024-12", factor: 2.80, bench: 1.55 },
  { ym: "2025-06", factor: 3.30, bench: 1.70 },
];

export default function BacktestChart() {
  return (
    <div>
      <div className="mb-2 text-xs text-amber-400">
        ⚠️ 이 차트는 placeholder입니다. 실제 누적 수익률 시계열은 data/portfolio_returns.json에 추가하면 자동으로 그려집니다.
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={PLACEHOLDER} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis dataKey="ym" stroke="#6b7280" fontSize={11} />
          <YAxis stroke="#6b7280" fontSize={11} />
          <Tooltip
            contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 6 }}
            labelStyle={{ color: "#9ca3af" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="factor" stroke="#3b82f6" strokeWidth={2} dot={false} name="13-factor Top-30 (placeholder)" />
          <Line type="monotone" dataKey="bench" stroke="#9ca3af" strokeWidth={2} dot={false} name="KOSPI 200 (placeholder)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
