// ExpectedJoinings — the "Expected Joinings" section of the redesigned HR
// dashboard (docs/HR-DASHBOARD-REDESIGN-SPEC.md item 8). One card per candidate
// who has been offered and is expected to join: it surfaces the Joining Date, the
// candidate Name + Position, a days-until-joining countdown, the owning recruiter
// (when shown), and the offer/status chip — so the recruiter can keep every
// upcoming joiner on track and chase the last documents before the start date.
//
// PRESENTATIONAL ONLY. This is a SERVER component (no "use client"): it fetches
// nothing, queries nothing and computes no business state. Every field —
// including `daysUntil` — arrives pre-shaped via `items`, and the caller decides
// scope (Junior HR = own candidates only via hrActiveScopeWhere; Admin/Senior =
// all) and `showOwner` before handing the list down. We only render.
//
// Behaviour is carried entirely by hrefs so the card needs no client island:
//   • Send Reminder → https://wa.me/<digits>   (ActionIconButton, brand green) —
//        the WhatsApp nudge for documents / joining confirmation called out by
//        the spec; falls back to the candidate's primary phone.
//   • Call          → tel:<phone>              (ActionIconButton, emerald)
//   • Voice Note + Schedule + Open → /hr/candidates/<id> where the recorder,
//        scheduler and the rest of the joining workflow live.
//   • Email         → /hr/candidates/<id>      (composer lives on the detail page)
//   • Resume        → /api/hr/candidates/<id>/resume   (download link)
// Call/WhatsApp icons come from ACTION_TOKENS via <ActionIconButton> (emerald =
// call, brand green = whatsapp) and Lucide marks drive the detail-page links
// (Mic = voice note, purple Calendar = schedule, slate ArrowUpRight = open) —
// colours are never overridden.
//
// Colour coding (spec item 3): GREEN/EMERALD = healthy/positive — Expected
// Joinings is a positive pipeline signal, so the section header, the count chip,
// the joining-date callout and each card's left accent (border-l-4
// border-emerald-500) read emerald/green. The empty state ("nobody joining yet")
// is a calm neutral rather than the urgent "all caught up". Documents-pending is
// the one exception — an AMBER flag (pending/waiting per spec item 3) — surfaced
// only when provided. Status chips ALWAYS go through statusColor()/statusLabel()
// from hrStatus.ts. Every colour ships a dark: variant matching the existing HR
// card conventions. No emoji — Lucide icons only.

import Link from "next/link";
import {
  Handshake,
  CalendarCheck2,
  Clock,
  Briefcase,
  User as UserIcon,
  AlertTriangle,
  Mic,
  Calendar as CalendarIcon,
  Mail,
  FileText,
  ArrowUpRight,
  Inbox,
} from "lucide-react";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
import { statusColor, statusLabel } from "@/lib/hrStatus";
import { fmtISTDate } from "@/lib/datetime";

export interface ExpectedJoiningItem {
  candidateId: string;
  name: string;
  position: string | null;
  status: string;
  joiningIso: string | null;
  daysUntil: number | null;
  ownerFirstName: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  // Optional: when the caller knows documents are still outstanding it can flag
  // the card. Absent / false = no flag rendered.
  documentsPending?: boolean;
}

export interface ExpectedJoiningsProps {
  items: ExpectedJoiningItem[];
  showOwner: boolean;
}

// wa.me wants bare digits — strip everything else, matching the existing HR
// row-action convention (NoShowRecovery / CallNowQueue / HRInterviewRowActions).
function waDigits(p: string): string {
  return p.replace(/\D/g, "");
}

// "Joining today" / "Joining tomorrow" / "Joins in N days" / "N days overdue" —
// keeps the countdown legible. daysUntil is computed upstream; we only label it.
function countdownLabel(n: number | null): string {
  if (n === null) return "Date to be confirmed";
  if (n < 0) {
    const d = Math.abs(n);
    return d === 1 ? "Joining 1 day overdue" : `Joining ${d} days overdue`;
  }
  if (n === 0) return "Joining today";
  if (n === 1) return "Joining tomorrow";
  return `Joins in ${n} days`;
}

export function ExpectedJoinings({ items, showOwner }: ExpectedJoiningsProps) {
  return (
    <section
      id="expected-joinings"
      aria-label="Expected Joinings"
      className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Section header — GREEN/EMERALD positive accent (spec item 3). */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 shrink-0">
            <Handshake className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">
              Expected Joinings
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight">
              Offered candidates due to join — keep them on track
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border dark:border-emerald-500/60">
            <CalendarCheck2 className="w-3 h-3" />
            {items.length}
          </span>
        )}
      </div>

      {/* Empty state — calm neutral: no upcoming joiners is not a backlog. */}
      {items.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 mb-2">
            <Inbox className="w-5 h-5" />
          </span>
          <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">
            No expected joinings
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            Released offers with a joining date will appear here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {items.map((it) => {
            const detailHref = `/hr/candidates/${it.candidateId}`;
            const resumeHref = `/api/hr/candidates/${it.candidateId}/resume`;
            const waPhone = it.whatsappPhone ?? it.phone;
            const overdue = it.daysUntil !== null && it.daysUntil < 0;
            return (
              <li
                key={it.candidateId}
                // Positive pipeline accent — EMERALD left border (spec item 3).
                className="border-l-4 border-emerald-500 px-4 py-3 hover:bg-gray-50/70 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  {/* ── Joining date + identity + countdown + owner + flags ── */}
                  <div className="min-w-0 flex-1">
                    {/* Joining date callout — emerald positive accent. */}
                    <p className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      <CalendarCheck2 className="w-3.5 h-3.5 shrink-0" />
                      {it.joiningIso ? fmtISTDate(it.joiningIso) : "Joining date TBC"}
                    </p>

                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <Link
                        href={detailHref}
                        className="text-sm font-semibold text-gray-900 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-400 truncate"
                      >
                        {it.name}
                      </Link>
                      {/* Offer / status chip — ALWAYS via hrStatus.ts tokens. */}
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor(
                          it.status,
                        )}`}
                      >
                        {statusLabel(it.status)}
                      </span>
                    </div>

                    {/* Position + owner */}
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-600 dark:text-slate-300 flex-wrap">
                      {it.position && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <Briefcase className="w-3 h-3 shrink-0" />
                          {it.position}
                        </span>
                      )}
                      {showOwner && it.ownerFirstName && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <UserIcon className="w-3 h-3 shrink-0" />
                          {it.ownerFirstName}
                        </span>
                      )}
                    </div>

                    {/* Countdown — emerald when upcoming, RED when overdue. */}
                    <p
                      className={`mt-1 inline-flex items-center gap-1 text-[11px] font-medium ${
                        overdue
                          ? "text-red-600 dark:text-red-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      <Clock className="w-3 h-3 shrink-0" />
                      {countdownLabel(it.daysUntil)}
                    </p>

                    {/* Documents-pending flag — AMBER pending accent (spec item 3),
                        only when the caller flags it. */}
                    {it.documentsPending && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border dark:border-amber-500/60">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        Documents pending
                      </p>
                    )}
                  </div>

                  {/* ── Quick actions: Send Reminder (WhatsApp), Call, Voice Note,
                       Schedule, Email, Resume, Open ── */}
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    {waPhone && (
                      <ActionIconButton
                        action="whatsapp"
                        href={`https://wa.me/${waDigits(waPhone)}`}
                        size="sm"
                        external
                        title="Send Reminder"
                      />
                    )}
                    {it.phone && (
                      <ActionIconButton
                        action="call"
                        href={`tel:${it.phone}`}
                        size="sm"
                        title="Call"
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
                      title="Schedule"
                      aria-label="Schedule"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30"
                    >
                      <CalendarIcon className="w-3.5 h-3.5" />
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

export default ExpectedJoinings;
