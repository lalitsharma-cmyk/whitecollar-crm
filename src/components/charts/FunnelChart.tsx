"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList } from "recharts";
const colors = ["#0b1a33", "#1e3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#c9a24b"];
export default function FunnelChart({ data }: { data: { stage: string; n: number }[] }) {
  return (
    <div className="h-[260px] mt-3">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
          <XAxis type="number" tick={{ fontSize: 10, fill: "#6b7280" }} />
          <YAxis dataKey="stage" type="category" tick={{ fontSize: 11, fill: "#374151" }} />
          <Tooltip />
          <Bar dataKey="n">
            {data.map((_, i) => <Cell key={i} fill={colors[i] ?? "#9ca3af"} />)}
            <LabelList dataKey="n" position="right" style={{ fontSize: 11, fill: "#374151" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
