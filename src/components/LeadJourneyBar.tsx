"use client";

/**
 * LeadJourneyBar — compact horizontal pipeline progress bar.
 *
 * Shows the 8 ordered stages (NEW → WON) as dots connected by lines.
 * - Completed stages: filled emerald dot + solid line
 * - Current stage: filled gold dot (#c9a24b), label bold
 * - Future stages: hollow gray dot
 * - LOST: small red "Closed Lost" chip rendered after the current stage dot
 *
 * Mobile (< lg): condenses to "Stage Name  •  Step N of 8"
 * Desktop: full horizontal dot-and-line bar with labels below
 */

const STAGES = [
  { value: "NEW",          label: "New" },
  { value: "CONTACTED",    label: "Called" },
  { value: "QUALIFIED",    label: "Qualified" },
  { value: "SITE_VISIT",   label: "Site Visit" },
  { value: "NEGOTIATION",  label: "Negotiation" },
  { value: "EOI",          label: "EOI" },
  { value: "BOOKING_DONE", label: "Booking" },
  { value: "WON",          label: "Won" },
] as const;

type StageValue = typeof STAGES[number]["value"];

function resolveStageIndex(status: string): number {
  const idx = STAGES.findIndex((s) => s.value === status);
  return idx >= 0 ? idx : 0;
}

export default function LeadJourneyBar({ status }: { status: string }) {
  const isLost = status === "LOST";

  // For LOST, we don't have a definitive "last known stage" from the status
  // field alone, so we show the bar at index 0 with the LOST chip. The stage
  // the lead was actually at when lost is stored in activities, but that would
  // require a DB call — for display purposes showing stage 0 + LOST chip is
  // accurate and consistent with spec.
  const currentIndex = isLost ? 0 : resolveStageIndex(status);
  const currentStage = STAGES[currentIndex];

  // ─── Mobile summary (hidden on md+, i.e. tablets and desktop) ──────────
  const mobileSummary = (
    <div className="md:hidden flex items-center gap-2 text-sm py-1">
      <span className="font-semibold" style={{ color: isLost ? "#dc2626" : "#c9a24b" }}>
        {isLost ? "Closed Lost" : currentStage.label}
      </span>
      {!isLost && (
        <span className="text-gray-400 dark:text-slate-500 text-xs">
          Step {currentIndex + 1} of {STAGES.length}
        </span>
      )}
      {isLost && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold"
          style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5" }}
        >
          LOST
        </span>
      )}
    </div>
  );

  // ─── Full bar (shown on md+: tablets and desktop) ───────────────────────
  const desktopBar = (
    <div className="hidden md:block w-full overflow-x-auto" aria-label="Lead pipeline progress">
      <div className="flex items-start min-w-max">
        {STAGES.map((stage, i) => {
          const isCompleted = i < currentIndex;
          const isCurrent = i === currentIndex && !isLost;
          const isLostCurrent = i === currentIndex && isLost;
          const isFuture = i > currentIndex;
          const isLast = i === STAGES.length - 1;

          // Dot styles
          let dotBg = "#e5e7eb"; // gray — future / hollow
          let dotBorder = "#d1d5db";
          let dotInner: React.ReactNode = null;

          if (isCompleted) {
            dotBg = "#10b981"; // emerald
            dotBorder = "#059669";
            dotInner = (
              <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            );
          } else if (isCurrent) {
            dotBg = "#c9a24b"; // brand gold
            dotBorder = "#b08d3a";
          } else if (isLostCurrent) {
            dotBg = "#fee2e2"; // light red bg
            dotBorder = "#f87171";
          }

          // Connector line (left side of dot, skip for first item)
          const lineCompleted = i > 0 && i <= currentIndex;
          const lineColor = lineCompleted ? "#10b981" : "#e5e7eb";

          return (
            <div key={stage.value} className="flex flex-col items-center">
              {/* Row: line + dot */}
              <div className="flex items-center">
                {/* Left connector */}
                {i > 0 && (
                  <div
                    className="h-0.5 w-8"
                    style={{ background: lineColor }}
                  />
                )}

                {/* Dot */}
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{
                    background: dotBg,
                    border: `2px solid ${dotBorder}`,
                  }}
                  title={stage.label}
                >
                  {dotInner}
                  {isCurrent && (
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: "#fff" }}
                    />
                  )}
                </div>

                {/* Right connector (only for non-last items, drawn on left of next) */}
                {/* We draw connectors on the LEFT side to keep alignment simple */}
              </div>

              {/* Label + LOST chip below dot */}
              <div className="mt-1.5 flex flex-col items-center gap-0.5" style={{ width: "4.5rem" }}>
                <span
                  className={`text-center leading-tight ${
                    isCurrent
                      ? "text-[11px] font-bold"
                      : "text-[10px] font-normal text-gray-500 dark:text-slate-400"
                  }`}
                  style={isCurrent ? { color: "#c9a24b" } : undefined}
                >
                  {stage.label}
                </span>
                {/* LOST chip — rendered below the current-position label */}
                {isLostCurrent && (
                  <span
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap"
                    style={{
                      background: "#fef2f2",
                      color: "#dc2626",
                      border: "1px solid #fca5a5",
                    }}
                  >
                    Closed Lost
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="w-full">
      {mobileSummary}
      {desktopBar}
    </div>
  );
}
