"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
export default function AgentBarChart({ data }: { data: { name: string; calls: number; leads: number }[] }) {
  return (
    <div className="h-[200px] mt-3">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#6b7280" }} />
          <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="calls" fill="#0b1a33" />
          <Bar dataKey="leads" fill="#c9a24b" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
