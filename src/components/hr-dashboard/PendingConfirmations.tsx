// PendingConfirmations — the "Pending Confirmation" section of the redesigned HR
// dashboard (docs/HR-DASHBOARD-REDESIGN-SPEC.md item 6). One card per scheduled
// FUTURE interview whose confirmationStatus is still PENDING — i.e. the candidate
// has an interview booked but has not yet confirmed they will attend. The
// recruiter's job here is to chase that confirmation, so each card surfaces Name,
// Position, the scheduled date + time, and a human "in N days / hours" relative
// label, with the quick actions that resolve it: Call, WhatsApp, Confirm,
// Reschedule.
//
// This is DISTINCT from two neighbours and deliberately does not duplicate them:
//   • the Pending-Confirmations KPI tile (count only, top Action Center), and
//   • TodaysInterviews (the today window — Mark Completed / Record Result).
// Here the window is the future and the verb is "confirm".
//
// PRESENTATIONAL ONLY. This is a SERVER component (no "use client"): it fetches
// nothing and queries nothing — every field arrives pre-shaped via `items`, and
// the caller decides scope (Junior HR = own candidates only via
// hrActiveScopeWhere) before handing the list down. `scheduledIso` and
// `relativeLabel` are computed upstream; we only render them.
//
// Behaviour:
//   • Call     → tel:<phone>             (ActionIconButton, emerald — ACTION_TOKENS)
//   • WhatsApp → https://wa.me/<digits>  (ActionIconButton, brand green — ACTION_TOKENS)
//   • Confirm + Reschedule → the existing HRInterviewRowActions client island,
//        which owns the PATCH to /api/hr/candidates/[id]/interview. We only pass
//        the props it needs; we never re-implement the mutation here.
//   • Open → /hr/candidates/<id>         (link into the detail page)
//
// Colour coding (spec item 3): ORANGE/AMBER = pending/waiting — the section accent,
// the count chip, and the unconfirmed interview chip (bg-amber-100 text-amber-700).
// GREEN/EMERALD = healthy "all caught up" empty state. Action icons are NEVER
// hand-rolled — Call/WhatsApp come from ACTION_TOKENS via <ActionIconButton>; the
// Open link uses a slate Lucide mark. Every colour ships dark: variants matching
// the existing HR card conventions. No emoji — Lucide icons only.

import Link from "next/link";
import { Hourglass, Clock, Briefcase, ArrowUpRight } from "lucide-react";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
import HRInterviewRowActions from "@/components/HRInterviewRowActions";

export interface PendingConfirmItem {
  interviewId: string;
  candidateId: string;
  name: string;
  position: string | null;
  scheduledIso: string;
  relativeLabel: string;
  phone: string | null;
  whatsappPhone: string | null;
  attendanceStatus: string;
}

export interface PendingConfirmationsProps {
  items: PendingConfirmItem[];
}

// wa.me wants bare digits — strip everything else, matching the existing HR
// row-action convention (HRInterviewRowActions / CallNowQueue).
function waDigits(p: string): string {
  return p.replace(/\D/g, "");
}

// Render the IST date + time of the scheduled interview (e.g. "Mon, 30 Jun · 3:30 PM").
function formatSchedule(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const time = d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
  return `${date} · ${time}`;
}

export function PendingConfirmations({ items }: PendingConfirmationsProps) {
  return (
    <section
      id="pending-confirmations"
      aria-label="Pending Confirmation"
      className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
    >
      {/* Section header — ORANGE/AMBER pending accent (spec item 3). */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
          <Hourglass className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          Pending Confirmation
        </h2>
        <span className="inline-flex items-center justify-center min-w-6 px-2 h-6 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border dark:border-amber-500/60">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        // Healthy / "all caught up" empty state — green (spec item 3).
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-500/60 px-3 py-4 text-sm text-green-700 dark:text-green-300">
          <Hourglass className="w-4 h-4 shrink-0" />
          No interviews awaiting confirmation — all caught up.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const candidateHref = `/hr/candidates/${it.candidateId}`;
            const callPhone = it.phone ?? undefined;
            const waPhone = it.whatsappPhone ?? it.phone;
            return (
              <li
                key={it.interviewId}
                className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: schedule + identity */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-300">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        {formatSchedule(it.scheduledIso)}
                      </span>
                      {/* Unconfirmed chip — amber per spec item 3. */}
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border dark:border-amber-500/60">
                        Unconfirmed
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
                      {/* Relative "in N days/hours" label — amber pending accent. */}
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 font-medium">
                        {it.relativeLabel}
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
                        title="Call"
                      />
                    )}
                    {waPhone && (
                      <ActionIconButton
                        action="whatsapp"
                        href={`https://wa.me/${waDigits(waPhone)}`}
                        size="sm"
                        external
                        title="WhatsApp"
                      />
                    )}
                    <Link
                      href={candidateHref}
                      title="Open"
                      aria-label="Open candidate"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>

                {/* Confirm + Reschedule via the existing client island. It owns
                    the PATCH to /api/hr/candidates/[id]/interview; we only pass
                    the props it needs. Phone falls through to its own Call/WA
                    fallbacks too. */}
                <div className="mt-2 pt-2 border-t border-gray-200/70 dark:border-slate-700/70">
                  <HRInterviewRowActions
                    interviewId={it.interviewId}
                    candidateId={it.candidateId}
                    phone={it.phone}
                    attendanceStatus={it.attendanceStatus}
                    scheduledAt={it.scheduledIso}
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

export default PendingConfirmations;
