"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Phone, MessageCircle, Tag, RefreshCw, XCircle, X, ExternalLink, Pencil, Calendar, Trash2 } from "lucide-react";
import { REJECT_REASONS as REJECT_REASON_LIST } from "@/lib/reject-reasons";
import LeadHeaderFilter from "@/components/LeadHeaderFilter";
// Per-row Call / WhatsApp / Follow-up / Email / Reject actions now render from
// the central Action Design System (ActionButton / ActionIconButton + tokens).
// The old inline WhatsApp <WaIcon> SVG + ad-hoc per-action colours were removed;
// the brand WhatsApp glyph now lives in components/actions/WhatsAppGlyph.tsx.
import { telLink, whatsappLink } from "@/lib/phone";
import CopyPhoneButton from "./CopyPhoneButton";
import { ActionButton } from "@/components/actions/ActionButton";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
import CRMDatePicker from "@/components/CRMDatePicker";
import { toISTLocalInput, isPastISTLocalInput } from "@/lib/datetime";
import { ACTION_TOKENS } from "@/lib/actionDesign";
import { showXpToast } from "@/components/XPToast";
import { statusColor, selectableStatuses } from "@/lib/lead-statuses";
import { resolveEnquiredProperty, prettyProjectName } from "@/lib/projectName";
// Shared source allow-list — same one the New-Lead form uses, so the Master-Data
// bulk Source edit can't re-offer the deprecated WhatsApp/Inbound-Call/Event/Email
// values (channel → Medium). See src/lib/lead-sources.ts.
import { allowedSourceOptions } from "@/lib/lead-sources";
import { backdropProps } from "@/lib/useDismiss";

// ── Row Snooze button ────────────────────────────────────────────────────────
// Wraps the shared CRMDatePicker (IST, future-only, with time) so a single
// click in a Leads row/card opens the date/time sheet and reschedules the
// follow-up via the SAME /action-snooze endpoint the Action List + Lead View
// use. `variant` matches the surrounding action set: "ghost" for the dense
// Excel table, "solid" for the card-view icon chips, "labeled" for mobile.
const SnoozeClock = ACTION_TOKENS.snooze.icon;
function RowSnoozeButton({
  leadId, leadName, followupRaw, variant, onConfirm,
}: {
  leadId: string;
  leadName: string;
  followupRaw: string | null;
  variant: "ghost" | "solid" | "labeled";
  onConfirm: (leadId: string, v: string) => Promise<void> | void;
}) {
  const iconBox = "inline-flex items-center justify-center transition-colors w-8 h-8 rounded-md disabled:opacity-50";
  const chipClassName =
    variant === "labeled"
      ? `inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold min-h-9 shadow-sm ${ACTION_TOKENS.snooze.solid} disabled:opacity-60`
      : variant === "solid"
        ? `${iconBox} shadow-sm ${ACTION_TOKENS.snooze.solid}`
        : `${iconBox} ${ACTION_TOKENS.snooze.ghost}`;
  return (
    <CRMDatePicker
      value={followupRaw ? toISTLocalInput(`${followupRaw}T10:00`) : ""}
      onConfirm={(v) => onConfirm(leadId, v)}
      withTime
      futureOnly
      title={`Snooze ${leadName}`}
      triggerStyle="chip"
      chipClassName={chipClassName}
      placeholder={
        variant === "labeled"
          ? <span className="inline-flex items-center gap-1"><SnoozeClock className="w-3.5 h-3.5" /> Snooze</span>
          : <SnoozeClock className="w-3.5 h-3.5" />
      }
    />
  );
}

// Preset tag vocab — mirrors what Lalit asked the team to standardise on
// across the pipeline. Kept here (not server-fetched) so the popover renders
// instantly without a round-trip on first open.
const PRESET_TAGS = [
  "NRI",
  "Investor",
  "End-user",
  "HNI",
  "First-time buyer",
  "Repeat client",
  "Referral",
  "Hot prospect",
  "Cold revival",
];

// Same allow-list as RejectLeadClient / the single-lead reject endpoint.
const REJECT_REASONS: Array<{ v: string; label: string }> = [
  { v: "FUND_ISSUE",                  label: "💰 Fund issue" },
  { v: "WAR_FEAR",                    label: "⚔ War fear" },
  { v: "LOW_BUDGET",                  label: "📉 Low budget" },
  { v: "LOOK_AFTER_2_YEARS",          label: "📅 Look after 2 years" },
  { v: "WAITING_FOR_PROPERTY_SALE",   label: "🏠 Waiting to sell own property" },
  { v: "OTHER",                       label: "✏ Other (specify)" },
];

// Bulk-WhatsApp template presets — must match the keys the /api/leads/bulk-wa
// endpoint understands.
const WA_PRESETS: Array<{ v: string; label: string }> = [
  { v: "followup",   label: "Follow-up" },
  { v: "checkin",    label: "Check-in" },
  { v: "newlisting", label: "New listing" },
];

function idleClass(lastTouchedAt: string | null | undefined): string {
  if (!lastTouchedAt) return "text-gray-400";
  const days = (Date.now() - new Date(lastTouchedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days > 7) return "text-red-600 font-semibold";
  if (days > 2) return "text-amber-600 font-medium";
  return "text-emerald-600";
}

/** Format "Last Activity" cell — e.g. "📞 Call · 2h ago" */
function fmtLastActivity(type: string | null, at: string | null): string | null {
  if (!type || !at) return null;
  const ms = Date.now() - new Date(at).getTime();
  const mins = Math.floor(ms / 60_000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  const ago = days >= 7 ? `${days}d` : days >= 1 ? `${days}d` : hrs >= 1 ? `${hrs}h` : `${mins}m`;
  const icon = type === "CALL" ? "📞" : type === "WHATSAPP" ? "💬" : type === "EMAIL" ? "✉️"
    : type === "NOTE" ? "📝" : type === "SITE_VISIT" ? "🏗" : "•";
  const label = type === "CALL" ? "Call" : type === "WHATSAPP" ? "WhatsApp" : type === "EMAIL" ? "Email"
    : type === "NOTE" ? "Note" : type === "SITE_VISIT" ? "Visit" : type.replace(/_/g, " ").toLowerCase();
  return `${icon} ${label} · ${ago}`;
}

export interface Row {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string;
  statusName: string;
  /** User-facing Excel/MIS status (currentStatus field) */
  currentStatus: string | null;
  srcChip: string;
  srcLabel: string;
  statusChip: string;
  aiScore: string | null;
  aiScoreValue: number | null;
  team: string | null;
  owner: { name: string; avatarColor: string } | null;
  budget: string | null;
  interest: string | null;
  lastTouched: string | null;
  lastTouchedAt?: string | Date | null;
  // Command Center fields
  budgetFormatted: string | null;
  bantCount: number;
  needSummary: string | null;
  discussedProjects: string[];
  todoNext: string | null;
  followupDate: string | null;
  followupRaw: string | null;   // YYYY-MM-DD for the date input
  enquiryDate: string | null;   // enquiry DATE (createdAt) — own column
  enquiryTime: string | null;   // enquiry TIME (createdAt) — own column
  enquiryRaw: string | null;    // YYYY-MM-DD for the date input (admin inline edit)
  intelligenceMatch: {
    matchType: string;
    confidence: number;
    totalPropertiesFound: number;
  } | null;
  // Table view extra fields
  city: string | null;
  whenCanInvest: string | null;
  remarks: string | null;
  sourceDetail: string | null; // canonical "Property Enquired" — same field detail + Master Data show
  projectHint: string | null;  // notesShort only — weak remark, gated behind a known-project match
  // Last Activity column — what happened last + when
  lastActivityType: string | null;
  lastActivityAt: string | null;
  // Connected History column — e.g. 5C / 2NC
  connectedCount: number;
  notPickedCount: number;
  /** True when a contact attempt (call/WA/email) was logged today (IST). Gates the
   *  Complete button — disabled + tooltip until a touch is logged (Lalit's policy). */
  hasContactToday: boolean;
  /** Fresh-lead visibility (Lalit, 2026-07-01). assignedToday → 🆕 NEW TODAY badge;
   *  untouched → no first contact logged; freshUntouchedToday (both) → row highlight
   *  + ⚡ Untouched badge. Computed server-side against freshLeads.ts (single source). */
  assignedToday?: boolean;
  untouched?: boolean;
  freshUntouchedToday?: boolean;
}

/** Fresh-lead badges — the loud, instantly-visible "don't miss this" markers.
 *  🆕 NEW TODAY on any lead assigned today; ⚡ Untouched when no first contact yet.
 *  Rendered next to the client name in every view (table + cards + mobile). */
function FreshBadges({ row, className = "" }: { row: Row; className?: string }) {
  if (!row.assignedToday && !row.untouched) return null;
  return (
    <span className={`inline-flex items-center gap-1 align-middle ${className}`}>
      {row.assignedToday && (
        <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700"
          title="Assigned to you today — contact them first">🆕 New Today</span>
      )}
      {row.freshUntouchedToday && (
        <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 border border-red-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide dark:bg-red-950/40 dark:text-red-200 dark:border-red-700"
          title="No call, WhatsApp, or note logged yet — first contact pending">⚡ Untouched</span>
      )}
    </span>
  );
}

export default function LeadsListClient({ leads, canBulk, canReassign = false, canSetStatus = false, canDelete = false, agents, projectOptions = [], statusOptions = [], sourceOptions = [], meRole = "AGENT", showSource = true, view = "cards", searchParamsStr = "", detailBasePath = "/leads", listBasePath = "/leads", extraRowAction }: { leads: Row[]; canBulk: boolean; canReassign?: boolean; canSetStatus?: boolean; canDelete?: boolean; agents: { id: string; name: string; team: string | null }[]; projectOptions?: string[]; statusOptions?: string[]; sourceOptions?: string[]; meRole?: string; showSource?: boolean; view?: "cards" | "table"; searchParamsStr?: string;
  /** Base path for a row's detail link. "/leads" (default) → /leads/:id. The
   *  Revival list passes "/revival-engine/cold-data" so cold rows open the cold
   *  detail page. Additive — /leads behaviour is unchanged. */
  detailBasePath?: string;
  /** Base path the table's sortable column headers link back to (the LIST page
   *  itself). Default "/leads"; the Revival list passes "/cold-calls" so sorting
   *  stays on that page. Additive. */
  listBasePath?: string;
  /** Optional extra per-row action (e.g. Revival "Promote to Lead"). Rendered
   *  alongside the standard row actions in every surface (table + cards) when
   *  provided. Default undefined → /leads renders nothing extra. */
  extraRowAction?: (row: Row) => React.ReactNode;
}) {
  // showSource = false → hide the source column + chip from agents.
  // Lalit's policy: agents shouldn't see where each lead came from (avoids them
  // cherry-picking high-converting sources or gaming the round-robin pool).
  const router = useRouter();
  // Restore scroll position on Back. The Leads/Revival filters, sort, and page
  // are ALL in the URL, so browser Back already restores them; this adds the
  // last missing piece — returning to the exact row the user had scrolled to.
  // Keyed by pathname, so /leads and /cold-calls each remember independently.
  useScrollRestore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedIds = Array.from(selected);
  // Agents see a leaner table (no Assigned/Last-Activity columns — they only ever
  // see their own leads) but CAN still select rows to bulk-set follow-up dates.
  const isAgent = meRole === "AGENT";
  const canSel = canBulk || isAgent;          // who may tick row checkboxes
  const isAdmin = meRole === "ADMIN";          // admin-only bulk field edits

  // Bulk action UI state. The action bar is a single sticky element at the
  // bottom; popovers/modals for each action layer on top via z-50.
  const [showTagPopover, setShowTagPopover] = useState(false);
  const [showReassignPopover, setShowReassignPopover] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showWaPopover, setShowWaPopover] = useState(false);
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());
  const [reassignPick, setReassignPick] = useState("");
  const [rejectReason, setRejectReason] = useState("FUND_ISSUE");
  const [rejectNote, setRejectNote] = useState("");
  const [waTemplate, setWaTemplate] = useState("followup");
  // Bulk follow-up (agents + admin) and bulk field-edit (admin: source/budget/project).
  const [showFollowupPop, setShowFollowupPop] = useState(false);
  const [bulkFollowup, setBulkFollowup] = useState("");
  const [showEditPop, setShowEditPop] = useState(false);
  const [editSource, setEditSource] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [editProject, setEditProject] = useState("");
  const [waLinks, setWaLinks] = useState<Array<{ leadId: string; name: string; phone: string; waLink: string }>>([]);
  const [waSkipped, setWaSkipped] = useState<Array<{ leadId: string; name: string; reason: string }>>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [bulkCrossTeamWarn, setBulkCrossTeamWarn] = useState<string | null>(null);
  // Non-blocking, dismissible in-page message bar for per-row action failures
  // (Complete / Snooze / Escalate / Reassign / Follow-up / Reject / Delete).
  // Mirrors the Buyer (setBulkMsg) + Master Data (setMsg) pattern so a failed
  // row action no longer interrupts the workflow with a modal alert().
  const [rowMsg, setRowMsg] = useState<string | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [statusOpenFor, setStatusOpenFor] = useState<string | null>(null);
  const [enquiryEditFor, setEnquiryEditFor] = useState<string | null>(null);
  // Inline Assigned-agent picker (Admin/Manager only — gated by canReassign, and
  // the Assigned column itself is already hidden from agents). Mirrors the Master
  // Data agent cell: routes through the SAME audited /update ownerId endpoint
  // (assignLeadTo → Assignment history + notify + SLA + change-history), so the
  // Agent Performance report and the new owner's notification both stay correct.
  const [reassignOpenFor, setReassignOpenFor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteReason, setDeleteReason] = useState("NOT_INTERESTED");
  const [deleteNote, setDeleteNote] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Delete Lead (Super-Admin / Lalit only) — a separate action from Reject.
  const [delLeadTarget, setDelLeadTarget] = useState<{ id: string; name: string } | null>(null);
  const [delLeadBusy, setDelLeadBusy] = useState(false);
  // ── Row follow-up actions (Complete / Snooze / Escalate) ─────────────────
  // These reuse the EXACT same endpoints the Action List + Lead-View use, so
  // there's no duplicated follow-up logic. `actionBusy` tracks which lead+action
  // is mid-flight so we can disable + show a spinner per row. The Escalate popover
  // (escalateTarget) collects an optional reason; Snooze opens the shared
  // CRMDatePicker inline via <RowSnoozeButton> (one picker per row trigger).
  const [actionBusy, setActionBusy] = useState<{ id: string; kind: "complete" | "snooze" | "escalate" } | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<{ id: string; name: string } | null>(null);
  const [escalateReason, setEscalateReason] = useState("");

  // ── Hydration-safe clock gate ────────────────────────────────────────────
  // Relative-time output — the "· 2h ago" Last-Activity string, the >7-day "idle"
  // chip, and the idleClass() colour — is derived from Date.now() AT RENDER. SSR
  // (server clock) and the first client render run at different instants, so a
  // value can land in a different bucket ("59m" vs "1h") → React hydration
  // text/element mismatch (minified #418) on the hottest page in the CRM. We keep
  // SSR and the first client render byte-identical by emitting the volatile bits
  // ONLY once `mounted` flips true (post-hydration, in the effect below). The
  // server-stable `l.lastTouched` string keeps rendering throughout, so only the
  // colour + the tiny idle chip land a frame later. Same class of fix as the
  // shared shell date chip (GlobalDateFilter, commit 97251b8) — mounted-gate
  // variant chosen here for correctness over suppressHydrationWarning.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function doActionComplete(leadId: string) {
    if (actionBusy) return;
    setActionBusy({ id: leadId, kind: "complete" });
    try {
      const r = await fetch(`/api/leads/${leadId}/action-complete`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setRowMsg(j.error ?? "Could not complete follow-up"); return; }
      if (j.awardedXp) {
        showXpToast({ amount: j.awardedXp.amount, label: j.awardedXp.label, leveledUp: j.awardedXp.leveledUp, newLevel: j.awardedXp.newLevel });
      }
      router.refresh();
    } finally { setActionBusy(null); }
  }

  // Snooze via the shared CRMDatePicker — sends an explicit IST instant so the
  // follow-up lands exactly when picked (same contract as LeadFollowupActions).
  async function doActionSnooze(leadId: string, v: string) {
    if (!v) return;
    if (isPastISTLocalInput(v)) throw new Error("Pick a future date/time (IST).");
    setActionBusy({ id: leadId, kind: "snooze" });
    try {
      // V1: instant snooze — no reason prompt (Lalit's UX simplification).
      const r = await fetch(`/api/leads/${leadId}/action-snooze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at: `${v}:00+05:30` }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not snooze");
      router.refresh();
    } finally { setActionBusy(null); }
  }

  async function doActionEscalate(leadId: string) {
    if (actionBusy) return;
    setActionBusy({ id: leadId, kind: "escalate" });
    try {
      const r = await fetch(`/api/leads/${leadId}/action-escalate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: escalateReason.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setRowMsg(j.error ?? "Could not escalate"); return; }
      setEscalateTarget(null); setEscalateReason("");
      router.refresh();
    } finally { setActionBusy(null); }
  }

  // Excel-style header-filter option lists (shared by the table headers + the
  // card-view filter toolbar).
  const agentFilterOpts = [{ value: "unassigned", label: "⚠ Unassigned" }, ...agents.map(a => ({ value: a.id, label: a.name }))];
  const projFilterOpts = projectOptions.map(p => ({ value: p, label: p }));
  const statusFilterOpts = statusOptions.map(s => ({ value: s, label: s }));
  const sourceFilterOpts = sourceOptions.map(s => ({ value: s, label: s }));
  // Team column filter — multi-select Gurgaon (India) / Dubai. Server reads ?team=
  // as comma-separated now, so this combines with every other filter via AND.
  const teamFilterOpts = [{ value: "India", label: "🇮🇳 India" }, { value: "Dubai", label: "🇦🇪 Dubai" }];

  async function quickSetStatus(leadId: string, currentStatus: string) {
    await fetch(`/api/leads/${leadId}/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentStatus }),
    });
    setStatusOpenFor(null);
    router.refresh();
  }

  // Inline reassign (Admin/Manager) — set / clear a lead's owner from the list.
  // Reuses the SAME /update endpoint the Master Data agent cell + lead detail use:
  // the ownerId branch routes through assignLeadTo() (Assignment history + notify +
  // SLA) on assign, and clears the SLA on unassign, and records field-change history
  // both ways. "" (— Unassign —) sends null. Surfaces the server error (e.g. the
  // "reactivate a rejected lead first" 409) so the picker never silently no-ops.
  async function quickReassign(leadId: string, ownerId: string) {
    const r = await fetch(`/api/leads/${leadId}/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: ownerId || null }),
    });
    setReassignOpenFor(null);
    if (!r.ok) { const j = await r.json().catch(() => ({})); if (j.error) setRowMsg(j.error); return; }
    router.refresh();
  }

  function openPicker(leadId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (pickerOpenFor === leadId) { setPickerOpenFor(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Position below the button, aligned left. Clamp so it doesn't go off-screen right.
    const left = Math.min(rect.left, window.innerWidth - 210);
    setPickerPos({ top: rect.bottom + 6, left });
    setPickerOpenFor(leadId);
  }

  async function quickSetFollowup(leadId: string, date: string) {
    const post = (rescheduleReason?: string) => fetch(`/api/leads/${leadId}/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ followupDate: date || null, ...(rescheduleReason ? { rescheduleReason } : {}) }),
    });
    let r = await post();
    let j = await r.json().catch(() => ({})) as { error?: string; rescheduleReasonRequired?: boolean };
    // Follow-up-date-change protection (agents): server asks for a reason when no
    // contact activity today. Prompt + retry so the inline picker still works.
    if (!r.ok && j.rescheduleReasonRequired) {
      const reason = (typeof window !== "undefined"
        ? window.prompt("Please log an activity, or give a reason for changing the follow-up date:")
        : "")?.trim();
      if (reason) {
        r = await post(reason);
        j = await r.json().catch(() => ({})) as { error?: string };
      }
    }
    if (!r.ok && j.error) setRowMsg(j.error);
    setPickerOpenFor(null);
    router.refresh();
  }

  async function quickSetEnquiry(leadId: string, date: string) {
    if (!date) return;
    await fetch(`/api/leads/${leadId}/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createdAt: `${date}T00:00:00+05:30` }),
    });
    setEnquiryEditFor(null);
    router.refresh();
  }

  async function quickReject() {
    if (!deleteTarget || deleteBusy) return;
    if (!deleteNote.trim()) { alert("Reject remarks are required — explain why this lead is being rejected."); return; }
    setDeleteBusy(true);
    try {
      const r = await fetch(`/api/leads/${deleteTarget.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason, note: deleteNote.trim() }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setRowMsg(j.error ?? "Reject failed."); return; }
      setDeleteTarget(null); setDeleteNote("");
      router.refresh();
    } finally {
      setDeleteBusy(false);
    }
  }

  // Delete Lead — Super-Admin only. Soft-delete (kept in the archive, restorable).
  async function doDeleteLead() {
    if (!delLeadTarget || delLeadBusy) return;
    setDelLeadBusy(true);
    try {
      const r = await fetch(`/api/leads/${delLeadTarget.id}/delete`, { method: "POST" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setRowMsg(j.error ?? "Delete failed."); return; }
      setDelLeadTarget(null);
      router.refresh();
    } finally {
      setDelLeadBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === leads.length) setSelected(new Set());
    else setSelected(new Set(leads.map((l) => l.id)));
  }
  function clearSelection() {
    setSelected(new Set());
    setShowTagPopover(false);
    setShowReassignPopover(false);
    setShowRejectModal(false);
    setShowWaPopover(false);
    setPickedTags(new Set());
    setReassignPick("");
    setRejectReason("FUND_ISSUE");
    setRejectNote("");
    setWaTemplate("followup");
    setWaLinks([]);
    setWaSkipped([]);
    setBulkErr(null);
  }
  const allChecked = leads.length > 0 && selected.size === leads.length;

  // ESC closes any open popover/modal first, then clears selection.
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (statusOpenFor) { setStatusOpenFor(null); return; }
      if (reassignOpenFor) { setReassignOpenFor(null); return; }
      if (pickerOpenFor) { setPickerOpenFor(null); return; }
      if (showTagPopover || showReassignPopover || showRejectModal || showWaPopover) {
        setShowTagPopover(false);
        setShowReassignPopover(false);
        setShowRejectModal(false);
        setShowWaPopover(false);
      } else if (selected.size > 0) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [statusOpenFor, reassignOpenFor, showTagPopover, showReassignPopover, showRejectModal, showWaPopover, selected.size]);

  // Click outside to close floating popovers
  useEffect(() => {
    if (!statusOpenFor && !pickerOpenFor && !reassignOpenFor) return;
    const fn = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-status-popover]")) setStatusOpenFor(null);
      if (!target.closest("[data-picker-popover]")) setPickerOpenFor(null);
      if (!target.closest("[data-reassign-popover]")) setReassignOpenFor(null);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [statusOpenFor, pickerOpenFor, reassignOpenFor]);

  function togglePickedTag(t: string) {
    setPickedTags((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  async function applyBulkTag() {
    if (pickedTags.size === 0 || bulkBusy) return;
    setBulkBusy(true); setBulkErr(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tag", leadIds: selectedIds, addTags: Array.from(pickedTags) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      clearSelection();
      router.refresh();
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  async function applyBulkReassign() {
    if (!reassignPick || bulkBusy) return;
    setBulkBusy(true); setBulkErr(null); setBulkCrossTeamWarn(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reassign", leadIds: selectedIds, ownerId: reassignPick }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      if (j.crossTeamWarningMessage) {
        setBulkCrossTeamWarn(j.crossTeamWarningMessage);
      }
      clearSelection();
      router.refresh();
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  async function applyBulkDelete() {
    if (selectedIds.length === 0 || bulkBusy) return;
    setBulkBusy(true); setBulkErr(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids: selectedIds }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      setShowDeleteConfirm(false);
      clearSelection();
      router.refresh();
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  async function applyBulkReject() {
    if (bulkBusy) return;
    if (rejectReason === "OTHER" && !rejectNote.trim()) {
      setBulkErr("Please specify the reason in the note.");
      return;
    }
    setBulkBusy(true); setBulkErr(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", leadIds: selectedIds, reason: rejectReason, note: rejectNote.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      clearSelection();
      router.refresh();
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  // Bulk set follow-up date — agent-safe (API scopes to the caller's own leads).
  async function applyBulkFollowup() {
    if (bulkBusy) return;
    setBulkBusy(true); setBulkErr(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_followup", leadIds: selectedIds, followupDate: bulkFollowup ? `${bulkFollowup}T18:00:00+05:30` : null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      setShowFollowupPop(false); clearSelection(); router.refresh();
    } catch (e) { setBulkErr(`Network error: ${String(e).slice(0, 80)}`); }
    finally { setBulkBusy(false); }
  }

  // Bulk edit Source / Budget / Project — ADMIN only (server also enforces).
  async function applyBulkFields() {
    if (bulkBusy) return;
    if (!editSource && !editBudget && !editProject) { setBulkErr("Pick at least one field to set."); return; }
    setBulkBusy(true); setBulkErr(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_fields", leadIds: selectedIds,
          ...(editSource ? { source: editSource } : {}),
          ...(editBudget ? { budget: editBudget } : {}),
          ...(editProject ? { project: editProject } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      setShowEditPop(false); setEditSource(""); setEditBudget(""); setEditProject(""); clearSelection(); router.refresh();
    } catch (e) { setBulkErr(`Network error: ${String(e).slice(0, 80)}`); }
    finally { setBulkBusy(false); }
  }

  // Recalculate Currency — ADMIN only (server enforces). Re-derives budgetCurrency
  // for the selection against the current market rules / project mappings. Never
  // touches budgetRaw or the numeric values.
  async function recalcCurrency() {
    if (bulkBusy) return;
    setBulkBusy(true); setBulkErr(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recalc_currency", leadIds: selectedIds }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      setBulkErr(`Recalculated — ${j.updated ?? 0} of ${j.scanned ?? selectedIds.length} updated.`);
      clearSelection(); router.refresh();
    } catch (e) { setBulkErr(`Network error: ${String(e).slice(0, 80)}`); }
    finally { setBulkBusy(false); }
  }

  // Bulk WhatsApp can't send server-side (no Meta API) — the endpoint returns a
  // list of wa.me draft links the agent opens one by one. Each is also logged
  // as a PLANNED activity server-side.
  async function generateWaLinks() {
    if (bulkBusy) return;
    setBulkBusy(true); setBulkErr(null);
    setWaLinks([]); setWaSkipped([]);
    try {
      const r = await fetch("/api/leads/bulk-wa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: selectedIds, templateKey: waTemplate }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      setWaLinks(Array.isArray(j.links) ? j.links : []);
      setWaSkipped(Array.isArray(j.skipped) ? j.skipped : []);
      router.refresh(); // surface the new PLANNED activities
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  // Open every generated link with a 300ms stagger. Browsers may block all but
  // the first — the UI shows a hint to allow popups for this site.
  function openAllWa() {
    waLinks.forEach((l, i) => {
      setTimeout(() => window.open(l.waLink, "_blank", "noopener,noreferrer"), i * 300);
    });
  }

  return (
    <>
      {/* Non-blocking row-action message bar (parity with Buyer/Master lists).
          Replaces the old blocking alert() on per-row action failures; dismissible. */}
      {rowMsg && (
        <div className="mb-2 flex items-start justify-between gap-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <span className="min-w-0">{rowMsg}</span>
          <button type="button" onClick={() => setRowMsg(null)} className="shrink-0 text-red-400 hover:text-red-700 dark:hover:text-red-200" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* ── TABLE VIEW — desktop only; mobile falls through to cards below ─── */}
      {view === "table" && (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block card overflow-x-auto w-full">
            {(() => {
              // Build sort URL helper — no useSearchParams needed, params come via prop
              function sortHref(key: string): string {
                const params = new URLSearchParams(searchParamsStr);
                const cur = params.get("sort");
                const next = cur === `${key}_asc` ? `${key}_desc` : `${key}_asc`;
                params.set("sort", next);
                params.delete("page");
                return `${listBasePath}?${params.toString()}`;
              }
              function SortIcon({ k }: { k: string }) {
                const cur = new URLSearchParams(searchParamsStr).get("sort");
                if (cur === `${k}_asc`) return <span className="text-blue-500 ml-0.5">▲</span>;
                if (cur === `${k}_desc`) return <span className="text-blue-500 ml-0.5">▼</span>;
                return <span className="opacity-25 ml-0.5 text-[9px]">⇅</span>;
              }
              const WHEN: Record<string, string> = {
                IMMEDIATE: "⚡ Immediate", THIRTY_DAYS: "📅 1 Month",
                THREE_MONTHS: "✈ Visit Dubai", SIX_PLUS_MONTHS: "⏳ 6+ Months",
                WINDOW_SHOPPING: "📆 Window Shopping",
              };
              const thCls = "px-3 py-2 font-semibold text-gray-600 dark:text-slate-300 whitespace-nowrap text-left bg-gray-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wide";
              const sortThCls = `${thCls} cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/60 select-none`;
              // Total visible columns count (for colSpan on empty row)
              const colCount = 10 + (showSource ? 1 : 0);
              // Spec §6: Name·Status·Budget·Follow-Up·Assigned·Source(admin)·LastActivity·Actions
              // §1 Assigned=display-only · §4 C/NC removed · §5 Actions always visible
              return (
                <table className="w-full text-xs border-collapse" style={{ tableLayout: "fixed", minWidth: "1024px" }}>
                  <colgroup>
                    {/* checkbox */}<col style={{ width: 28 }} />
                    {/* date     */}<col style={{ width: 100 }} />
                    {/* time     */}<col style={{ width: 80 }} />
                    {/* name     */}<col style={{ width: 180 }} />
                    {/* project  */}<col style={{ width: 160 }} />
                    {/* status   */}<col style={{ width: 168 }} />
                    {/* budget   */}<col style={{ width: 90 }} />
                    {/* follow-up*/}<col style={{ width: 90 }} />
                    {!isAgent && <col style={{ width: 100 }} />}{/* assigned */}
                    {showSource && <col style={{ width: 75 }} />}
                    {!isAgent && <col style={{ width: 110 }} />}{/* activity */}
                    {/* actions  */}<col style={{ width: 230 }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-slate-700">
                      <th className={thCls}>
                        {canSel && <input type="checkbox" checked={allChecked} onChange={toggleAll} />}
                      </th>
                      <th className={sortThCls}>
                        <span onClick={() => router.push(sortHref("created"))}>Date <SortIcon k="created" /></span>
                        <LeadHeaderFilter kind="enquiry" label="Enquiry Date" searchParamsStr={searchParamsStr} />
                      </th>
                      <th className={thCls}>Time</th>
                      <th className={sortThCls}>
                        <span onClick={() => router.push(sortHref("name"))}>Name <SortIcon k="name" /></span>
                        <LeadHeaderFilter kind="search" paramKey="q" label="Name / phone / email" searchParamsStr={searchParamsStr} />
                      </th>
                      <th className={thCls}>
                        Property Enquired <LeadHeaderFilter kind="multi" paramKey="project" label="Property Enquired" options={projFilterOpts} searchParamsStr={searchParamsStr} />
                      </th>
                      <th className={sortThCls}>
                        <span onClick={() => router.push(sortHref("status"))}>Status <SortIcon k="status" /></span>
                        <LeadHeaderFilter kind="multi" paramKey="cstatus" label="Status" options={statusFilterOpts} orderedValues searchParamsStr={searchParamsStr} />
                      </th>
                      <th className={sortThCls}>
                        <span onClick={() => router.push(sortHref("budget"))}>Budget <SortIcon k="budget" /></span>
                        <LeadHeaderFilter kind="budget" label="Budget" searchParamsStr={searchParamsStr} />
                      </th>
                      <th className={sortThCls}>
                        <span onClick={() => router.push(sortHref("followup"))}>Follow-Up <SortIcon k="followup" /></span>
                        <LeadHeaderFilter kind="followup" label="Follow-up" searchParamsStr={searchParamsStr} />
                      </th>
                      {!isAgent && (
                        <th className={sortThCls}>
                          <span onClick={() => router.push(sortHref("owner"))}>Assigned <SortIcon k="owner" /></span>
                          {showSource && <LeadHeaderFilter kind="multi" paramKey="owner" label="Assigned to" options={agentFilterOpts} searchParamsStr={searchParamsStr} />}
                        </th>
                      )}
                      {showSource && (
                        <th className={thCls}>
                          Source
                          <LeadHeaderFilter kind="multi" paramKey="source" label="Source" options={sourceFilterOpts} searchParamsStr={searchParamsStr} />
                          {/* Team has no dedicated column in this dense table, so its
                              Excel filter rides along on the Source header (both are
                              admin-only metadata). Multi-select India/Dubai → ?team=. */}
                          <LeadHeaderFilter kind="multi" paramKey="team" label="Team" options={teamFilterOpts} searchParamsStr={searchParamsStr} />
                        </th>
                      )}
                      {!isAgent && (
                        <th className={thCls}>
                          Last Activity <LeadHeaderFilter kind="activity" label="Last Activity" searchParamsStr={searchParamsStr} />
                        </th>
                      )}
                      <th className={thCls}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.length === 0 && (
                      <tr><td colSpan={9 + (showSource ? 1 : 0)} className="px-4 py-10 text-center text-gray-400 text-sm">No records match these filters.</td></tr>
                    )}
                    {leads.map((l, i) => {
                      // Clock-gated: null until mounted so SSR/first-render match
                      // (fmtLastActivity uses Date.now()). Falls back to the "—" cell.
                      const lastAct = mounted ? fmtLastActivity(l.lastActivityType, l.lastActivityAt) : null;
                      return (
                      <tr key={l.id}
                        onClick={() => router.push(`${detailBasePath}/${l.id}`)}
                        className={`border-b border-gray-100 dark:border-slate-700/60 cursor-pointer hover:bg-blue-50/60 dark:hover:bg-blue-900/20 transition-colors ${
                          l.freshUntouchedToday
                            ? "bg-red-50/70 dark:bg-red-950/20 border-l-4 border-l-red-500"
                            : l.assignedToday
                              ? "bg-amber-50/60 dark:bg-amber-950/15 border-l-4 border-l-amber-400"
                              : i % 2 === 1 ? "bg-gray-50/30 dark:bg-slate-800/30" : "bg-white dark:bg-slate-800"}`}>

                        {/* 1. Checkbox */}
                        <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                          {canSel && <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />}
                        </td>

                        {/* 2. Enquiry DATE (own 100px column) — Admin: click to edit. */}
                        <td className="px-3 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis text-xs tabular-nums" onClick={e => e.stopPropagation()}>
                          {isAdmin ? (
                            enquiryEditFor === l.id ? (
                              <input
                                type="date"
                                autoFocus
                                className="text-xs border rounded px-1 py-0.5 w-[76px] dark:bg-slate-700 dark:border-slate-500 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                defaultValue={l.enquiryRaw ?? ""}
                                onBlur={() => setEnquiryEditFor(null)}
                                onChange={e => { if (e.target.value) quickSetEnquiry(l.id, e.target.value); }}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setEnquiryEditFor(l.id)}
                                className="text-gray-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:underline whitespace-nowrap"
                                title="Click to edit enquiry date"
                              >
                                {l.enquiryDate ?? <span className="text-gray-300">—</span>}
                              </button>
                            )
                          ) : (
                            <span className="text-gray-500 dark:text-slate-400">
                              {l.enquiryDate ?? <span className="text-gray-300">—</span>}
                            </span>
                          )}
                        </td>

                        {/* 2b. Enquiry TIME (own 80px column) — read-only. */}
                        <td className="px-3 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis text-xs tabular-nums text-gray-500 dark:text-slate-400" onClick={e => e.stopPropagation()}>
                          {l.enquiryTime ?? <span className="text-gray-300">—</span>}
                        </td>

                        {/* 3. Name — CLIENT NAME IS PRIMARY: always on its own line,
                            prominent, and never squeezed out by the freshness badges.
                            The badges sit BELOW the name, wrapping (secondary metadata). */}
                        <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-slate-100 min-w-[9rem]">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <Link href={`${detailBasePath}/${l.id}`} onClick={e => e.stopPropagation()}
                              className="hover:text-[#0b1a33] dark:hover:text-blue-300 hover:underline font-semibold truncate">{l.name || "—"}</Link>
                            <FreshBadges row={l} className="flex-wrap" />
                          </div>
                        </td>

                        {/* 4. Property Enquired — the CANONICAL `sourceDetail`
                            field, shown the same as lead-detail + Master Data.
                            Formal project link wins; else sourceDetail verbatim
                            (even free-text not in the master); a weak notesShort
                            remark only counts if it names a known project. */}
                        {(() => {
                          const proj = resolveEnquiredProperty(l.discussedProjects[0], l.interest, l.sourceDetail, l.projectHint, projectOptions);
                          return (
                            <td className="px-3 py-1.5 text-xs truncate" title={proj ?? ""}>
                              {proj
                                ? <span className="text-gray-700 dark:text-slate-200 font-medium">{proj}</span>
                                : <span className="text-gray-300 dark:text-slate-600">—</span>}
                            </td>
                          );
                        })()}

                        {/* 5. Status — floating popover, table never shifts */}
                        <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
                          <div className="relative" data-status-popover>
                            <button type="button"
                              onClick={() => setStatusOpenFor(statusOpenFor === l.id ? null : l.id)}
                              className={`${statusColor(l.currentStatus)} text-[10px] px-2 py-0.5 rounded-full border font-medium inline-flex items-center gap-0.5 max-w-full`}
                              title={l.currentStatus ?? ""}>
                              <span className="whitespace-nowrap">{l.currentStatus ?? "Set status"}</span>
                              <span className="shrink-0">▾</span>
                            </button>
                            {statusOpenFor === l.id && (
                              <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl w-52 max-h-72 overflow-y-auto py-1"
                                onClick={e => e.stopPropagation()}>
                                {l.team && (
                                  <div className="px-3 py-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-slate-700">
                                    {l.team} statuses
                                  </div>
                                )}
                                {selectableStatuses(l.team, meRole, l.currentStatus).map(s => (
                                  <button key={s} type="button"
                                    onClick={() => quickSetStatus(l.id, s)}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 ${l.currentStatus === s ? "font-semibold text-[#0b1a33] dark:text-blue-300" : "text-gray-700 dark:text-slate-200"}`}>
                                    <span className={`${statusColor(s)} px-1.5 py-0.5 rounded-full text-[9px] border shrink-0`}>{s}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 6. Budget */}
                        <td className="px-3 py-1.5 text-gray-700 dark:text-slate-300 whitespace-nowrap tabular-nums text-xs">
                          {l.budgetFormatted ?? <span className="text-gray-300">—</span>}
                        </td>

                        {/* 7. Follow-Up — click opens fixed-position picker */}
                        <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
                          <button type="button"
                            onClick={e => openPicker(l.id, e)}
                            className={`text-xs whitespace-nowrap ${l.followupDate ? "text-emerald-700 dark:text-emerald-400 font-medium" : "text-gray-300 hover:text-gray-400"}`}>
                            {l.followupDate ?? "—"}
                          </button>
                        </td>

                        {/* 6. Assigned — hidden for agents (they only ever see their own
                            leads). Admin/Manager (canReassign) get an inline owner picker
                            here — floating popover, same pattern as Status; the table never
                            shifts. Everyone else sees display-only text. */}
                        {!isAgent && (
                          <td className="px-3 py-1.5 text-gray-600 dark:text-slate-300 text-xs truncate" onClick={e => e.stopPropagation()}>
                            {canReassign ? (
                              <div className="relative" data-reassign-popover>
                                <button type="button"
                                  onClick={() => setReassignOpenFor(reassignOpenFor === l.id ? null : l.id)}
                                  className={`text-xs inline-flex items-center gap-0.5 hover:underline max-w-full ${l.owner ? "text-gray-600 dark:text-slate-300" : "text-amber-600 dark:text-amber-400 font-medium"}`}
                                  title="Click to reassign">
                                  <span className="truncate">{l.owner?.name ?? "Unassigned"}</span>
                                  <span className="shrink-0" aria-hidden>▾</span>
                                </button>
                                {reassignOpenFor === l.id && (
                                  <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl w-52 max-h-72 overflow-y-auto py-1"
                                    onClick={e => e.stopPropagation()}>
                                    <button type="button" onClick={() => quickReassign(l.id, "")}
                                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-400">
                                      — Unassign —
                                    </button>
                                    {agents.map(a => (
                                      <button key={a.id} type="button" onClick={() => quickReassign(l.id, a.id)}
                                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center justify-between gap-2 ${l.owner?.name === a.name ? "font-semibold text-[#0b1a33] dark:text-blue-300" : "text-gray-700 dark:text-slate-200"}`}>
                                        <span className="truncate">{a.name}</span>
                                        {a.team && <span className="text-[9px] text-gray-400 shrink-0">{a.team}</span>}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              l.owner?.name ?? <span className="text-amber-500 text-[10px]">Unassigned</span>
                            )}
                          </td>
                        )}

                        {/* 7. Source — admin/manager only (§2) */}
                        {showSource && (
                          <td className="px-3 py-1.5 text-gray-400 dark:text-slate-400 text-xs truncate">
                            {l.srcLabel}
                          </td>
                        )}

                        {/* 8. Last Activity — hidden for agents */}
                        {!isAgent && (
                          <td className="px-3 py-1.5 text-gray-500 dark:text-slate-400 text-xs truncate">
                            {lastAct ?? <span className="text-gray-300">—</span>}
                          </td>
                        )}

                        {/* 9. Actions — ALWAYS VISIBLE (§5: no invisible hover area) */}
                        <td className="px-2 py-1.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          {/* Actions column — ghost icons from the central Action
                              Design System (src/lib/actionDesign.ts). Same icon +
                              colour as these actions everywhere. Open Lead (not a
                              catalogued action) stays an ExternalLink. Handlers/
                              hrefs/permissions are unchanged. */}
                          <div className="flex items-center gap-0.5">
                            {l.phone && (
                              <ActionIconButton action="call" href={`tel:${l.phone}`} />
                            )}
                            {l.phone && (
                              <ActionIconButton action="whatsapp" href={whatsappLink(l.phone, "")} external />
                            )}
                            {/* Follow-up actions — Complete / Snooze / Escalate. Reuse the
                                SAME endpoints as the Action List + Lead View (DRY). The old
                                duplicate "Set follow-up" calendar button was removed — Snooze
                                covers rescheduling, and the lead detail still has the picker. */}
                            <ActionIconButton action="complete"
                              title={l.hasContactToday ? `Complete follow-up for ${l.name}` : "Contact attempt required before completing."}
                              disabled={actionBusy?.id === l.id || !l.hasContactToday}
                              onClick={() => doActionComplete(l.id)} />
                            {/* Snooze — opens the shared IST date/time picker (CRMDatePicker),
                                rendered as a compact ghost-icon chip. On confirm it reschedules
                                followupDate via the shared /action-snooze endpoint. */}
                            <RowSnoozeButton leadId={l.id} leadName={l.name} followupRaw={l.followupRaw} variant="ghost" onConfirm={doActionSnooze} />
                            <ActionIconButton action="escalate" title="Escalate to manager"
                              disabled={actionBusy?.id === l.id}
                              onClick={() => { setEscalateTarget({ id: l.id, name: l.name }); setEscalateReason(""); }} />
                            <Link href={`${detailBasePath}/${l.id}`} title="Open lead" onClick={e => e.stopPropagation()}
                              className="p-1.5 rounded-md text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                            {/* Reject lead — business outcome (kept in CRM, marked Lost). Visible to all. */}
                            <ActionIconButton
                              action="reject"
                              title="Reject lead"
                              onClick={() => { setDeleteTarget({ id: l.id, name: l.name }); setDeleteReason("NOT_INTERESTED"); setDeleteNote(""); }}
                            />
                            {/* Delete lead — Super-Admin (Lalit) only · removes from active CRM */}
                            {canDelete && (
                              <button type="button" title="Delete lead (Super Admin only)"
                                onClick={() => setDelLeadTarget({ id: l.id, name: l.name })}
                                className="p-1.5 rounded-md text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {/* Extra per-row action — e.g. Revival "Promote to Lead".
                                Default undefined on /leads (renders nothing). */}
                            {extraRowAction?.(l)}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </div>
          {/* ─── MOBILE CARDS (§7+§8) — dedicated layout, not a shrunken table ─── */}
          <div className="sm:hidden space-y-2">
            {leads.length === 0 && <div className="card p-5 text-center text-gray-500 text-sm">No records match these filters.</div>}
            {leads.map(l => (
              <div key={l.id} className={`rounded-xl border p-3 shadow-sm ${
                l.freshUntouchedToday
                  ? "bg-red-50/80 dark:bg-red-950/20 border-red-300 dark:border-red-800 border-l-4 border-l-red-500"
                  : l.assignedToday
                    ? "bg-amber-50/70 dark:bg-amber-950/15 border-amber-300 dark:border-amber-800 border-l-4 border-l-amber-400"
                    : "bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700"}`}>
                {/* Row 1: Name + Status badge */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <Link href={`${detailBasePath}/${l.id}`} className="font-bold text-sm text-[#0b1a33] dark:text-white truncate">
                    {l.name}
                  </Link>
                  <span className={`${statusColor(l.currentStatus)} text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0`}>
                    {l.currentStatus ?? "—"}
                  </span>
                </div>
                {(l.assignedToday || l.untouched) && (
                  <div className="mb-1.5"><FreshBadges row={l} /></div>
                )}
                {/* Row 2: Phone + Budget */}
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400 mb-1">
                  {l.phone && (
                    <span className="flex items-center gap-1 font-mono">
                      📞 {isAdmin ? l.phone : `···${l.phone.slice(-4)}`}
                    </span>
                  )}
                  {l.budgetFormatted && (
                    <span className="text-gray-700 dark:text-slate-300 font-medium">
                      💰 {l.budgetFormatted}
                    </span>
                  )}
                </div>
                {/* Row 3: Enquiry + Follow-up dates */}
                <div className="flex items-center gap-3 mb-2 text-[11px] flex-wrap">
                  {l.enquiryDate && (
                    <span className="text-gray-500 dark:text-slate-400">📥 Enquired: <span className="font-medium">{l.enquiryDate}</span></span>
                  )}
                  {l.followupDate && (
                    <span className="text-emerald-700 dark:text-emerald-400">📅 Follow-up: <span className="font-medium">{l.followupDate}</span></span>
                  )}
                </div>
                {/* Row 4: Action icons — ALWAYS VISIBLE on mobile (§8, no hover on touch) */}
                {/* Mobile quick actions — solid buttons from the central Action
                    Design System (compact size). Open Lead stays a Link. Handlers/
                    hrefs unchanged. */}
                <div className="flex items-center gap-1 pt-2 border-t border-gray-50 dark:border-slate-700 [&>*]:flex-1">
                  {l.phone && (
                    <ActionButton action="call" size="sm" href={`tel:${l.phone}`} label="Call" onClick={(e: React.MouseEvent) => e.stopPropagation()} />
                  )}
                  {l.phone && (
                    <ActionButton action="whatsapp" size="sm" href={whatsappLink(l.phone, "")} label="WA" external onClick={(e: React.MouseEvent) => e.stopPropagation()} />
                  )}
                  <Link href={`${detailBasePath}/${l.id}`}
                    className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-xs font-medium min-h-9"
                    onClick={e => e.stopPropagation()}>
                    <ExternalLink className="w-3.5 h-3.5" /> Open
                  </Link>
                </div>
                {/* Extra per-row action (mobile) — e.g. Revival "Promote to Lead". */}
                {extraRowAction && (
                  <div className="flex items-center gap-1 pt-1.5" onClick={e => e.stopPropagation()}>
                    {extraRowAction(l)}
                  </div>
                )}
                {/* Follow-up actions row (mobile) — Complete / Snooze / Escalate via the
                    shared endpoints. Separate row so the primary Call/WA/Open stay prominent. */}
                <div className="flex items-center gap-1 pt-1.5 [&>*]:flex-1">
                  <ActionButton action="complete" size="sm" label="Done"
                    title={l.hasContactToday ? undefined : "Contact attempt required before completing."}
                    disabled={actionBusy?.id === l.id || !l.hasContactToday} loading={actionBusy?.id === l.id && actionBusy.kind === "complete"}
                    onClick={() => doActionComplete(l.id)} />
                  <RowSnoozeButton leadId={l.id} leadName={l.name} followupRaw={l.followupRaw} variant="labeled" onConfirm={doActionSnooze} />
                  <ActionButton action="escalate" size="sm" label="Escalate"
                    disabled={actionBusy?.id === l.id} loading={actionBusy?.id === l.id && actionBusy.kind === "escalate"}
                    onClick={() => { setEscalateTarget({ id: l.id, name: l.name }); setEscalateReason(""); }} />
                </div>
                {/* Picker now rendered as fixed-position portal below */}
              </div>
            ))}
          </div>
        </>
      )}

      {/* CARD-VIEW FILTER TOOLBAR — same Excel-style column filters as the table
          headers, exposed as labeled chips since cards have no column headers.
          Drives the same URL params → combines with AND. */}
      {view !== "table" && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "thin" }}>
          <span className="text-[11px] font-semibold text-gray-400 dark:text-slate-500 shrink-0">Filter:</span>
          <LeadHeaderFilter showLabel kind="search" paramKey="q" label="Name" searchParamsStr={searchParamsStr} />
          <LeadHeaderFilter showLabel kind="enquiry" label="Enquiry Date" searchParamsStr={searchParamsStr} />
          <LeadHeaderFilter showLabel kind="multi" paramKey="project" label="Property Enquired" options={projFilterOpts} searchParamsStr={searchParamsStr} />
          <LeadHeaderFilter showLabel kind="multi" paramKey="cstatus" label="Status" options={statusFilterOpts} orderedValues searchParamsStr={searchParamsStr} />
          <LeadHeaderFilter showLabel kind="budget" label="Budget" searchParamsStr={searchParamsStr} />
          <LeadHeaderFilter showLabel kind="followup" label="Follow-up" searchParamsStr={searchParamsStr} />
          {showSource && <LeadHeaderFilter showLabel kind="multi" paramKey="owner" label="Assigned" options={agentFilterOpts} searchParamsStr={searchParamsStr} />}
          {showSource && <LeadHeaderFilter showLabel kind="multi" paramKey="source" label="Source" options={sourceFilterOpts} searchParamsStr={searchParamsStr} />}
          {showSource && <LeadHeaderFilter showLabel kind="multi" paramKey="team" label="Team" options={teamFilterOpts} searchParamsStr={searchParamsStr} />}
          <LeadHeaderFilter showLabel kind="activity" label="Last Activity" searchParamsStr={searchParamsStr} />
        </div>
      )}

      {/* CARD VIEW — mobile+desktop cards when view=cards */}
      <div className={`${view === "table" ? "hidden" : ""} lg:hidden space-y-2`}>
        {leads.length === 0 && <div className="card p-5 text-center text-gray-500 dark:text-slate-400 text-sm">No records match these filters.</div>}
        {leads.map((l) => {
          const maskedPhone = l.phone ? (isAdmin ? l.phone : `···${l.phone.slice(-4)}`) : null;
          const intel = l.intelligenceMatch;
          const nextAction = l.todoNext ?? (l.followupDate ? `Follow-up: ${l.followupDate}` : null);
          return (
            <div key={l.id} className={`card p-3 active:bg-amber-50 ${
              l.freshUntouchedToday
                ? "!bg-red-50/70 dark:!bg-red-950/20 border-l-4 border-l-red-500"
                : l.assignedToday ? "!bg-amber-50/60 dark:!bg-amber-950/15 border-l-4 border-l-amber-400" : ""}`}>
              <div className="flex items-start gap-2">
                {canSel && (
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="mt-1" />
                )}
                <Link href={`${detailBasePath}/${l.id}`} className="flex-1 min-w-0 block">
                  {/* Row 1: Name · Phone masked · Status */}
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="font-bold text-sm text-[#0b1a33] truncate">{l.name}</span>
                      <FreshBadges row={l} />
                      {maskedPhone && <span className="text-[10px] text-gray-400 dark:text-slate-500 font-mono flex-none">{maskedPhone}</span>}
                    </div>
                    <div className="flex items-center gap-1 flex-none relative" data-status-popover>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setStatusOpenFor(statusOpenFor === l.id ? null : l.id); }}
                        className={`${statusColor(l.currentStatus)} text-[10px] px-2 py-0.5 rounded-full border font-medium inline-flex items-center gap-0.5`}
                      >
                        {l.currentStatus ?? "Set status"}<span aria-hidden>▾</span>
                      </button>
                      {statusOpenFor === l.id && (
                        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl w-52 max-h-72 overflow-y-auto py-1"
                          onClick={e => e.stopPropagation()}>
                          {l.team && (
                            <div className="px-3 py-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-slate-700">
                              {l.team} statuses
                            </div>
                          )}
                          {selectableStatuses(l.team, meRole, l.currentStatus).map(s => (
                            <button key={s} type="button"
                              onClick={() => quickSetStatus(l.id, s)}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 ${l.currentStatus === s ? "font-semibold text-[#0b1a33] dark:text-blue-300" : "text-gray-700 dark:text-slate-200"}`}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Row 2: Budget · BANT · Need */}
                  <div className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-slate-300 mt-0.5 flex-wrap">
                    <span>💰 {l.budgetFormatted ?? "—"}</span>
                    <span className="text-gray-300 dark:text-slate-600">·</span>
                    <span>📋 BANT {l.bantCount}/4</span>
                    {l.needSummary && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span className="truncate max-w-[160px] text-gray-500 dark:text-slate-400">🎯 {l.needSummary}</span>
                      </>
                    )}
                  </div>
                  {/* Row 3: Projects · Intel · Last */}
                  <div className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-slate-400 mt-0.5 flex-wrap">
                    {l.discussedProjects.length > 0 ? (
                      l.discussedProjects.slice(0, 2).map((p, i) => (
                        <span key={i} className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1 py-0 rounded">{prettyProjectName(p, projectOptions) ?? p}</span>
                      ))
                    ) : l.interest ? (
                      <span className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1 py-0 rounded truncate max-w-[120px]">{prettyProjectName(l.interest, projectOptions) ?? l.interest}</span>
                    ) : null}
                    {intel?.matchType === "STRONG" && (
                      <span className="text-[9px] font-semibold px-1 py-0 rounded bg-red-100 text-red-700">🏠 Existing</span>
                    )}
                    {intel?.matchType === "MEDIUM" && (
                      <span className="text-[9px] font-semibold px-1 py-0 rounded bg-amber-100 text-amber-700">~ Possible</span>
                    )}
                    {l.lastTouched && (
                      // idleClass() colour + the >7-day idle chip are Date.now()-derived →
                      // gate both on `mounted`; the "· {lastTouched} ago" text is server-stable.
                      <span className={mounted ? idleClass(l.lastTouchedAt as string | null) : undefined}>
                        · {l.lastTouched} ago
                        {mounted && (() => { const d = l.lastTouchedAt ? (Date.now() - new Date(l.lastTouchedAt as string).getTime()) / (1000 * 60 * 60 * 24) : 0; return d > 7 ? <span className="ml-1 text-[10px] bg-red-100 text-red-700 px-1 rounded">idle</span> : null; })()}
                      </span>
                    )}
                  </div>
                  {/* Row 4: Next action · Owner */}
                  <div className="flex items-center justify-between mt-1 text-[10px]">
                    <span className="flex items-center gap-1 text-gray-500 dark:text-slate-400 truncate max-w-[180px]">
                      {nextAction ? (l.todoNext ? `📌 ${nextAction}` : `📅 ${nextAction}`) : ""}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPickerOpenFor(pickerOpenFor === l.id ? null : l.id); }}
                        className="text-gray-400 hover:text-blue-600 text-xs flex-none"
                        title="Set follow-up date"
                      >📅</button>
                      {pickerOpenFor === l.id && (
                        <input
                          type="date"
                          autoFocus
                          className="text-xs border rounded px-1 py-0.5"
                          defaultValue={l.followupRaw ?? ""}
                          onChange={(e) => quickSetFollowup(l.id, e.target.value)}
                        />
                      )}
                    </span>
                    {canReassign && l.owner && (
                      <span className={`avatar ${l.owner.avatarColor} inline-flex w-5 h-5 text-[9px]`} title={l.owner.name}>
                        {l.owner.name.split(" ").map((s: string) => s[0]).slice(0, 2).join("")}
                      </span>
                    )}
                  </div>
                </Link>
                {/* Direct-action call/WA buttons */}
                {l.phone && (
                  <div className="flex flex-col gap-1.5 flex-none items-center">
                    <a
                      href={telLink(l.phone) || "#"}
                      aria-label={`Call ${l.name}`}
                      className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm active:bg-emerald-700"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                    <a
                      href={whatsappLink(l.phone) || "#"}
                      target="_blank" rel="noopener noreferrer"
                      aria-label={`WhatsApp ${l.name}`}
                      className="w-10 h-10 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-sm active:bg-[#1ea953]"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                    {l.phone && <CopyPhoneButton phone={l.phone} />}
                  </div>
                )}
              </div>
              {/* Follow-up actions (cards view) — Complete / Snooze / Escalate via the
                  shared endpoints. Full-width row so they're tappable on touch. */}
              <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-50 dark:border-slate-700 [&>*]:flex-1">
                <ActionButton action="complete" size="sm" label="Done"
                  title={l.hasContactToday ? undefined : "Contact attempt required before completing."}
                  disabled={actionBusy?.id === l.id || !l.hasContactToday} loading={actionBusy?.id === l.id && actionBusy.kind === "complete"}
                  onClick={() => doActionComplete(l.id)} />
                <RowSnoozeButton leadId={l.id} leadName={l.name} followupRaw={l.followupRaw} variant="labeled" onConfirm={doActionSnooze} />
                <ActionButton action="escalate" size="sm" label="Escalate"
                  disabled={actionBusy?.id === l.id} loading={actionBusy?.id === l.id && actionBusy.kind === "escalate"}
                  onClick={() => { setEscalateTarget({ id: l.id, name: l.name }); setEscalateReason(""); }} />
                {extraRowAction?.(l)}
              </div>
            </div>
          );
        })}
      </div>

      {/* DESKTOP: Clean multi-column table (hidden in table mode — Excel table above handles it) */}
      <div className={`${view === "table" ? "hidden" : "hidden lg:block"} card overflow-x-auto`}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[#e5e7eb] dark:border-slate-700 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 bg-gray-50/80 dark:bg-slate-800/50">
              <th className="w-8 px-3 py-2.5">
                {canSel && <input type="checkbox" checked={allChecked} onChange={toggleAll} />}
              </th>
              <th className="px-3 py-2.5">Lead</th>
              <th className="px-3 py-2.5 w-36">Status</th>
              {canReassign && <th className="px-3 py-2.5 w-32">Assigned to</th>}
              <th className="px-3 py-2.5 w-60">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f1f3f5] dark:divide-slate-800">
            {leads.length === 0 && (
              <tr>
                <td colSpan={canReassign ? 5 : 4} className="text-center py-8 text-gray-500 dark:text-slate-400">
                  No records match these filters.
                </td>
              </tr>
            )}
            {leads.map((l) => {
              const maskedPhone = l.phone ? (isAdmin ? l.phone : `···${l.phone.slice(-4)}`) : null;
              const intel = l.intelligenceMatch;
              const nextAction = l.todoNext ?? (l.followupDate ? `Follow-up: ${l.followupDate}` : null);

              return (
                <tr
                  key={l.id}
                  className={`transition-colors hover:bg-amber-50/40 dark:hover:bg-slate-800/40 ${
                    l.freshUntouchedToday
                      ? "bg-red-50/70 dark:bg-red-950/20 border-l-4 border-l-red-500"
                      : l.assignedToday
                        ? "bg-amber-50/60 dark:bg-amber-950/15 border-l-4 border-l-amber-400"
                        : selected.has(l.id) ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-3 w-8 align-top">
                    {canSel && <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />}
                  </td>

                  {/* ── Lead Name + intel ── */}
                  <td className="px-3 py-3 align-top cursor-pointer" onClick={() => router.push(`${detailBasePath}/${l.id}`)}>
                    {/* Row 1: Name · Phone */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <span className="font-bold text-[#0b1a33] dark:text-white text-sm leading-tight">{l.name}</span>
                      <FreshBadges row={l} />
                      {maskedPhone && (
                        <span className="text-[11px] text-gray-400 dark:text-slate-500 font-mono">{maskedPhone}</span>
                      )}
                      {l.phone && <CopyPhoneButton phone={l.phone} />}
                      {intel?.matchType === "STRONG" && (
                        <span className="text-[9px] font-semibold px-1 py-0 rounded bg-red-100 text-red-700">🏠 Existing</span>
                      )}
                      {intel?.matchType === "MEDIUM" && (
                        <span className="text-[9px] font-semibold px-1 py-0 rounded bg-amber-100 text-amber-700">~ Possible</span>
                      )}
                    </div>
                    {/* Row 2: Budget · BANT · Need */}
                    <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-slate-400 flex-wrap">
                      <span>💰 {l.budgetFormatted ?? "—"}</span>
                      <span className="text-gray-300 dark:text-slate-600">·</span>
                      <span>BANT {l.bantCount}/4</span>
                      {l.needSummary && (
                        <><span className="text-gray-300 dark:text-slate-600">·</span>
                        <span className="truncate max-w-[200px] text-gray-500 dark:text-slate-400">🎯 {l.needSummary}</span></>
                      )}
                    </div>
                    {/* Row 3: Projects · Last touch · Next action */}
                    <div className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500 mt-0.5 flex-wrap">
                      {l.discussedProjects.length > 0 ? (
                        l.discussedProjects.slice(0, 3).map((p, i) => (
                          <span key={i} className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 rounded text-[10px]">{prettyProjectName(p, projectOptions) ?? p}</span>
                        ))
                      ) : l.interest ? (
                        <span className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 rounded text-[10px] truncate max-w-[120px]">{prettyProjectName(l.interest, projectOptions) ?? l.interest}</span>
                      ) : null}
                      {l.lastTouched && (
                        // Clock-gated like the card view: keep the static `ml-1` layout class
                        // stable, add the Date.now()-derived idleClass colour + idle chip only
                        // after mount so SSR and first client render stay identical.
                        <span className={mounted ? `${idleClass(l.lastTouchedAt as string | null)} ml-1` : "ml-1"}>
                          · {l.lastTouched} ago
                          {mounted && (() => {
                            const d = l.lastTouchedAt ? (Date.now() - new Date(l.lastTouchedAt as string).getTime()) / (1000 * 60 * 60 * 24) : 0;
                            return d > 7 ? <span className="ml-1 text-[10px] bg-red-100 text-red-700 px-1 rounded">idle</span> : null;
                          })()}
                        </span>
                      )}
                      {nextAction && (
                        <span className="text-gray-400 dark:text-slate-500 truncate max-w-[150px]">
                          · {l.todoNext ? `📌 ${nextAction}` : `📅 ${nextAction}`}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* ── Status chip (floating popover) ── */}
                  <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                    <div className="relative" data-status-popover>
                      <button type="button"
                        onClick={() => setStatusOpenFor(statusOpenFor === l.id ? null : l.id)}
                        className={`${statusColor(l.currentStatus)} text-[10px] px-2 py-0.5 rounded-full border font-medium inline-flex items-center gap-0.5 whitespace-nowrap`}>
                        {l.currentStatus ?? "Set status"}<span aria-hidden>▾</span>
                      </button>
                      {statusOpenFor === l.id && (
                        <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl w-52 max-h-64 overflow-y-auto py-1"
                          onClick={e => e.stopPropagation()}>
                          {l.team && (
                            <div className="px-3 py-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-slate-700">
                              {l.team} statuses
                            </div>
                          )}
                          {selectableStatuses(l.team, meRole, l.currentStatus).map(s => (
                            <button key={s} type="button"
                              onClick={() => quickSetStatus(l.id, s)}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 ${l.currentStatus === s ? "font-semibold text-[#0b1a33] dark:text-blue-300" : "text-gray-700 dark:text-slate-200"}`}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* ── Assigned to — admin/manager only. Inline owner picker (same
                      audited /update ownerId path as the table + Master Data). ── */}
                  {canReassign && (
                    <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                      <div className="relative" data-reassign-popover>
                        <button type="button"
                          onClick={() => setReassignOpenFor(reassignOpenFor === l.id ? null : l.id)}
                          className="inline-flex items-center gap-1.5 hover:opacity-80 max-w-full"
                          title="Click to reassign">
                          {l.owner ? (
                            <>
                              <span
                                className={`avatar ${l.owner.avatarColor} w-6 h-6 text-[9px] flex-none inline-flex items-center justify-center rounded-full font-bold`}
                                title={l.owner.name}
                              >
                                {l.owner.name.split(" ").map((s: string) => s[0]).slice(0, 2).join("")}
                              </span>
                              <span className="text-xs text-gray-600 dark:text-slate-300 truncate max-w-[72px]" title={l.owner.name}>
                                {l.owner.name.split(" ")[0]}
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Unassigned</span>
                          )}
                          <span className="shrink-0 text-gray-400" aria-hidden>▾</span>
                        </button>
                        {reassignOpenFor === l.id && (
                          <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl w-52 max-h-72 overflow-y-auto py-1"
                            onClick={e => e.stopPropagation()}>
                            <button type="button" onClick={() => quickReassign(l.id, "")}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-400">
                              — Unassign —
                            </button>
                            {agents.map(a => (
                              <button key={a.id} type="button" onClick={() => quickReassign(l.id, a.id)}
                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center justify-between gap-2 ${l.owner?.name === a.name ? "font-semibold text-[#0b1a33] dark:text-blue-300" : "text-gray-700 dark:text-slate-200"}`}>
                                <span className="truncate">{a.name}</span>
                                {a.team && <span className="text-[9px] text-gray-400 shrink-0">{a.team}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  )}

                  {/* ── Actions ── */}
                  <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                    {/* Actions — solid icon chips from the central Action Design
                        System (src/lib/actionDesign.ts), so Call / WhatsApp /
                        Follow-up / Email / Reject match the same actions everywhere
                        (this view previously diverged: blue Call, amber follow-up,
                        sky Email, red-500 Reject). Open Lead (Pencil) stays bespoke.
                        Handlers/hrefs/permissions unchanged. */}
                    <div className="flex items-center gap-1 flex-nowrap [&>*]:flex-none">

                      {/* 1. Call */}
                      {l.phone && (
                        <ActionIconButton action="call" variant="solid" href={telLink(l.phone) || "#"} title={`Call ${l.name}`} />
                      )}

                      {/* 2. WhatsApp — brand glyph */}
                      {l.phone && (
                        <ActionIconButton action="whatsapp" variant="solid" href={whatsappLink(l.phone) || "#"} title={`WhatsApp ${l.name}`} external />
                      )}

                      {/* 3. Follow-up actions — Complete / Snooze / Escalate via the shared
                          endpoints (same as the table + Lead View). The old duplicate
                          "Set follow-up date" calendar button was removed. */}
                      <ActionIconButton action="complete" variant="solid"
                        title={l.hasContactToday ? `Complete follow-up for ${l.name}` : "Contact attempt required before completing."}
                        disabled={actionBusy?.id === l.id || !l.hasContactToday} onClick={() => doActionComplete(l.id)} />
                      <RowSnoozeButton leadId={l.id} leadName={l.name} followupRaw={l.followupRaw} variant="solid" onConfirm={doActionSnooze} />
                      <ActionIconButton action="escalate" variant="solid" title="Escalate to manager"
                        disabled={actionBusy?.id === l.id} onClick={() => { setEscalateTarget({ id: l.id, name: l.name }); setEscalateReason(""); }} />

                      {/* 4. Email */}
                      {l.email && (
                        <ActionIconButton action="email" variant="solid" href={`mailto:${l.email}`} title={`Email ${l.name}`} />
                      )}

                      {/* 5. Edit / Open lead (not a catalogued action) */}
                      <button type="button" title="Open lead"
                        onClick={() => router.push(`${detailBasePath}/${l.id}`)}
                        className="w-8 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors flex-none">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      {/* 6. Reject lead — business outcome (kept in CRM, marked Lost). Visible to all. */}
                      <ActionIconButton action="reject" variant="solid" title="Reject lead"
                        onClick={() => { setDeleteTarget({ id: l.id, name: l.name }); setDeleteReason("NOT_INTERESTED"); setDeleteNote(""); }} />

                      {/* 7. Delete lead — Super-Admin (Lalit) only · removes from active CRM */}
                      {canDelete && (
                        <button type="button" title="Delete lead (Super Admin only)"
                          onClick={() => setDelLeadTarget({ id: l.id, name: l.name })}
                          className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-black text-white flex items-center justify-center transition-colors flex-none">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* 8. Extra per-row action — e.g. Revival "Promote to Lead". */}
                      {extraRowAction?.(l)}

                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* ─── Bulk action bar (Tag · WhatsApp · Reassign · Reject) ─────
          Sticky bottom bar; appears when rows are selected.
          Safe-bottom inset so iPhone home indicator doesn't eat buttons. */}
      {canSel && selectedIds.length > 0 && (
        <>
          {/* Compact floating action pill — centered, fitted, premium (not a full-width white strip). */}
          <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 pt-0 pointer-events-none safe-bottom">
            <div className="pointer-events-auto mx-auto w-fit max-w-full flex items-center gap-1.5 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm border border-[#e5e7eb] dark:border-slate-700 rounded-2xl shadow-[0_10px_34px_rgba(11,26,51,0.20)] px-2.5 py-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              <div className="text-xs font-bold text-[#0b1a33] dark:text-white whitespace-nowrap pl-1">
                {selectedIds.length} <span className="font-medium text-gray-500 dark:text-slate-400">selected</span>
              </div>
              <button
                onClick={clearSelection}
                className="text-[11px] text-gray-400 dark:text-slate-500 hover:text-gray-800 dark:hover:text-slate-200 underline whitespace-nowrap"
              >
                Clear
              </button>
              <div className="w-px h-5 bg-gray-200 dark:bg-slate-600 mx-0.5 flex-none" />
              {/* Follow-up — everyone (agents + admin), API scopes to own leads */}
              <button
                onClick={() => { setShowFollowupPop(v => !v); setShowTagPopover(false); setShowWaPopover(false); setShowReassignPopover(false); setShowEditPop(false); }}
                className="inline-flex items-center gap-1 text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-300 px-2.5 py-1.5 rounded-lg whitespace-nowrap flex-none"
              >
                <Calendar className="w-3.5 h-3.5" /> Follow-up
              </button>
              {canBulk && (
                <button
                  onClick={() => { setShowTagPopover(v => !v); setShowReassignPopover(false); setShowWaPopover(false); setShowFollowupPop(false); setShowEditPop(false); }}
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-fuchsia-50 text-fuchsia-800 border border-fuchsia-300 px-2.5 py-1.5 rounded-lg whitespace-nowrap flex-none"
                >
                  <Tag className="w-3.5 h-3.5" /> Tag
                </button>
              )}
              {canBulk && (
                <button
                  onClick={() => { setShowWaPopover(v => !v); setShowTagPopover(false); setShowReassignPopover(false); setShowFollowupPop(false); setShowEditPop(false); }}
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-[#e7f9ef] text-[#0f7a3d] border border-[#9ce0bb] px-2.5 py-1.5 rounded-lg whitespace-nowrap flex-none"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => { setShowEditPop(v => !v); setShowTagPopover(false); setShowWaPopover(false); setShowReassignPopover(false); setShowFollowupPop(false); }}
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 px-2.5 py-1.5 rounded-lg whitespace-nowrap flex-none"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit fields
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={recalcCurrency}
                  disabled={bulkBusy}
                  title="Re-derive AED/INR from current market rules. Does not change the original budget text or the numbers."
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 px-2.5 py-1.5 rounded-lg whitespace-nowrap flex-none disabled:opacity-50"
                >
                  ₹/AED Recalc currency
                </button>
              )}
              {canReassign && (
                <button
                  onClick={() => { setShowReassignPopover(v => !v); setShowTagPopover(false); setShowWaPopover(false); setShowFollowupPop(false); setShowEditPop(false); }}
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-300 px-2.5 py-1.5 rounded-lg whitespace-nowrap flex-none"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reassign
                </button>
              )}
              {canBulk && (
                <button
                  onClick={() => { setShowRejectModal(true); setShowTagPopover(false); setShowReassignPopover(false); setShowWaPopover(false); setShowFollowupPop(false); setShowEditPop(false); }}
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-red-50 text-red-800 border border-red-300 px-2.5 py-1.5 rounded-lg whitespace-nowrap flex-none"
                >
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </button>
              )}
              {/* Bulk Delete — Super-Admin (Lalit) only. Soft delete, restorable. */}
              {canDelete && (
                <button
                  onClick={() => { setShowDeleteConfirm(true); setShowTagPopover(false); setShowReassignPopover(false); setShowWaPopover(false); setShowFollowupPop(false); setShowEditPop(false); }}
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-red-600 text-white border border-red-700 px-2.5 py-1.5 rounded-lg whitespace-nowrap flex-none hover:bg-red-700"
                  title="Soft-delete selected leads — archived & restorable (Super Admin)"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>

            {/* Bulk delete confirm — Super-Admin only. Soft delete (restorable). */}
            {showDeleteConfirm && canDelete && (
              <div className="pointer-events-auto absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-sm bottom-full mb-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-900/60 rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-bold text-red-700 dark:text-red-300">Delete {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}?</div>
                  <button onClick={() => setShowDeleteConfirm(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
                  Moves them to the archive and hides them from every list. Nothing is permanently erased — you can restore them anytime from the deleted-leads archive.
                </p>
                {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-ghost text-xs">Cancel</button>
                  <button onClick={applyBulkDelete} disabled={bulkBusy} className="inline-flex items-center gap-1 text-xs font-semibold bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" /> {bulkBusy ? "Deleting…" : `Delete ${selectedIds.length}`}
                  </button>
                </div>
              </div>
            )}

            {/* Follow-up popover — bulk set/clear the follow-up date. */}
            {showFollowupPop && (
              <div className="pointer-events-auto absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-sm bottom-full mb-2 bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-slate-700 rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33] dark:text-white">Set follow-up for {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}</div>
                  <button onClick={() => setShowFollowupPop(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
                <input type="date" value={bulkFollowup} onChange={(e) => setBulkFollowup(e.target.value)}
                  className="w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 mb-3" />
                {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                <div className="flex justify-between gap-2">
                  <button onClick={() => { setBulkFollowup(""); applyBulkFollowup(); }} disabled={bulkBusy} className="btn btn-ghost text-xs">Clear date</button>
                  <button onClick={applyBulkFollowup} disabled={bulkBusy || !bulkFollowup} className="btn btn-primary text-xs">{bulkBusy ? "Saving…" : "Apply"}</button>
                </div>
              </div>
            )}

            {/* Edit-fields popover (ADMIN) — Source / Budget / Project in bulk. */}
            {showEditPop && isAdmin && (
              <div className="pointer-events-auto absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-sm bottom-full mb-2 bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-slate-700 rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33] dark:text-white">Edit {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"} <span className="font-normal text-gray-400">— fill only what you want to change</span></div>
                  <button onClick={() => setShowEditPop(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
                <label className="text-[11px] font-semibold text-gray-500 dark:text-slate-400">Source</label>
                <select value={editSource} onChange={(e) => setEditSource(e.target.value)} className="w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 mb-2 mt-0.5">
                  <option value="">— leave unchanged —</option>
                  {allowedSourceOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <label className="text-[11px] font-semibold text-gray-500 dark:text-slate-400">Budget</label>
                <input value={editBudget} onChange={(e) => setEditBudget(e.target.value)} placeholder="e.g. 2.5M · 30L · 3Cr · 2000000" className="w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 mb-2 mt-0.5" />
                <label className="text-[11px] font-semibold text-gray-500 dark:text-slate-400">Project</label>
                <input list="bulk-proj-list" value={editProject} onChange={(e) => setEditProject(e.target.value)} placeholder="— leave unchanged —" className="w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 mb-3 mt-0.5" />
                <datalist id="bulk-proj-list">{projectOptions.slice(0, 300).map(p => <option key={p} value={p} />)}</datalist>
                {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowEditPop(false)} className="btn btn-ghost text-xs">Cancel</button>
                  <button onClick={applyBulkFields} disabled={bulkBusy || (!editSource && !editBudget && !editProject)} className="btn btn-primary text-xs">{bulkBusy ? "Saving…" : "Apply"}</button>
                </div>
              </div>
            )}

            {/* Tag popover — multi-select checkbox grid. Anchored above the
                bar via absolute positioning relative to viewport (mb-2 from
                the bar by stacking it just above with bottom-full). */}
            {showTagPopover && (
              <div className="pointer-events-auto absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md bottom-full mb-2 bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-slate-700 rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33] dark:text-white">Add tags to {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}</div>
                  <button onClick={() => setShowTagPopover(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {PRESET_TAGS.map((t) => {
                    const on = pickedTags.has(t);
                    return (
                      <button
                        key={t}
                        onClick={() => togglePickedTag(t)}
                        className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border ${on ? "bg-fuchsia-600 text-white border-fuchsia-600" : "bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-100 border-[#e5e7eb] dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600"}`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
                {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowTagPopover(false)} className="btn btn-ghost text-xs">Cancel</button>
                  <button
                    onClick={applyBulkTag}
                    disabled={bulkBusy || pickedTags.size === 0}
                    className="btn btn-primary text-xs"
                  >
                    {bulkBusy ? "Applying…" : `Apply (${pickedTags.size})`}
                  </button>
                </div>
              </div>
            )}

            {/* Reassign popover — single-select agent dropdown. */}
            {showReassignPopover && canReassign && (
              <div className="pointer-events-auto absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md bottom-full mb-2 bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-slate-700 rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33] dark:text-white">Reassign {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}</div>
                  <button onClick={() => setShowReassignPopover(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
                <select
                  value={reassignPick}
                  onChange={(e) => setReassignPick(e.target.value)}
                  className="w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 mb-3"
                >
                  <option value="">Pick an agent…</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>)}
                </select>
                {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                {bulkCrossTeamWarn && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">⚠️ {bulkCrossTeamWarn}</div>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowReassignPopover(false)} className="btn btn-ghost text-xs">Cancel</button>
                  <button
                    onClick={applyBulkReassign}
                    disabled={bulkBusy || !reassignPick}
                    className="btn btn-primary text-xs"
                  >
                    {bulkBusy ? "Reassigning…" : "Apply"}
                  </button>
                </div>
              </div>
            )}

            {/* WhatsApp popover — pick a template, generate wa.me draft links.
                WhatsApp can't be sent server-side (no Meta API), so the agent
                opens each link one-by-one (or "Open all" with a 300ms stagger). */}
            {showWaPopover && (
              <div className="pointer-events-auto absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md bottom-full mb-2 bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-slate-700 rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33] dark:text-white inline-flex items-center gap-1.5">
                    <MessageCircle className="w-4 h-4 text-[#0f7a3d]" />
                    WhatsApp {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}
                  </div>
                  <button onClick={() => setShowWaPopover(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>

                {waLinks.length === 0 && waSkipped.length === 0 ? (
                  <>
                    <label className="text-[11px] font-semibold text-gray-600 dark:text-slate-300">Template</label>
                    <select
                      value={waTemplate}
                      onChange={(e) => setWaTemplate(e.target.value)}
                      className="w-full mt-1 mb-3 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
                    >
                      {WA_PRESETS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
                    </select>
                    {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowWaPopover(false)} className="btn btn-ghost text-xs">Cancel</button>
                      <button
                        onClick={generateWaLinks}
                        disabled={bulkBusy}
                        className="btn btn-primary text-xs"
                      >
                        {bulkBusy ? "Generating…" : "Generate links"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
                      {waLinks.length} link{waLinks.length === 1 ? "" : "s"} ready. Tap each to open WhatsApp with the message pre-typed, then hit Send.
                      {waLinks.length > 1 && " “Open all” staggers them — your browser may block extras, so allow popups for this site."}
                    </p>
                    {waLinks.length > 0 && (
                      <div className="max-h-56 overflow-y-auto border border-[#eef0f3] rounded-lg divide-y divide-[#f1f3f5] mb-2">
                        {waLinks.map((l) => (
                          <a
                            key={l.leadId}
                            href={l.waLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-[#f3fbf6]"
                          >
                            <span className="truncate font-medium text-[#0b1a33]">Open WhatsApp — {l.name}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-[#0f7a3d] flex-none" />
                          </a>
                        ))}
                      </div>
                    )}
                    {waSkipped.length > 0 && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
                        Skipped {waSkipped.length} (no phone): {waSkipped.slice(0, 5).map(s => s.name).join(", ")}{waSkipped.length > 5 ? "…" : ""}
                      </div>
                    )}
                    <div className="flex justify-between gap-2">
                      <button
                        onClick={() => { setWaLinks([]); setWaSkipped([]); setBulkErr(null); }}
                        className="btn btn-ghost text-xs"
                      >
                        Back
                      </button>
                      {waLinks.length > 0 && (
                        <button onClick={openAllWa} className="btn btn-primary text-xs">
                          Open all ({waLinks.length})
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Reject modal — full-screen overlay so the textarea has room. */}
          {showRejectModal && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" {...backdropProps(() => !bulkBusy && setShowRejectModal(false))}>
              <div
                className="bg-white dark:bg-slate-800 sm:rounded-xl rounded-t-2xl max-w-md w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto safe-bottom"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-lg flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-red-600" />
                    Reject {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}
                  </div>
                  <button onClick={() => setShowRejectModal(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
                  Each lead is marked LOST, removed from Today's follow-ups, and the reason is recorded in Reports.
                </p>

                <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Reason *</label>
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full mt-1 mb-3 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
                >
                  {REJECT_REASONS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>

                <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">
                  {rejectReason === "OTHER" ? "Specify *" : "Note (optional)"}
                </label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={3}
                  placeholder={
                    rejectReason === "OTHER"
                      ? "e.g. Client passed away, moved abroad, family dispute…"
                      : "Add context — what did they say?"
                  }
                  className="w-full mt-1 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-[13px] dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
                />

                {bulkErr && <div className="text-xs text-red-600 mt-2">{bulkErr}</div>}

                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowRejectModal(false)} className="btn btn-ghost">Cancel</button>
                  <button
                    onClick={applyBulkReject}
                    disabled={bulkBusy}
                    className="btn bg-red-600 hover:bg-red-700 text-white"
                  >
                    {bulkBusy ? "Rejecting…" : `Reject ${selectedIds.length}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {/* ── Delete / Reject confirm modal ── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          {...backdropProps(() => !deleteBusy && setDeleteTarget(null))}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-xl max-w-sm w-full p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-500 flex-none" />
              <span className="font-semibold text-base">Reject &quot;{deleteTarget.name}&quot;?</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              Lead is kept in the CRM, marked Lost, and moves out of the active queue (still searchable &amp; recoverable).
            </p>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Reason</label>
            <select
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              className="w-full mt-1 mb-3 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100"
            >
              {REJECT_REASON_LIST.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">
              Reject Remarks / Reason Details <span className="text-red-600">*</span>
            </label>
            <textarea
              value={deleteNote}
              onChange={(e) => setDeleteNote(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="Explain why this lead is being rejected…"
              className="w-full mt-1 mb-4 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setDeleteTarget(null); setDeleteNote(""); }} className="btn btn-ghost text-sm">
                Cancel
              </button>
              <button
                onClick={quickReject}
                disabled={deleteBusy}
                className="btn bg-red-600 hover:bg-red-700 text-white text-sm"
              >
                {deleteBusy ? "Rejecting…" : "Reject Lead"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Escalate modal — optional reason, then POST /api/leads/[id]/action-escalate
          (the SAME endpoint the Action List + Lead View use). Sets needsManagerReview
          + notifies the owner's manager + admins + logs a Smart-Timeline entry. */}
      {escalateTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" {...backdropProps(() => !actionBusy && setEscalateTarget(null))}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-sm w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              {(() => { const Up = ACTION_TOKENS.escalate.icon; return <Up className={`w-4 h-4 flex-none ${ACTION_TOKENS.escalate.iconColor}`} />; })()}
              <span className="font-semibold text-base">Escalate &quot;{escalateTarget.name}&quot; to manager?</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              Flags the lead for your manager &amp; admins (in-app + push) and records it on the timeline. Add a short reason so they know why.
            </p>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Reason (optional)</label>
            <textarea
              value={escalateReason}
              onChange={(e) => setEscalateReason(e.target.value.slice(0, 500))}
              rows={3}
              autoFocus
              placeholder="e.g. Client wants a 30% discount, need approval"
              className="w-full mt-1 mb-4 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setEscalateTarget(null); setEscalateReason(""); }} className="btn btn-ghost text-sm">Cancel</button>
              <button
                onClick={() => doActionEscalate(escalateTarget.id)}
                disabled={!!actionBusy}
                className="btn bg-red-600 hover:bg-red-700 text-white text-sm"
              >
                {actionBusy?.kind === "escalate" ? "Sending…" : "Escalate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Lead confirmation — Super-Admin (Lalit) only */}
      {delLeadTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !delLeadBusy && setDelLeadTarget(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-sm w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Trash2 className="w-4 h-4 text-gray-800 dark:text-slate-200 flex-none" />
              <span className="font-semibold text-base">Delete &quot;{delLeadTarget.name}&quot;?</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-300 mb-1">
              Are you sure you want to permanently remove this lead from the active CRM?
            </p>
            <p className="text-xs text-gray-400 mb-4">
              It moves to the Super-Admin Archive with a full snapshot (who / when) and can be restored — nothing is destroyed.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelLeadTarget(null)} disabled={delLeadBusy} className="btn btn-ghost text-sm">Cancel</button>
              <button onClick={doDeleteLead} disabled={delLeadBusy} className="btn bg-gray-900 hover:bg-black text-white text-sm">
                {delLeadBusy ? "Deleting…" : "Delete Lead"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fixed-position follow-up date picker ──────────────────────────
          Rendered ONCE outside all tables/cards so it always appears exactly
          below the button that opened it — no table overflow clipping. */}
      {pickerOpenFor && (() => {
        const row = leads.find(l => l.id === pickerOpenFor);
        return (
          <div
            data-picker-popover
            style={{ position: "fixed", top: pickerPos.top, left: pickerPos.left, zIndex: 9999 }}
            className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-2xl p-4 w-56"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-[11px] font-semibold text-gray-600 dark:text-slate-300 mb-2">📅 Set follow-up date</div>
            <input
              type="date"
              autoFocus
              className="text-sm border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-300 w-full"
              defaultValue={row?.followupRaw ?? ""}
              onChange={e => {
                if (e.target.value) quickSetFollowup(pickerOpenFor, e.target.value);
              }}
            />
            {row?.followupDate && (
              <button
                type="button"
                onClick={() => quickSetFollowup(pickerOpenFor, "")}
                className="mt-2 text-xs text-red-500 hover:text-red-700 w-full text-left"
              >
                × Clear date
              </button>
            )}
          </div>
        );
      })()}

    </>
  );
}
