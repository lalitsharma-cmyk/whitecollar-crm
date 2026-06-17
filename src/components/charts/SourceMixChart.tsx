"use client";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

// `source` arrives already-labeled from sourceBreakdown() (verbatim sourceRaw,
// friendly enum-label fallback) — e.g. "WhatsApp", "Website", "CSV Import" — so
// the palette is keyed by those human labels. Unknown channels fall back to grey.
const colors: Record<string, string> = {
  Website: "#0b1a33",
  WhatsApp: "#16a34a",
  Event: "#c9a24b",
  "CSV Import": "#3b82f6",
  Referral: "#8b5cf6",
  "Inbound Call": "#ef4444",
  "Facebook Ads": "#0ea5e9",
  "Google Ads": "#f59e0b",
  "99Acres": "#10b981",
  MagicBricks: "#a855f7",
  "Housing.com": "#ec4899",
  Other: "#9ca3af",
};

export default function SourceMixChart({ data }: { data: { source: string; n: number }[] }) {
  // source is already a human label — render it as-is.
  const chartData = data.map((d) => ({ name: d.source, value: d.n, src: d.source }));
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2}>
            {chartData.map((d) => <Cell key={d.src} fill={colors[d.src] ?? "#9ca3af"} />)}
          </Pie>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
