// TodaysInterviews — the "Today's Interviews" section of the HR dashboard
// (spec item 5). One card per interview scheduled for today, in time order, each
// surfacing the four facts a recruiter needs at a glance — Time, Name, Position,
// Type — plus a confirmation chip and the actions that move the interview along.
//
// PRESENTATIONAL ONLY. This is a server component (no "use client"): every field
// arrives via props and it never fetches or queries. The single interactive
// control — Mark Completed (and its Reschedule / Record-Result siblings) — is
// delegated to the existing HRInterviewRowActions client island, which owns the
// PATCH to /api/hr/candidates/[id]/interview. Call / WhatsApp / Open are plain
// links rendered through the shared Action Design primitives.
//
// Colour coding (spec item 3):
//   • INDIGO = "Interviews Today" is the info-variant accent for this section, so
//     the header icon + count chip read indigo.
//   • Confirmation chips use the pending/confirmed semantics: CONFIRMED →
//     green (bg-green-100 text-green-700), everything still unconfirmed →
//     amber (bg-amber-100 text-amber-700); cancelled reads rose (urgent/negative).
//   • Action icons are NEVER hand-rolled — Call/WhatsApp/Open come from
//     ACTION_TOKENS via <ActionIconButton> (emerald / WhatsApp-green / slate).
//   • GREEN empty-state ("all caught up") when there are no interviews today.
// Every colour ships dark: variants. No emoji — Lucide icons only.

import Link from "next/link";
import { CalendarCheck2, Clock, Briefcase, ExternalLink } from "lucide-react";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
import HRInterviewRowActions from "@/components/HRInterviewRowActions";

export interface TodaysInterviewItem {
  interviewId: string;
  candidateId: string;
  name: string;
  position: string | null;
  type: string;
  timeIso: string;
  confirmationStatus: string;
  attendanceStatus: string;
  phone: string | null;
  whatsappPhone: string | null;
}

export interface TodaysInterviewsProps {
  items: TodaysInterviewItem[];
}

// Format the HRInterviewType enum into a readable label (spec: "Type (formatted)").
function formatType(type: string): string {
  switch (type) {
    case "VIRTUAL":
      return "Virtual";
    case "HR":
      return "HR Round";
    case "FINAL":
      return "Final";
    case "FACE_TO_FACE":
      return "Face to Face";
    default:
      return type
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

// Confirmation chip — pending/waiting (amber) vs confirmed/positive (green),
// with rose for the negative CANCELLED outcome. Always carries dark: variants.
function confirmVisual(status: string): { label: string; classes: string } {
  switch (status) {
    case "CONFIRMED":
      return {
        label: "Confirmed",
        classes:
          "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300 dark:border dark:border-green-500/60",
      };
    case "CANCELLED":
      return {
        label: "Cancelled",
        classes:
          "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300 dark:border dark:border-rose-500/60",
      };
    case "RESCHEDULED":
      return {
        label: "Rescheduled",
        classes:
          "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border dark:border-amber-500/60",
      };
    case "NOT_REACHABLE":
      return {
        label: "Not Reachable",
        classes:
          "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border dark:border-amber-500/60",
      };
    case "NOT_CONFIRMED":
      return {
        label: "Not Confirmed",
        classes:
          "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border dark:border-amber-500/60",
      };
    case "PENDING":
    default:
      return {
        label: "Pending",
        classes:
          "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border dark:border-amber-500/60",
      };
  }
}

// Render the IST time-of-day for the interview (e.g. "3:30 PM").
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

export function TodaysInterviews({ items }: TodaysInterviewsProps) {
  return (
    <section
      id="interviews-today"
      aria-label="Today's Interviews"
      className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
    >
      {/* Section header — indigo info accent (spec item 3). */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
          <CalendarCheck2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          Today&apos;s Interviews
        </h2>
        <span className="inline-flex items-center justify-center min-w-6 px-2 h-6 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border dark:border-indigo-500/60">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        // Healthy / "all caught up" empty state — green (spec item 3).
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-500/60 px-3 py-4 text-sm text-green-700 dark:text-green-300">
          <CalendarCheck2 className="w-4 h-4 shrink-0" />
          No interviews scheduled for today — all caught up.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const confirm = confirmVisual(it.confirmationStatus);
            const candidateHref = `/hr/candidates/${it.candidateId}`;
            const callPhone = it.phone ?? undefined;
            const waDigits = (it.whatsappPhone ?? it.phone ?? "").replace(
              /\D/g,
              "",
            );
            return (
              <li
                key={it.interviewId}
                className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: time + identity */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        {formatTime(it.timeIso)}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${confirm.classes}`}
                      >
                        {confirm.label}
                      </span>
                    </div>
                    <Link
                      href={candidateHref}
                      className="block mt-1 text-sm font-semibold text-gray-900 dark:text-white truncate hover:underline"
                    >
                      {it.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-600 dark:text-slate-300 flex-wrap">
                      {it.position && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <Briefcase className="w-3 h-3 shrink-0" />
                          {it.position}
                        </span>
                      )}
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 font-medium">
                        {formatType(it.type)}
                      </span>
                    </div>
                  </div>

                  {/* Right: quick link actions — token-driven, never hand-rolled */}
                  <div className="flex items-center gap-1 shrink-0">
                    {callPhone && (
                      <ActionIconButton
                        action="call"
                        href={`tel:${callPhone}`}
                        size="sm"
                      />
                    )}
                    {waDigits && (
                      <ActionIconButton
                        action="whatsapp"
                        href={`https://wa.me/${waDigits}`}
                        size="sm"
                        external
                      />
                    )}
                    <Link
                      href={candidateHref}
                      title="Open candidate"
                      aria-label="Open candidate"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>

                {/* Mark Completed (+ Reschedule / Record Result) via the existing
                    client island. It owns the PATCH; we only pass the props it
                    needs. Phone falls through to its own Call/WA fallbacks too. */}
                <div className="mt-2 pt-2 border-t border-gray-200/70 dark:border-slate-700/70">
                  <HRInterviewRowActions
                    interviewId={it.interviewId}
                    candidateId={it.candidateId}
                    phone={it.phone}
                    attendanceStatus={it.attendanceStatus}
                    scheduledAt={it.timeIso}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default TodaysInterviews;
