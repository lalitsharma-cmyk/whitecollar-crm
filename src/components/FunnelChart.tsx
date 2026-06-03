"use client";

export interface FunnelStage {
  label: string;
  count: number;
  percent: number;
}

const STAGE_COLORS: Record<string, string> = {
  NEW:          "bg-blue-200",
  CONTACTED:    "bg-blue-300",
  QUALIFIED:    "bg-blue-400",
  SITE_VISIT:   "bg-blue-500",
  NEGOTIATION:  "bg-blue-600",
  EOI:          "bg-blue-700",
  BOOKING_DONE: "bg-indigo-600",
  WON:          "bg-emerald-500",
};

const STAGE_TEXT: Record<string, string> = {
  NEW:          "text-blue-900",
  CONTACTED:    "text-blue-900",
  QUALIFIED:    "text-white",
  SITE_VISIT:   "text-white",
  NEGOTIATION:  "text-white",
  EOI:          "text-white",
  BOOKING_DONE: "text-white",
  WON:          "text-white",
};

export default function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  if (!stages || stages.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-gray-400 italic">
        No pipeline data yet.
      </div>
    );
  }

  return (
    <div className="w-full space-y-1.5">
      {stages.map((stage) => {
        const barWidth = Math.max(4, stage.percent);
        const bgClass = STAGE_COLORS[stage.label] ?? "bg-blue-400";
        const textClass = STAGE_TEXT[stage.label] ?? "text-white";
        const displayLabel = stage.label.replace(/_/g, " ");
        return (
          <div key={stage.label} className="flex items-center gap-2 text-xs">
            {/* Stage label — fixed width so bars align */}
            <span className="w-28 shrink-0 text-right text-gray-600 font-medium truncate">
              {displayLabel}
            </span>

            {/* Bar track */}
            <div className="flex-1 bg-gray-100 rounded-sm overflow-hidden h-6 relative">
              <div
                className={`h-full rounded-sm flex items-center px-2 transition-all duration-300 ${bgClass}`}
                style={{ width: `${barWidth}%` }}
              >
                {/* Show count inside bar only when it's wide enough */}
                {barWidth >= 12 && (
                  <span className={`font-semibold text-[10px] select-none ${textClass}`}>
                    {stage.count}
                  </span>
                )}
              </div>
            </div>

            {/* Count on the right (always visible) */}
            <span className="w-10 shrink-0 text-right font-semibold text-gray-700">
              {stage.count}
            </span>

            {/* Percent label */}
            <span className="w-10 shrink-0 text-right text-gray-400">
              {stage.percent > 0 ? `${Math.round(stage.percent)}%` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
