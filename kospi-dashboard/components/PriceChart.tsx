"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface Props {
  data: { date: string; close: number }[];
}

export default function PriceChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          stroke="#6b7280"
          fontSize={11}
          tickFormatter={(v) => (v ? v.substring(0, 7) : v)}
        />
        <YAxis stroke="#6b7280" fontSize={11} />
        <Tooltip
          contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 6 }}
          labelStyle={{ color: "#9ca3af" }}
        />
        <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Close" />
      </LineChart>
    </ResponsiveContainer>
  );
}
