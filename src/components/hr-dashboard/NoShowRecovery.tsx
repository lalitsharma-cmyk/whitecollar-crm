// NoShowRecovery — the "No-Show Recovery" queue of the redesigned HR dashboard
// (docs/HR-DASHBOARD-REDESIGN-SPEC.md item 7). It is the recruiter's worklist of
// candidates who failed to attend a scheduled interview (attendanceStatus =
// NO_SHOW), latest miss per candidate, capped at 10 — the people most worth
// chasing back into the pipeline before they ghost for good.
//
// Each card surfaces Name, the missed interview type + date, a days-since label,
// and the missed reason when one was captured. A tight quick-action row follows —
// Call, WhatsApp, Voice Note, Reschedule, Email, Resume, Open — so the recruiter
// can recover the candidate without leaving the dashboard.
//
// PRESENTATIONAL ONLY. This is a SERVER component (no "use client"): it fetches
// nothing, queries nothing and computes no business state. Every field — including
// `daysSince` — arrives pre-shaped via `items`, and the caller decides scope
// (Junior HR = own candidates only via hrActiveScopeWhere) before handing the
// list down. We only render.
//
// Behaviour is carried entirely by hrefs so the card needs no client island:
//   • Call       → tel:<phone>                              (ActionIconButton, emerald)
//   • WhatsApp   → https://wa.me/<digits>                   (ActionIconButton, brand green)
//   • Email      → mailto:<address> is not available here; Email/Voice Note/
//     Reschedule/Open all link into /hr/candidates/<id> where the recorder,
//     scheduler and mail composer live.
//   • Resume     → /api/hr/candidates/<id>/resume           (download link)
// Action icons come from ACTION_TOKENS via ActionIconButton (emerald = call,
// green = whatsapp) and Lucide marks for the detail-page links (Mic = voice note,
// purple RotateCcw = reschedule, slate ArrowUpRight = open) — colours are not
// overridden.
//
// Colour coding (spec item 3): RED = urgent — a No-Show is an overdue recovery,
// so the section header reads rose/red and each card carries the No-Show accent
// (border-l-4 border-red-500). GREEN/EMERALD = healthy "all caught up" empty
// state. Every colour ships a dark: variant matching the existing HR card
// conventions. No emoji — Lucide icons only.

import Link from "next/link";
import {
  Ban,
  AlertTriangle,
  CalendarX2,
  Clock,
  Mic,
  RotateCcw,
  Mail,
  FileText,
  ArrowUpRight,
  CheckCircle2,
} from "lucide-react";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
import { fmtISTDate } from "@/lib/datetime";

export interface NoShowItem {
  interviewId: string;
  candidateId: string;
  name: string;
  type: string;
  missedIso: string;
  daysSince: number;
  reason: string | null;
  phone: string | null;
  whatsappPhone: string | null;
}

export interface NoShowRecoveryProps {
  items: NoShowItem[];
}

// wa.me wants bare digits — strip everything else, matching the existing HR
// row-action convention (CallNowQueue / HRInterviewRowActions).
function waDigits(p: string): string {
  return p.replace(/\D/g, "");
}

// Format the HRInterviewType enum into a readable label (mirrors TodaysInterviews).
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

// "today" / "yesterday" / "N days ago" — keeps the recovery urgency legible
// without a timestamp. daysSince is computed upstream; we only label it.
function daysSinceLabel(n: number): string {
  if (n <= 0) return "Missed today";
  if (n === 1) return "Missed yesterday";
  return `Missed ${n} days ago`;
}

export function NoShowRecovery({ items }: NoShowRecoveryProps) {
  return (
    <section
      aria-label="No-Show Recovery"
      className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Section header — rose/red urgency accent (spec item 3). */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 shrink-0">
            <Ban className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">
              No-Show Recovery
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight">
              Missed interviews — recover before they ghost
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            <AlertTriangle className="w-3 h-3" />
            {items.length}
          </span>
        )}
      </div>

      {/* Empty state — all caught up (GREEN / healthy per spec item 3). */}
      {items.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 mb-2">
            <CheckCircle2 className="w-5 h-5" />
          </span>
          <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">
            All caught up
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            No missed interviews to recover right now.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {items.map((it) => {
            const detailHref = `/hr/candidates/${it.candidateId}`;
            const resumeHref = `/api/hr/candidates/${it.candidateId}/resume`;
            const waPhone = it.whatsappPhone ?? it.phone;
            return (
              <li
                key={it.interviewId}
                // No-Show accent — RED left border (spec item 3).
                className="border-l-4 border-red-500 px-4 py-3 hover:bg-gray-50/70 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  {/* ── Identity + missed interview + days-since + reason ── */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={detailHref}
                        className="text-sm font-semibold text-gray-900 dark:text-white hover:text-rose-700 dark:hover:text-rose-400 truncate"
                      >
                        {it.name}
                      </Link>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300 dark:border dark:border-rose-500/60">
                        <Ban className="w-3 h-3" />
                        No Show
                      </span>
                    </div>

                    {/* Missed interview type + date */}
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-600 dark:text-slate-300">
                      <CalendarX2 className="w-3.5 h-3.5 shrink-0 text-rose-500 dark:text-rose-400" />
                      <span className="font-medium">{formatType(it.type)}</span>
                      <span className="text-gray-400 dark:text-slate-500">·</span>
                      <span>{fmtISTDate(it.missedIso)}</span>
                    </p>

                    {/* Days-since label — RED urgency (spec item 3). */}
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                      <Clock className="w-3 h-3 shrink-0" />
                      {daysSinceLabel(it.daysSince)}
                    </p>

                    {/* Missed reason — only when captured. */}
                    {it.reason && (
                      <p className="mt-1 text-xs text-gray-700 dark:text-slate-300 line-clamp-2">
                        <span className="font-medium text-gray-500 dark:text-slate-400">
                          Reason:
                        </span>{" "}
                        {it.reason}
                      </p>
                    )}
                  </div>

                  {/* ── Quick actions: Call, WhatsApp, Voice Note, Reschedule,
                       Email, Resume, Open ── */}
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    {it.phone && (
                      <ActionIconButton
                        action="call"
                        href={`tel:${it.phone}`}
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
                      href={detailHref}
                      title="Voice Note"
                      aria-label="Voice Note"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-[#7a5c00] hover:bg-[#fcd34d]/25 dark:text-[#fcd34d] dark:hover:bg-[#fcd34d]/15"
                    >
                      <Mic className="w-3.5 h-3.5" />
                    </Link>
                    <Link
                      href={detailHref}
                      title="Reschedule"
                      aria-label="Reschedule interview"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Link>
                    <Link
                      href={detailHref}
                      title="Email"
                      aria-label="Email candidate"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                    >
                      <Mail className="w-3.5 h-3.5" />
                    </Link>
                    <a
                      href={resumeHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Resume"
                      aria-label="Open resume"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </a>
                    <Link
                      href={detailHref}
                      title="Open"
                      aria-label="Open candidate"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default NoShowRecovery;
