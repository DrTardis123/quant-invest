"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { FACTOR_DESCRIPTIONS, FACTOR_COLORS } from "@/lib/constants";

interface Props {
  factor: string;
  description: string;
  data: { ym: string; beta: number }[]; // 시계열
  meanBeta: number;
  meanT: number;
  signAgreement: number;
}

export default function FactorRow({
  factor,
  description,
  data,
  meanBeta,
  meanT,
  signAgreement,
}: Props) {
  const [open, setOpen] = useState(false);
  const color = FACTOR_COLORS[factor] || "#3b82f6";

  // 통계
  const positives = data.filter((d) => d.beta > 0).length;
  const negatives = data.filter((d) => d.beta < 0).length;
  const max = Math.max(...data.map((d) => d.beta));
  const min = Math.min(...data.map((d) => d.beta));

  const sign = signAgreement > 0.7 ? "안정" : signAgreement > 0.5 ? "보통" : "불안정";
  const signCls = signAgreement > 0.7 ? "text-accent-up" : signAgreement > 0.5 ? "text-amber-400" : "text-accent-down";
  const betaCls = meanBeta > 0 ? "up" : meanBeta < 0 ? "down" : "muted";

  return (
    <>
      <tr
        onClick={() => setOpen(!open)}
        className={`cursor-pointer transition ${open ? "bg-bg-elev" : "hover:bg-bg-elev"}`}
      >
        <td className="font-mono text-sm">
          {factor}
          <span className="ml-1 text-ink-faint">{open ? "▼" : "▶"}</span>
        </td>
        <td className="text-ink-dim text-xs">{description}</td>
        <td className={`num text-right ${betaCls}`}>
          {meanBeta >= 0 ? "+" : ""}
          {meanBeta.toFixed(4)}
        </td>
        <td className="num text-right text-ink-dim">{meanT.toFixed(2)}</td>
        <td className="num text-right">{(signAgreement * 100).toFixed(0)}%</td>
        <td className={`text-xs ${signCls}`}>{sign}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-bg-elev p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* 시계열 차트 */}
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <div className="text-sm font-semibold">월별 β 시계열</div>
                  <div className="text-xs text-ink-faint">mean = {meanBeta.toFixed(4)}</div>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="ym"
                      stroke="#6b7280"
                      fontSize={10}
                      tickFormatter={(v) => (v ? v.substring(2, 7) : v)}
                    />
                    <YAxis stroke="#6b7280" fontSize={10} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 6 }}
                      labelStyle={{ color: "#9ca3af" }}
                    />
                    <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                    <Line
                      type="monotone"
                      dataKey="beta"
                      stroke={color}
                      strokeWidth={1.5}
                      dot={false}
                      name="β"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* 통계 */}
              <div>
                <div className="mb-2 text-sm font-semibold">분포 통계</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Stat label="평균 β" value={`${meanBeta >= 0 ? "+" : ""}${meanBeta.toFixed(4)}`} cls={betaCls} />
                  <Stat label="평균 t-stat" value={meanT.toFixed(2)} />
                  <Stat label="최대" value={`+${max.toFixed(4)}`} cls="up" />
                  <Stat label="최소" value={min.toFixed(4)} cls="down" />
                  <Stat label="양수 개월" value={`${positives} / ${data.length}`} cls="up" />
                  <Stat label="음수 개월" value={`${negatives} / ${data.length}`} cls="down" />
                  <Stat
                    label="부호 일치율"
                    value={`${(signAgreement * 100).toFixed(1)}%`}
                    cls={signAgreement > 0.7 ? "up" : signAgreement > 0.5 ? "text-amber-400" : "down"}
                  />
                  <Stat label="해석" value={sign} cls={signAgreement > 0.7 ? "up" : signAgreement > 0.5 ? "text-amber-400" : "down"} />
                </div>
                <div className="mt-3 text-xs text-ink-faint">
                  💡 팩터 점수가 {meanBeta > 0 ? "높을수록" : "낮을수록"} 다음달 수익률이 {meanBeta > 0 ? "↑" : "↓"} 하는 경향.
                  부호 일치율이 높을수록 안정적인 signal.
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded border border-gray-800 bg-bg-card p-2">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`num text-sm font-semibold ${cls || ""}`}>{value}</div>
    </div>
  );
}
