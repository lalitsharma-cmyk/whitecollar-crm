"use client";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
export default function ConnectRateChart({ data }: { data: { d: string; rate: number }[] }) {
  return (
    <div className="h-[200px] mt-3">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#c9a24b" stopOpacity={0.45}/>
              <stop offset="95%" stopColor="#c9a24b" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#6b7280" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#6b7280" }} unit="%" />
          <Tooltip />
          <Area type="monotone" dataKey="rate" stroke="#c9a24b" strokeWidth={2} fill="url(#gold)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
