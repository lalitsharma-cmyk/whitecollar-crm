"use client";
interface Props { count: number; target: number }
export default function CallTargetWidget({ count, target }: Props) {
  const pct = Math.min(100, Math.round((count / target) * 100));
  const label = count >= target ? "🎯 Target hit!" : count >= target * 0.75 ? "💪 Almost there!" : count >= target * 0.5 ? "🔥 Halfway!" : "📞 Keep dialing!";
  const barColor = count >= target ? "bg-emerald-500" : count >= target * 0.5 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="card p-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-semibold text-sm">Today&apos;s Call Target</h3>
        <span className="text-xs text-gray-500">{count} / {target}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
        <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-600">{label}</p>
    </div>
  );
}
