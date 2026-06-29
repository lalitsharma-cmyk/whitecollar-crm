// RecentActivityFeed — the "Recent Activity" sidebar feed of the redesigned HR
// dashboard (docs/HR-DASHBOARD-REDESIGN-SPEC.md item 9). It shows only the latest
// 5–10 activities, never a full audit log: one tight row per activity with the
// activity label, a candidate deep-link, the recruiter's first name and the IST
// date+time. It is a glanceable "what just happened" rail beside the action
// queues — not a reporting surface.
//
// PRESENTATIONAL ONLY. This is a SERVER component (no "use client"): it fetches
// nothing, queries nothing and computes no business state. Every row arrives
// pre-shaped via `rows`, and the caller decides scope (Junior HR = own candidates
// only via hrActiveScopeWhere; Admin/Senior = all) BEFORE building the list — we
// never widen what we are shown. `whenIso` is an ISO timestamp the caller already
// resolved; we only format it to IST for display.
//
// The per-row icon is resolved internally from the human label via a small label
// dictionary (ACTIVITY_VISUAL) so callers can pass any label string ("New
// Candidate", "Call Logged", "No Show", …) and still get a consistent Lucide mark
// + semantic colour. Unknown labels fall back to the neutral Activity glyph. The
// label itself is shown verbatim — the dictionary only drives the icon/colour.
//
// Behaviour is carried entirely by hrefs so the row needs no client island:
//   • Call     → tel:<phone>                              (ActionIconButton, emerald)
//   • WhatsApp → https://wa.me/<digits>                   (ActionIconButton, brand green)
//   • Email    → mailto:<email>                           (ActionIconButton, blue)
//   • Voice Note / Schedule / Open → /hr/candidates/<id>  (link into the detail page,
//        where the voice recorder + scheduler live)
//   • Resume   → /api/hr/candidates/<id>/resume           (direct resume download)
// Action icons + colours come from ACTION_TOKENS via ActionIconButton
// (emerald=call, green=whatsapp, blue=email) and Lucide marks for the detail-page
// links (Mic=voice note, purple Calendar=schedule, slate ArrowUpRight=open) —
// colours are never overridden. Quick actions render only when the data exists
// (phone / email present); the candidate link + Open are always available.
//
// Color coding (spec item 3) is per-activity semantic, all with dark: variants
// matching the existing HR card conventions (rounded-2xl card, border,
// dark:bg-slate surfaces): RED = urgent/negative (No Show, Rejected,
// Escalated), AMBER = pending/waiting (Offer Released, On Hold, Reschedule),
// GREEN/EMERALD = healthy/positive (Joined, Interested, Follow-up Completed),
// BLUE/INDIGO/PURPLE = info/neutral (New Candidate, Call, Interview, Voice Note),
// with the GREEN "all caught up" empty state shared with the other HR queues.
// No emoji — Lucide icons only.

import Link from "next/link";
import {
  UserPlus,
  Phone,
  AlertTriangle,
  Target,
  CheckCircle2,
  Ban,
  Handshake,
  Inbox,
  Activity,
  Mic,
  RotateCcw,
  Calendar,
  Mail,
  FileText,
  ArrowUpRight,
  User,
  type LucideIcon,
} from "lucide-react";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
import { fmtISTShortLabelled } from "@/lib/datetime";

// ── Props contract (exported per spec) ───────────────────────────────────────
export interface RecentActivityRow {
  id: string;
  label: string;
  candidateId: string;
  candidateName: string;
  userFirstName: string | null;
  whenIso: string;
}

export interface RecentActivityFeedProps {
  rows: RecentActivityRow[];
}

// Optional quick-contact + resume fields. They are NOT part of the required
// RecentActivityRow contract above (callers may pass plain rows), but when the
// caller spreads richer objects that also carry these, the matching quick action
// renders. Resolved via a structural read so the strict contract stays intact.
interface ContactExtras {
  phone?: string | null;
  whatsappPhone?: string | null;
  email?: string | null;
  hasResume?: boolean | null;
}

// ── Label → icon + colour dictionary ─────────────────────────────────────────
// Resolved internally from the human label (case-insensitive, substring rules)
// so any reasonable activity phrasing maps to a consistent Lucide mark + semantic
// hue. The label text is always shown verbatim — this only drives the icon tile.
// Each entry ships light + dark variants. Icon set is exactly the spec list.
interface ActivityVisual {
  Icon: LucideIcon;
  /** Tinted square icon tile (bg + text), light + dark. */
  tile: string;
}

// Semantic tiles (spec item 3). Pinned here so every activity kind is consistent.
const TILE = {
  // BLUE / INDIGO / PURPLE — info / neutral.
  info: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300",
  indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-300",
  purple: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-300",
  // GREEN / EMERALD — healthy / positive.
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300",
  // AMBER / ORANGE — pending / waiting.
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300",
  // RED — urgent / negative.
  red: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300",
  // SLATE — low-signal neutral fallback.
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
} as const;

// Ordered substring rules — most decisive outcomes first (mirrors the categorize
// style used elsewhere in HR). Returns a fixed Lucide icon + semantic tile.
function activityVisual(label: string): ActivityVisual {
  const s = label.toLowerCase();
  const has = (...w: string[]) => w.some((x) => s.includes(x));

  if (has("no show", "no-show", "noshow")) return { Icon: AlertTriangle, tile: TILE.red };
  if (has("reject", "not suitable", "declined")) return { Icon: Ban, tile: TILE.red };
  if (has("escalat")) return { Icon: AlertTriangle, tile: TILE.red };
  if (has("joined", "joining")) return { Icon: Handshake, tile: TILE.green };
  if (has("offer")) return { Icon: Target, tile: TILE.amber };
  if (has("reschedul", "snooze", "moved")) return { Icon: RotateCcw, tile: TILE.amber };
  if (has("hold")) return { Icon: RotateCcw, tile: TILE.amber };
  if (has("completed", "interested", "shortlist", "confirmed"))
    return { Icon: CheckCircle2, tile: TILE.green };
  if (has("voice")) return { Icon: Mic, tile: TILE.purple };
  if (has("interview", "schedul", "meeting")) return { Icon: Calendar, tile: TILE.indigo };
  if (has("follow")) return { Icon: Target, tile: TILE.amber };
  if (has("call")) return { Icon: Phone, tile: TILE.info };
  if (has("import", "added", "imported")) return { Icon: Inbox, tile: TILE.info };
  if (has("new candidate", "created", "new ")) return { Icon: UserPlus, tile: TILE.info };
  // Unknown — keep visible with the neutral Activity glyph (low-signal slate).
  return { Icon: Activity, tile: TILE.slate };
}

// wa.me wants bare digits — strip everything else, matching the existing HR
// row-action convention (CallNowQueue / HRCandidateTable).
function waDigits(p: string): string {
  return p.replace(/\D/g, "");
}

export function RecentActivityFeed({ rows }: RecentActivityFeedProps) {
  return (
    <section
      aria-label="Recent Activity"
      className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Section header — BLUE info tile (spec item 3, neutral feed). */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300 shrink-0">
            <Activity className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">
              Recent Activity
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight">
              Latest updates across your candidates
            </p>
          </div>
        </div>
        {rows.length > 0 && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300 shrink-0">
            {rows.length}
          </span>
        )}
      </div>

      {/* Empty state — nothing yet (GREEN / healthy per spec item 3). */}
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 mb-2">
            <CheckCircle2 className="w-5 h-5" />
          </span>
          <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">
            All caught up
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            No recent activity to show right now.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {rows.map((row) => {
            const { Icon, tile } = activityVisual(row.label);
            const detailHref = `/hr/candidates/${row.candidateId}`;
            const when = fmtISTShortLabelled(row.whenIso);

            // Structural read of the optional contact extras (see ContactExtras).
            const x = row as RecentActivityRow & ContactExtras;
            const phone = x.phone ?? null;
            const waPhone = x.whatsappPhone ?? x.phone ?? null;
            const email = x.email ?? null;
            const hasResume = x.hasResume ?? false;

            return (
              <li
                key={row.id}
                className="px-4 py-3 hover:bg-gray-50/70 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {/* ── Activity icon tile (semantic colour from the label) ── */}
                  <span
                    className={`inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${tile}`}
                    title={row.label}
                  >
                    <Icon className="w-4 h-4" />
                  </span>

                  {/* ── Label + candidate link + recruiter + IST time ── */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 dark:text-white leading-snug">
                      <span className="font-semibold">{row.label}</span>
                      <span className="text-gray-400 dark:text-slate-500"> · </span>
                      <Link
                        href={detailHref}
                        className="font-semibold text-gray-900 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-400 break-words"
                      >
                        {row.candidateName}
                      </Link>
                    </p>

                    <div className="flex items-center gap-3 mt-0.5 text-[11px] flex-wrap">
                      {row.userFirstName && (
                        <span className="inline-flex items-center gap-1 text-gray-500 dark:text-slate-400">
                          <User className="w-3 h-3" />
                          {row.userFirstName}
                        </span>
                      )}
                      <span className="text-gray-500 dark:text-slate-400">{when}</span>
                    </div>
                  </div>

                  {/* ── Quick actions: Call, WhatsApp, Email, Voice Note,
                       Schedule, Resume, Open. Rendered only when data exists. ── */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {phone && (
                      <ActionIconButton
                        action="call"
                        href={`tel:${phone}`}
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
                    {email && (
                      <ActionIconButton
                        action="email"
                        href={`mailto:${email}`}
                        size="sm"
                        title="Email"
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
                    {hasResume && (
                      <a
                        href={`/api/hr/candidates/${row.candidateId}/resume`}
                        title="Resume"
                        aria-label="Resume"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </a>
                    )}
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

export default RecentActivityFeed;
