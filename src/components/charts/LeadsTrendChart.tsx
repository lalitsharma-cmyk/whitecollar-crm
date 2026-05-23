"use client";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function LeadsTrendChart({ data }: { data: { d: string; n: number }[] }) {
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0b1a33" stopOpacity={0.35}/>
              <stop offset="95%" stopColor="#0b1a33" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f2f6" />
          <XAxis dataKey="d" tick={{ fontSize: 11, fill: "#6b7280" }} />
          <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} allowDecimals={false} />
          <Tooltip />
          <Area type="monotone" dataKey="n" stroke="#0b1a33" strokeWidth={2} fill="url(#g1)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
