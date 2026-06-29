// CallNowQueue — the PRIMARY "Who Should I Call Now?" section of the redesigned
// HR dashboard (docs/HR-DASHBOARD-REDESIGN-SPEC.md item 4). It is the recruiter's
// single most important worklist: a card list — one row per candidate — of the
// merged overdue + due-today follow-ups, soonest due first, so the recruiter can
// work straight down the queue without thinking about filters.
//
// Each card surfaces Name, Position, Stage (status chip via statusColor /
// statusLabel from hrStatus.ts — never hand-rolled), Recruiter (only when
// showOwner), Next Action, and the Due time (overdue flagged RED). A tight
// quick-action row follows: Call, WhatsApp, Voice Note, Schedule, Open.
//
// PRESENTATIONAL ONLY. This is a SERVER component (no "use client"): it fetches
// nothing, queries nothing and computes no business state — every field arrives
// pre-shaped via `items` and the caller decides scope (Junior HR = own
// candidates only) before handing the list down. `overdue` and `dueIso` are
// computed upstream; we only render them.
//
// Behaviour is carried entirely by hrefs so the card needs no client island:
//   • Call     → tel:<phone>                              (ActionIconButton, emerald)
//   • WhatsApp → https://wa.me/<digits>                   (ActionIconButton, brand green)
//   • Voice Note / Schedule / Open → /hr/candidates/<id>  (link into the detail page,
//        where the voice recorder + scheduler live)
// Action icons + colours come from ACTION_TOKENS via ActionIconButton (emerald=call,
// green=whatsapp) and Lucide marks for the detail-page links (Mic=voice note,
// purple Calendar=schedule, slate ArrowUpRight=open) — colours are not overridden.
//
// Color coding (spec item 3): RED = urgent/overdue (overdue due-times + the
// AlertTriangle flag), GREEN/EMERALD = healthy ("all caught up" empty state).
// No emoji — Lucide icons only. Every colour ships a dark: variant matching the
// existing HR card conventions (rounded-2xl card, border, dark:bg-slate surfaces).

import Link from "next/link";
import {
  PhoneCall,
  AlertTriangle,
  Clock,
  Mic,
  Calendar,
  ArrowUpRight,
  User,
  CheckCircle2,
} from "lucide-react";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
import { statusColor, statusLabel } from "@/lib/hrStatus";
import { fmtISTShortLabelled } from "@/lib/datetime";

export interface CallNowItem {
  followUpId: string;
  candidateId: string;
  name: string;
  position: string | null;
  status: string;
  nextAction: string | null;
  ownerFirstName: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  dueIso: string;
  overdue: boolean;
}

export interface CallNowQueueProps {
  items: CallNowItem[];
  showOwner: boolean;
}

// wa.me wants bare digits — strip everything else, matching the existing HR
// row-action convention (HRInterviewRowActions / HRCandidateTable).
function waDigits(p: string): string {
  return p.replace(/\D/g, "");
}

export function CallNowQueue({ items, showOwner }: CallNowQueueProps) {
  const overdueCount = items.reduce((n, it) => n + (it.overdue ? 1 : 0), 0);

  return (
    <section
      aria-label="Who Should I Call Now?"
      className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Section header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 shrink-0">
            <PhoneCall className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">
              Who Should I Call Now?
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight">
              Overdue &amp; due-today follow-ups, soonest first
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            {overdueCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                <AlertTriangle className="w-3 h-3" />
                {overdueCount} overdue
              </span>
            )}
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300">
              {items.length}
            </span>
          </div>
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
            No overdue or due-today follow-ups right now.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {items.map((it) => {
            const detailHref = `/hr/candidates/${it.candidateId}`;
            const waPhone = it.whatsappPhone ?? it.phone;
            const due = fmtISTShortLabelled(it.dueIso);
            return (
              <li
                key={it.followUpId}
                className="px-4 py-3 hover:bg-gray-50/70 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  {/* ── Identity + stage + next action + due ── */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={detailHref}
                        className="text-sm font-semibold text-gray-900 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-400 truncate"
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
                      <p className="text-xs text-gray-500 dark:text-slate-400 truncate mt-0.5">
                        {it.position}
                      </p>
                    )}

                    {it.nextAction && (
                      <p className="text-xs text-gray-700 dark:text-slate-300 mt-1 line-clamp-2">
                        <span className="font-medium text-gray-500 dark:text-slate-400">
                          Next:
                        </span>{" "}
                        {it.nextAction}
                      </p>
                    )}

                    <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
                      {/* Due — RED when overdue (spec item 3), neutral otherwise. */}
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          it.overdue
                            ? "text-red-600 dark:text-red-400"
                            : "text-gray-500 dark:text-slate-400"
                        }`}
                      >
                        {it.overdue ? (
                          <AlertTriangle className="w-3 h-3" />
                        ) : (
                          <Clock className="w-3 h-3" />
                        )}
                        {it.overdue ? "Overdue · " : "Due "}
                        {due}
                      </span>

                      {showOwner && it.ownerFirstName && (
                        <span className="inline-flex items-center gap-1 text-gray-500 dark:text-slate-400">
                          <User className="w-3 h-3" />
                          {it.ownerFirstName}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Quick actions: Call, WhatsApp, Voice Note, Schedule, Open ── */}
                  <div className="flex items-center gap-1 shrink-0">
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
                      title="Schedule"
                      aria-label="Schedule"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30"
                    >
                      <Calendar className="w-3.5 h-3.5" />
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
      )}
    </section>
  );
}

export default CallNowQueue;
