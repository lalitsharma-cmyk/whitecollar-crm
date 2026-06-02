"use client";
// QualityScoreCard — Quality Score widget for an individual user.
//
// Shows the composite total prominently (big number + colour band), a small
// horizontal bar per axis, and chips to swap windows (Today / Week / Month).
//
// Privacy: when `viewerRole === "MANAGER"` AND viewer ≠ subject (we infer
// that from the API which omits the wellbeing field), the Wellbeing bar is
// hidden — matches spec §4.
//
// Data lives behind /api/quality/[userId] which enforces the same auth
// rules. We fetch on mount and re-fetch on window change.

import { useEffect, useState } from "react";
import type { QualityBreakdown, QualityWindow } from "@/lib/qualityScore";

type Role = "ADMIN" | "MANAGER" | "AGENT";

interface Props {
  userId: string;
  window: QualityWindow;
  viewerRole: Role;
}

interface ApiResponse extends QualityBreakdown {
  window: QualityWindow;
}

export default function QualityScoreCard({ userId, window: initialWindow, viewerRole }: Props) {
  const [window, setWindow] = useState<QualityWindow>(initialWindow);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/quality/${encodeURIComponent(userId)}?window=${window}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ApiResponse;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "fetch failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, window]);

  // Manager-viewing-report: wellbeing is null even when present, so we
  // also guard at the component level for clarity.
  const hideWellbeing = viewerRole === "MANAGER" && data?.wellbeing === null;

  const band = data ? totalBand(data.total) : { bg: "bg-gray-50", text: "text-gray-700", ring: "ring-gray-300", tone: "amber" as const };

  return (
    <div className={`card p-4 lg:p-5 border-l-4 ${band.tone === "green" ? "border-emerald-500" : band.tone === "amber" ? "border-amber-500" : "border-red-500"} ${band.bg}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg" aria-hidden>📊</span>
        <h2 className="font-bold text-base text-[#0b1a33]">Quality Score</h2>
        <span
          className="ml-auto"
          title="Composite 0-100 measure: Activity 30% + Funnel 35% + Behavioural 25% + Wellbeing 10%"
        >
          <WindowChips value={window} onChange={setWindow} />
        </span>
      </div>

      {err && (
        <div className="text-xs text-red-700">Failed to load score: {err}</div>
      )}

      {loading && !data && (
        <div className="text-xs text-gray-500">Calculating…</div>
      )}

      {data && (
        <>
          {/* Big number + label */}
          <div className="flex items-baseline gap-2 mb-3">
            <div className={`text-5xl font-extrabold leading-none ${band.text}`}>{data.total}</div>
            <div className="text-xs text-gray-500 pb-1">/ 100</div>
            {typeof data.rank === "number" && (
              <div className="ml-auto text-[10px] uppercase tracking-widest text-gray-500 pb-1">
                Rank <b className="text-[#0b1a33] text-sm">#{data.rank}</b>
              </div>
            )}
          </div>

          {/* Axis bars */}
          <div className="space-y-2">
            <AxisBar label="Activity" hint="Connect rate, calls vs target, follow-up completion" value={data.activity} />
            <AxisBar label="Funnel" hint="BANT qualification, won vs pipeline, avg deal value" value={data.funnel} />
            <AxisBar label="Behavioural" hint="Follow-up adherence, no-show rate, hot-lead SLA" value={data.behavioural} />
            {!hideWellbeing && data.wellbeing !== null && (
              <AxisBar
                label="Wellbeing"
                hint="Attendance, mood trend, streak preservation"
                value={data.wellbeing}
                tone="private"
              />
            )}
            {hideWellbeing && (
              <div className="text-[10px] text-gray-400 italic pt-1">
                Wellbeing axis hidden — visible only to the agent.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

function WindowChips({ value, onChange }: { value: QualityWindow; onChange: (w: QualityWindow) => void }) {
  const options: { v: QualityWindow; label: string }[] = [
    { v: "today", label: "Today" },
    { v: "week", label: "Week" },
    { v: "month", label: "Month" },
  ];
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          className={value === o.v ? "on" : ""}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AxisBar({
  label,
  hint,
  value,
  tone,
}: {
  label: string;
  hint: string;
  value: number;
  tone?: "private";
}) {
  // Per-axis colour band — same thresholds as the composite.
  const colour =
    value >= 80 ? "bg-emerald-500" : value >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div title={hint}>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-semibold text-[#0b1a33] inline-flex items-center gap-1">
          {tone === "private" && <span aria-hidden title="Private — only visible to the agent themselves">🔒</span>}
          {label}
        </span>
        <span className="text-gray-700 font-bold">{value}</span>
      </div>
      <div
        className="relative h-2 rounded-full overflow-hidden bg-[#0b1a33]/10 mt-1"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} score`}
      >
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-out rounded-full ${colour}`}
          style={{ width: `${Math.max(2, value)}%` }}
        />
      </div>
    </div>
  );
}

// Inlined here (instead of importing from qualityScore.ts) because this is
// a client component and qualityScore.ts is server-only.
function totalBand(total: number) {
  if (total >= 80) return { tone: "green" as const, bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-300" };
  if (total >= 60) return { tone: "amber" as const, bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-300" };
  return { tone: "red" as const, bg: "bg-red-50", text: "text-red-700", ring: "ring-red-300" };
}
