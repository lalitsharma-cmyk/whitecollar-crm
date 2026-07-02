"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
const colors: Record<string, string> = {
  WEBSITE: "#0b1a33", WHATSAPP: "#16a34a", EVENT: "#c9a24b", CSV_IMPORT: "#3b82f6",
  REFERRAL: "#8b5cf6", INBOUND_CALL: "#ef4444", OTHER: "#9ca3af",
};
export default function SourceBarChart({ data }: { data: { source: string; n: number }[] }) {
  return (
    <div className="h-[200px] mt-3">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data}>
          <XAxis dataKey="source" tick={{ fontSize: 10, fill: "#6b7280" }} />
          <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="n">
            {data.map((d) => <Cell key={d.source} fill={colors[d.source] ?? "#9ca3af"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
