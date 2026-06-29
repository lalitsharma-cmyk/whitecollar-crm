// NoNextActionQueue — the "No Next Action" queue of the redesigned HR dashboard
// (docs/HR-DASHBOARD-REDESIGN-SPEC.md items 2, 3, 13). These are ACTIVE candidates
// that have slipped through the cracks: they have NO nextActionDate set, so nothing
// is scheduled and they will silently rot unless the recruiter gives them a next
// step. The whole point of this section is to make that gap visible and one-click
// fixable — the primary verb here is "Set Next Action (Schedule)".
//
// One card per candidate, surfacing Name, Position, Status chip (via statusColor /
// statusLabel from hrStatus.ts — NEVER hand-rolled), the owning recruiter (only
// when showOwner), and how long the candidate has been sitting since created
// (days-since-created — the longer, the more it stands out). A tight quick-action
// row follows: Set Next Action (Schedule), Call, WhatsApp, Resume, Open.
//
// PRESENTATIONAL ONLY. This is a SERVER component (no "use client"): it fetches
// nothing, queries nothing and computes no business state — every field arrives
// pre-shaped via `items`, and the caller decides scope (Junior HR = own candidates
// only via hrActiveScopeWhere) before handing the list down. `totalCount` is the
// full scoped count; when it exceeds the rendered slice we show an "X of total"
// footer link to /hr/candidates so the recruiter can bulk-set the rest.
//
// Behaviour is carried entirely by hrefs so the card needs no client island:
//   • Set Next Action / Schedule → /hr/candidates/<id>  (the scheduler lives there)
//   • Call     → tel:<phone>                            (ActionIconButton, emerald)
//   • WhatsApp → https://wa.me/<digits>                 (ActionIconButton, brand green)
//   • Resume   → /api/hr/candidates/<id>/resume         (the resume download route)
//   • Open     → /hr/candidates/<id>                    (link into the detail page)
// Action icons + colours come from ACTION_TOKENS via <ActionIconButton> (emerald=call,
// green=whatsapp, purple=schedule via the meeting token) and Lucide marks for the
// remaining links — colours are not overridden.
//
// Color coding (spec item 3): SLATE = low-signal info — this queue is the quiet
// "you forgot these" list, not an urgent fire, so the section accent, the count
// chip and the days-waited badge are slate (Inbox icon). GREEN/EMERALD = healthy
// "all caught up" empty state. Every colour ships a dark: variant matching the
// existing HR card conventions (rounded card, border, dark:bg-slate surfaces).
// No emoji — Lucide icons only.

import Link from "next/link";
import {
  Inbox,
  CalendarPlus,
  FileText,
  ArrowUpRight,
  User,
  Clock,
  CheckCircle2,
  Briefcase,
} from "lucide-react";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
import { statusColor, statusLabel } from "@/lib/hrStatus";

export interface NoNextActionItem {
  candidateId: string;
  name: string;
  position: string | null;
  status: string;
  ownerFirstName: string | null;
  daysSinceCreated: number;
  phone: string | null;
  whatsappPhone: string | null;
}

export interface NoNextActionQueueProps {
  items: NoNextActionItem[];
  totalCount: number;
  showOwner: boolean;
}

// wa.me wants bare digits — strip everything else, matching the existing HR
// row-action convention (CallNowQueue / PendingConfirmations / HRInterviewRowActions).
function waDigits(p: string): string {
  return p.replace(/\D/g, "");
}

// Human "waiting N days" label from days-since-created (computed upstream).
function waitedLabel(days: number): string {
  if (days <= 0) return "Added today";
  if (days === 1) return "Waiting 1 day";
  return `Waiting ${days} days`;
}

export function NoNextActionQueue({
  items,
  totalCount,
  showOwner,
}: NoNextActionQueueProps) {
  const hasMore = totalCount > items.length;

  return (
    <section
      aria-label="No Next Action"
      className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Section header — SLATE low-signal info accent (spec item 3). */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 shrink-0">
            <Inbox className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">
              No Next Action
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight">
              Active candidates with nothing scheduled — set a next step
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:border dark:border-slate-600/60 shrink-0">
            {totalCount}
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
            Every active candidate has a next action scheduled.
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {items.map((it) => {
              const detailHref = `/hr/candidates/${it.candidateId}`;
              const resumeHref = `/api/hr/candidates/${it.candidateId}/resume`;
              const waPhone = it.whatsappPhone ?? it.phone;
              return (
                <li
                  key={it.candidateId}
                  className="px-4 py-3 hover:bg-gray-50/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    {/* ── Identity + status + position + days-waited ── */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={detailHref}
                          className="text-sm font-semibold text-gray-900 dark:text-white hover:text-slate-700 dark:hover:text-slate-300 truncate"
                        >
                          {it.name}
                        </Link>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusColor(
                            it.status,
                          )}`}
                        >
                          {statusLabel(it.status)}
                        </span>
                      </div>

                      {it.position && (
                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate mt-0.5 inline-flex items-center gap-1">
                          <Briefcase className="w-3 h-3 shrink-0" />
                          {it.position}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
                        {/* Days-since-created — slate low-signal badge (spec item 3). */}
                        <span className="inline-flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400">
                          <Clock className="w-3 h-3" />
                          {waitedLabel(it.daysSinceCreated)}
                        </span>

                        {showOwner && it.ownerFirstName && (
                          <span className="inline-flex items-center gap-1 text-gray-500 dark:text-slate-400">
                            <User className="w-3 h-3" />
                            {it.ownerFirstName}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ── Quick actions: Set Next Action (Schedule), Call, WhatsApp, Resume, Open ── */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Set Next Action / Schedule — purple meeting token via detail page. */}
                      <Link
                        href={detailHref}
                        title="Set Next Action"
                        aria-label="Set Next Action"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30"
                      >
                        <CalendarPlus className="w-3.5 h-3.5" />
                      </Link>
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
                        href={resumeHref}
                        title="Resume"
                        aria-label="Open resume"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </Link>
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

          {/* "X of total" footer — link to the full candidates list to bulk-set the
              rest, shown only when more candidates exist than are rendered here. */}
          {hasMore && (
            <div className="px-4 py-2.5 border-t border-gray-100 dark:border-slate-800">
              <Link
                href="/hr/candidates"
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors"
              >
                Showing {items.length} of {totalCount} — set next action in bulk
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default NoNextActionQueue;
