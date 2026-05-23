"use client";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

const colors: Record<string, string> = {
  WEBSITE: "#0b1a33",
  WHATSAPP: "#16a34a",
  EVENT: "#c9a24b",
  CSV_IMPORT: "#3b82f6",
  REFERRAL: "#8b5cf6",
  INBOUND_CALL: "#ef4444",
  FACEBOOK_ADS: "#0ea5e9",
  GOOGLE_ADS: "#f59e0b",
  PORTAL_99ACRES: "#10b981",
  PORTAL_MAGICBRICKS: "#a855f7",
  PORTAL_HOUSING: "#ec4899",
  OTHER: "#9ca3af",
};
const labels: Record<string, string> = {
  WEBSITE: "Website", WHATSAPP: "WhatsApp", EVENT: "Events", CSV_IMPORT: "CSV", REFERRAL: "Referral",
  INBOUND_CALL: "Inbound Call", FACEBOOK_ADS: "Facebook", GOOGLE_ADS: "Google", PORTAL_99ACRES: "99acres",
  PORTAL_MAGICBRICKS: "MagicBricks", PORTAL_HOUSING: "Housing", OTHER: "Other",
};

export default function SourceMixChart({ data }: { data: { source: string; n: number }[] }) {
  const chartData = data.map((d) => ({ name: labels[d.source] ?? d.source, value: d.n, src: d.source }));
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
