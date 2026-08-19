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
import { ALL_FACTORS, FACTOR_COLORS as COLORS } from "@/lib/constants";

interface Props {
  data: Record<string, any>[];
}

export default function BetaTimeSeries({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
        <XAxis
          dataKey="ym"
          stroke="#6b7280"
          fontSize={11}
          tickFormatter={(v) => (v ? v.substring(0, 7) : v)}
        />
        <YAxis stroke="#6b7280" fontSize={11} />
        <Tooltip
          contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 6 }}
          labelStyle={{ color: "#9ca3af" }}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {ALL_FACTORS.map((f) => (
          <Line
            key={f}
            type="monotone"
            dataKey={f}
            stroke={COLORS[f]}
            strokeWidth={1}
            dot={false}
            name={f}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
