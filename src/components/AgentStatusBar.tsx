"use client";
// ────────────────────────────────────────────────────────────────────────────
// Agent field-movement status bar (Lalit, 2026-06-24).
//
// Six big tap-targets agents press on their phone in the field:
//   I Am Here · Leaving Office · Going For Meeting · Returned From Meeting ·
//   Going For Site Visit · Returned From Site Visit
//
// • Mobile-first: 2-col grid on phones → 3-col ≥sm, min 56px tall targets.
// • State-aware: "Returned From X" is disabled until the matching "Going X" is
//   open; while out, a live elapsed timer shows under the bar.
// • Today's events + durations listed below, newest first.
// • Posts to /api/agent-status; "I Am Here" also marks daily attendance.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type Kind =
  | "HERE"
  | "LEAVING_OFFICE"
  | "GOING_MEETING"
  | "RETURNED_MEETING"
  | "GOING_SITE_VISIT"
  | "RETURNED_SITE_VISIT";

interface StatusEvent {
  id: string;
  status: Kind;
  startedAt: string;
  endedAt: string | null;
  durationMin: number | null;
  pairedEventId: string | null;
}

interface Props {
  initialEvents: StatusEvent[];
  initialOpenGoing: StatusEvent | null;
}

const LABEL: Record<Kind, string> = {
  HERE: "I Am Here",
  LEAVING_OFFICE: "Leaving Office",
  GOING_MEETING: "Going For Meeting",
  RETURNED_MEETING: "Returned From Meeting",
  GOING_SITE_VISIT: "Going For Site Visit",
  RETURNED_SITE_VISIT: "Returned From Site Visit",
};

const ICON: Record<Kind, string> = {
  HERE: "📍",
  LEAVING_OFFICE: "🚪",
  GOING_MEETING: "🤝",
  RETURNED_MEETING: "↩️",
  GOING_SITE_VISIT: "🏗️",
  RETURNED_SITE_VISIT: "↩️",
};

function fmtDuration(min: number | null | undefined): string {
  if (min == null) return "";
  if (min <= 0) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtTimeIST(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  })
    .format(new Date(iso))
    .replace(" AM", " am")
    .replace(" PM", " pm");
}

// Live "Xm" elapsed since an ISO start.
function elapsedMin(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000));
}

export default function AgentStatusBar({ initialEvents, initialOpenGoing }: Props) {
  const router = useRouter();
  const [events, setEvents] = useState<StatusEvent[]>(initialEvents);
  const [openGoing, setOpenGoing] = useState<StatusEvent | null>(initialOpenGoing);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);

  // Tick every 30s so the "out for Xm" timer stays live.
  useEffect(() => {
    if (!openGoing) return;
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [openGoing]);

  const post = useCallback(
    async (status: Kind) => {
      if (busy) return;
      setBusy(status);
      try {
        const r = await fetch("/api/agent-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (r.ok) {
          const data = await r.json();
          setEvents(data.events ?? []);
          setOpenGoing(data.openGoing ?? null);
          setNowMs(Date.now());
          // Confirmation toast (with duration on a Returned tap).
          if (data.pairedClosed && data.durationMin != null) {
            setToast(`${LABEL[status]} — ${fmtDuration(data.durationMin)}`);
          } else {
            setToast(`✓ ${LABEL[status]} logged`);
          }
          // I Am Here also marks attendance → refresh the dashboard so the
          // attendance card / greeting update without a manual reload.
          if (status === "HERE") router.refresh();
          window.setTimeout(() => setToast(null), 3500);
        } else {
          setToast("Could not log — try again");
          window.setTimeout(() => setToast(null), 3000);
        }
      } catch {
        setToast("Network error — try again");
        window.setTimeout(() => setToast(null), 3000);
      } finally {
        setBusy(null);
      }
    },
    [busy, router],
  );

  const meetingOpen = openGoing?.status === "GOING_MEETING";
  const siteOpen = openGoing?.status === "GOING_SITE_VISIT";
  const outMin = openGoing ? elapsedMin(openGoing.startedAt, nowMs) : 0;

  // Per-button enable/label tweaks. Tones for the meeting / site-visit actions
  // are aligned with the central Action Design System (src/lib/actionDesign.ts):
  // meeting = purple, siteVisit = indigo — so these status buttons share the same
  // colour language as the meeting / site-visit actions elsewhere. (Was blue /
  // violet.) HERE keeps emerald (the "call/positive" green), LEAVING keeps slate
  // (the neutral/snooze grey). Behaviour/endpoints unchanged.
  const buttons: { kind: Kind; tone: string; disabled: boolean }[] = [
    { kind: "HERE", tone: "emerald", disabled: false },
    { kind: "LEAVING_OFFICE", tone: "slate", disabled: false },
    { kind: "GOING_MEETING", tone: "meeting", disabled: meetingOpen },
    { kind: "RETURNED_MEETING", tone: "meeting", disabled: !meetingOpen },
    { kind: "GOING_SITE_VISIT", tone: "siteVisit", disabled: siteOpen },
    { kind: "RETURNED_SITE_VISIT", tone: "siteVisit", disabled: !siteOpen },
  ];

  // Mirrors the meeting / siteVisit / call (emerald) / snooze (slate) token
  // colours so the field-status bar matches the rest of the CRM in both themes.
  const toneClass: Record<string, string> = {
    emerald: "border-emerald-600 bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 text-white",
    slate: "border-slate-500 bg-slate-600 hover:bg-slate-700 dark:hover:bg-slate-500 text-white",
    meeting: "border-purple-600 bg-purple-600 hover:bg-purple-700 dark:hover:bg-purple-500 text-white",
    siteVisit: "border-indigo-600 bg-indigo-600 hover:bg-indigo-700 dark:hover:bg-indigo-500 text-white",
  };

  return (
    <div className="card p-3 sm:p-4 border-l-4 border-[#c9a24b]">
      <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
        <div className="text-sm font-bold text-[#0b1a33] dark:text-amber-200">📲 My Field Status</div>
        {openGoing ? (
          <span className="chip chip-warm">
            {openGoing.status === "GOING_MEETING" ? "🤝 In meeting" : "🏗️ On site visit"} · {fmtDuration(outMin)}
          </span>
        ) : (
          <span className="text-[11px] text-gray-400 dark:text-slate-500">tap to log your movement</span>
        )}
      </div>

      {/* 6 buttons — 2-col on phones, 3-col ≥sm. Large tap targets. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {buttons.map(({ kind, tone, disabled }) => (
          <button
            key={kind}
            onClick={() => post(kind)}
            disabled={disabled || busy !== null}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl border min-h-[56px] px-2 py-2.5 text-xs sm:text-sm font-bold leading-tight text-center shadow-sm transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${toneClass[tone]}`}
            aria-label={LABEL[kind]}
          >
            <span className="text-lg leading-none">{ICON[kind]}</span>
            <span>{busy === kind ? "…" : LABEL[kind]}</span>
          </button>
        ))}
      </div>

      {/* Confirmation toast */}
      {toast && (
        <div className="mt-2 text-center text-xs font-semibold text-emerald-700 dark:text-emerald-300">{toast}</div>
      )}

      {/* Today's movements */}
      {events.length > 0 && (
        <div className="mt-3 border-t border-[#eef0f3] dark:border-slate-700 pt-2">
          <div className="text-[10px] font-bold tracking-widest text-gray-400 dark:text-slate-500 uppercase mb-1.5">
            Today&apos;s movements
          </div>
          <ul className="space-y-1">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span>{ICON[e.status]}</span>
                  <span className="font-medium text-gray-700 dark:text-slate-200 truncate">{LABEL[e.status]}</span>
                </span>
                <span className="text-gray-400 dark:text-slate-500 whitespace-nowrap">
                  {fmtTimeIST(e.startedAt)}
                  {e.durationMin != null && (
                    <span className="ml-1.5 font-semibold text-amber-600 dark:text-amber-400">· {fmtDuration(e.durationMin)}</span>
                  )}
                  {e.status.startsWith("GOING_") && e.endedAt === null && (
                    <span className="ml-1.5 font-semibold text-blue-600 dark:text-blue-400">· out</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
