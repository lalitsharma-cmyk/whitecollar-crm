"use client";

// Unified conversation timeline — calls · WhatsApp · notes · imported remarks.
// Redesigned 2026-06 per Lalit's spec:
//   • No technical labels ("Historical Note", "Imported From Excel", etc.)
//   • Agent ownership shown where known (Yasir • 15 Jan 2025)
//   • Consecutive missed calls grouped ("Call not picked 8 times, 05 Jan–12 Jan")
//   • Site Visit / Meeting / Virtual Meeting summaries surfaced separately
//   • All entries visible; nothing discarded

import { useState, useMemo, Fragment } from "react";
import { useRouter } from "next/navigation";
import { fmtIST12Paren } from "@/lib/datetime";
import { canonicalAgentName } from "@/lib/agentName";
import { canEditRemark } from "@/lib/remarkPerms";
import type { CallLog, WhatsAppMessage } from "@prisma/client";
import {
  parseRemarksTimeline,
  groupEntries,
  mergeSameMoment,
  toReadableParagraph,
  isMissedCall,
  remarkKeyFor,
  type DisplayEntry,
  type RemarkEntry,
  type RemarkEventType,
} from "@/lib/remarkParser";
import RemarkControlMenu, { type RemarkControlState } from "@/components/RemarkControlMenu";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NoteWithUser {
  id: string;
  body: string;
  createdAt: Date;
  userId?: string | null;
  user: { name: string } | null;
}

type CallLogWithUser = CallLog & { user: { name: string } };

interface Props {
  callLogs: CallLogWithUser[];
  waMessages: WhatsAppMessage[];
  notes?: NoteWithUser[];
  forwardedTeam?: string | null;
  rawRemarks?: string | null;
  /** Lead creation date — fallback for undated remarks with no preceding date */
  leadCreatedAt?: Date | null;
  /** Active CRM agents — used for roster-based attribution in remarks */
  agentNames?: string[];
  // ── Conversation moderation (Lalit-only) ──
  /** Lead id — needed by the per-remark control API */
  leadId?: string;
  /** True only for users with canControlConversations (Lalit). Shows ⋯ controls. */
  canControl?: boolean;
  /** Current viewer id — used to apply per-agent hiding for non-controllers */
  viewerId?: string;
  /** Current viewer team — used to apply per-team hiding for non-controllers */
  viewerTeam?: string | null;
  /** Visibility overlays for this lead's remarks, keyed by remarkKey */
  controls?: Array<{ remarkKey: string } & RemarkControlState>;
  /** Agent roster (id+name) for the "hide from agent" picker */
  agents?: { id: string; name: string }[];
  /** True for ADMIN/Super-Admin — shows the inline ✏️ Edit affordance on notes. */
  isAdmin?: boolean;
  /** Current viewer's user id — used for own-note edit gating. */
  meId?: string;
  /** Current viewer's role ("ADMIN" | "MANAGER" | "AGENT") — own/same-day edit gate. */
  viewerRole?: string;
  /** "Edited by Lalit" marker for the Raw History text (null if never edited). */
  rawEdit?: { by: string; at: string } | null;
  /** noteId → edit marker, for the per-note "Edited by Lalit" badge (admins only). */
  editedNotes?: Record<string, { by: string; at: string }>;
}

// ─── Outcome helpers ─────────────────────────────────────────────────────────

const CONNECTED_OUTCOMES = new Set(["CONNECTED", "INTERESTED", "NOT_INTERESTED"]);
const UNSUCCESSFUL_OUTCOMES = new Set(["NOT_PICKED", "BUSY", "SWITCHED_OFF", "WRONG_NUMBER", "CALLBACK"]);

function effectiveOutcome(outcome: string, notes: string | null | undefined): string {
  if (outcome === "CONNECTED" && notes && /dropped\s*wa/i.test(notes)) return "NOT_PICKED";
  return outcome;
}

function callOutcomeLabel(outcome: string, notes?: string | null): string {
  const eff = effectiveOutcome(outcome, notes);
  if (eff !== outcome) return "📵 Dropped WA";
  const map: Record<string, string> = {
    CONNECTED: "✅ Connected", NOT_PICKED: "📵 Not Picked",
    CALLBACK: "🔁 Callback", WRONG_NUMBER: "🚫 Wrong Number",
    BUSY: "⏳ Busy", SWITCHED_OFF: "📴 Switched Off",
    INTERESTED: "✅ Connected", NOT_INTERESTED: "🛑 Not Interested",
  };
  return map[eff] ?? eff.replaceAll("_", " ");
}

function callColour(outcome: CallLog["outcome"], notes?: string | null) {
  const eff = effectiveOutcome(outcome as string, notes);
  return CONNECTED_OUTCOMES.has(eff)
    ? { border: "border-emerald-300", bg: "bg-emerald-50/40", pill: "chip-won" }
    : { border: "border-red-200", bg: "bg-red-50/30", pill: "chip-cold" };
}

function waColour(direction: WhatsAppMessage["direction"]) {
  return direction === "INBOUND"
    ? { border: "border-blue-300", bg: "bg-blue-50/40", pill: "chip-warm" }
    : { border: "border-purple-300", bg: "bg-purple-50/40", pill: "src-wa" };
}

// ─── Remark event type → display ─────────────────────────────────────────────

const REMARK_BORDER: Record<RemarkEventType, string> = {
  CALL_CONNECTED:     "border-emerald-300",
  CALL_NOT_PICKED:    "border-red-200",
  CALL_BUSY:          "border-red-200",
  CALL_SWITCHED_OFF:  "border-red-200",
  CALL_CALLBACK:      "border-amber-300",
  CALL_NOT_INTERESTED:"border-gray-300",
  SITE_VISIT:         "border-green-400",
  MEETING:            "border-blue-400",
  VIRTUAL_MEETING:    "border-purple-400",
  NOTE:               "border-gray-200",
};

const REMARK_BG: Record<RemarkEventType, string> = {
  CALL_CONNECTED:     "bg-emerald-50/30",
  CALL_NOT_PICKED:    "bg-red-50/20",
  CALL_BUSY:          "bg-red-50/20",
  CALL_SWITCHED_OFF:  "bg-red-50/20",
  CALL_CALLBACK:      "bg-amber-50/30",
  CALL_NOT_INTERESTED:"bg-gray-50/20",
  SITE_VISIT:         "bg-green-50/40",
  MEETING:            "bg-blue-50/30",
  VIRTUAL_MEETING:    "bg-purple-50/30",
  NOTE:               "bg-gray-50/20",
};

function remarkIcon(t: RemarkEventType): string {
  if (t === "SITE_VISIT") return "🏢";
  if (t === "MEETING") return "🤝";
  if (t === "VIRTUAL_MEETING") return "💻";
  if (t === "CALL_CONNECTED") return "📞";
  if (isMissedCall(t)) return "📵";
  if (t === "CALL_CALLBACK") return "🔁";
  if (t === "CALL_NOT_INTERESTED") return "🛑";
  return "💬";
}

// ─── Date formatting ──────────────────────────────────────────────────────────

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", timeZone: "Asia/Kolkata",
  });
}

function hasTime(d: Date): boolean {
  // Dates created at noon IST (06:30 UTC) have no real time — they were date-only
  const utcH = d.getUTCHours(), utcM = d.getUTCMinutes();
  return !(utcH === 6 && utcM === 30) && !(utcH === 0 && utcM === 0);
}

function fmtDateTime(d: Date): string {
  if (!hasTime(d)) return fmtDate(d);
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}

// Remark event types that represent a REAL two-way conversation vs a failed
// call — drives the Connected / No-answer counters + filters so imported
// conversations (not just CRM call logs) are counted.
const CONNECTED_REMARK_TYPES = new Set<RemarkEventType>([
  "CALL_CONNECTED", "MEETING", "VIRTUAL_MEETING", "SITE_VISIT", "CALL_NOT_INTERESTED", "NOTE",
]);
const NOANSWER_REMARK_TYPES = new Set<RemarkEventType>([
  "CALL_NOT_PICKED", "CALL_BUSY", "CALL_SWITCHED_OFF", "CALL_CALLBACK",
]);

// Sort key for a display item (single entry or a missed-call group). A group is
// positioned by its most-recent attempt (`to`). Returns null only when the item
// has no date at all → it sinks below all dated conversations.
function displayKey(d: DisplayEntry): number | null {
  if (d.kind === "missed_group") return d.to ? d.to.getTime() : null;
  return d.entry.date ? d.entry.date.getTime() : null;
}

// ─── Main component ───────────────────────────────────────────────────────────

type FilterType = "ALL" | "CONNECTED" | "NO_ANSWER" | "WA";

export default function ConversationStreamCard({
  callLogs, waMessages, notes = [], forwardedTeam, rawRemarks, leadCreatedAt, agentNames = [],
  leadId = "", canControl = false, viewerId, viewerTeam, controls = [], agents = [],
  isAdmin = false, meId, viewerRole, rawEdit = null, editedNotes = {},
}: Props) {
  const [filter, setFilter] = useState<FilterType>("ALL");
  // View mode — "smart" = Smart Timeline (Processed View) is the DEFAULT (Lalit,
  // 2026-06-20) so agents see the tidy parsed conversation first. "raw" = Raw
  // History (Audit Log), the verbatim stored text. Smart NEVER mutates raw; if
  // they disagree, Raw wins (it is the stored audit trail), still one tap away.
  const [viewMode, setViewMode] = useState<"raw" | "smart">("smart");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // ── Bulk moderation (controllers / Lalit only) ──
  const router = useRouter();
  const [manageMode, setManageMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelect = (k: string) => setSelectedKeys(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  async function bulkAction(action: string) {
    if (selectedKeys.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/remark-control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remarkKeys: [...selectedKeys], action }),
      });
      if (r.ok) { setSelectedKeys(new Set()); setManageMode(false); router.refresh(); }
    } finally { setBulkBusy(false); }
  }

  // ── Inline note editing (✏️) ──
  // Notes are the only editable stream item (calls / WhatsApp / imported remarks
  // are records of events, not free-text the agent owns). The PATCH endpoint
  // enforces permission (ADMIN any · agent own same-day IST); we only surface the
  // affordance where it makes sense (isAdmin), and show its 403/error inline.
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  function startEditNote(id: string, body: string) {
    setEditNoteId(id); setEditDraft(body); setEditError(null);
  }
  function cancelEditNote() {
    setEditNoteId(null); setEditDraft(""); setEditError(null); setEditBusy(false);
  }
  async function saveEditNote(id: string) {
    const content = editDraft.trim();
    if (!content || editBusy) return;
    setEditBusy(true); setEditError(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (r.ok) { cancelEditNote(); router.refresh(); return; }
      const j = await r.json().catch(() => ({}));
      setEditError(j.error ?? "Couldn't save the edit.");
    } catch {
      setEditError("Network error — couldn't save the edit.");
    } finally {
      setEditBusy(false);
    }
  }

  // ── Raw History inline edit (Lalit-only) ──
  // Corrects the imported Raw History text (Lead.rawRemarks). The original is kept
  // verbatim in RemarkAuditLog; Smart Timeline re-derives from the corrected text;
  // the assigned agent sees the corrected version. PATCHes the Lalit-only endpoint.
  const [rawEditing, setRawEditing] = useState(false);
  const [rawDraft, setRawDraft] = useState("");
  const [rawBusy, setRawBusy] = useState(false);
  const [rawErr, setRawErr] = useState<string | null>(null);
  async function saveRawEdit() {
    if (rawBusy) return;
    setRawBusy(true); setRawErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/remark-control`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawDraft }),
      });
      if (r.ok) { setRawEditing(false); router.refresh(); return; }
      const j = await r.json().catch(() => ({}));
      setRawErr(j.error ?? "Couldn't save the correction.");
    } catch {
      setRawErr("Network error — couldn't save the correction.");
    } finally {
      setRawBusy(false);
    }
  }

  const audioTitle = forwardedTeam === "Dubai"
    ? "Recordings may exist only for India team (UAE consent rules)" : undefined;

  // ── Parse the raw remarks into structured entries ─────────────────────────
  const allRemarkEntries = useMemo(() =>
    rawRemarks
      ? parseRemarksTimeline(rawRemarks, agentNames, leadCreatedAt ?? undefined)
      : [],
    [rawRemarks, agentNames, leadCreatedAt]);

  // ── Conversation moderation overlay ───────────────────────────────────────
  // Map remarkKey → visibility. Controllers (Lalit) see EVERY entry (moderated
  // ones rendered greyed with a badge + ⋯ menu). Everyone else never sees an
  // entry that was deleted-from-view, hidden-from-all, or hidden-from-them.
  const controlByKey = useMemo(() => {
    const m = new Map<string, RemarkControlState>();
    for (const c of controls) m.set(c.remarkKey, { deletedFromView: c.deletedFromView, hiddenFromAll: c.hiddenFromAll, hiddenFromUserIds: c.hiddenFromUserIds, hiddenFromTeams: c.hiddenFromTeams });
    return m;
  }, [controls]);

  function hiddenForViewer(e: RemarkEntry): boolean {
    const c = controlByKey.get(remarkKeyFor(e));
    if (!c) return false;
    if (c.deletedFromView || c.hiddenFromAll) return true;
    if (viewerId && (c.hiddenFromUserIds ?? "").split(",").map(s => s.trim()).includes(viewerId)) return true;
    if (viewerTeam && (c.hiddenFromTeams ?? "").split(",").map(s => s.trim()).includes(viewerTeam)) return true;
    return false;
  }

  // Entries that drive the summaries + stream. Controllers keep the full set.
  const remarkEntries = useMemo(
    () => (canControl ? allRemarkEntries : allRemarkEntries.filter(e => !hiddenForViewer(e))),
    [allRemarkEntries, canControl, controlByKey, viewerId, viewerTeam], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Merge entries that share the same agent + exact timestamp — one MIS remark
  // block the parser split across several lines — into a single conversation block.
  const mergedEntries = useMemo(() => mergeSameMoment(remarkEntries), [remarkEntries]);

  // Imported remarks filtered to the active chip, then grouped (consecutive missed
  // calls collapsed). Connected / No-answer narrow by event type so the rows shown
  // always match the counter that was clicked.
  const filteredRemarkEntries = useMemo(() => {
    if (filter === "CONNECTED") return mergedEntries.filter(e => CONNECTED_REMARK_TYPES.has(e.eventType));
    if (filter === "NO_ANSWER") return mergedEntries.filter(e => NOANSWER_REMARK_TYPES.has(e.eventType));
    if (filter === "WA")        return [];
    return mergedEntries;
  }, [mergedEntries, filter]);

  // Newest conversation first (like an email inbox / WhatsApp "latest update on
  // top"). Sort by exact datetime descending. Same datetime — and same-date
  // remarks with no real time (they all carry noon IST) — tie, and the stable
  // sort keeps their original imported order. Truly date-less entries sink to the
  // bottom, rendered under an "Undated Imported Remarks" header.
  const displayRemarkEntries = useMemo(() => {
    const grouped = groupEntries(filteredRemarkEntries);
    return [...grouped].sort((a, b) => {
      const ka = displayKey(a), kb = displayKey(b);
      if (ka == null && kb == null) return 0;   // both undated → keep import order
      if (ka == null) return 1;                 // a undated → bottom
      if (kb == null) return -1;                // b undated → bottom
      return kb - ka;                           // newest first
    });
  }, [filteredRemarkEntries]);
  // Index where the trailing undated entries begin (for the section header).
  const datedRemarkCount = useMemo(
    () => displayRemarkEntries.filter(d => displayKey(d) != null).length,
    [displayRemarkEntries],
  );

  // ── Counts ────────────────────────────────────────────────────────────────
  // Connected = real two-way conversation across ALL sources (CRM calls + imported
  // remarks + inbound WhatsApp + notes) — not just CRM call logs (the old bug that
  // showed 0/0 on imported leads). No-answer = failed call attempts only. Each count
  // uses the same predicate as its filter, so the counter equals the rows shown.
  const callConnectedCount    = callLogs.filter(c => CONNECTED_OUTCOMES.has(effectiveOutcome(c.outcome as string, c.notes))).length;
  const callUnsuccessfulCount = callLogs.filter(c => UNSUCCESSFUL_OUTCOMES.has(effectiveOutcome(c.outcome as string, c.notes))).length;
  const remarkConnectedCount  = mergedEntries.filter(e => CONNECTED_REMARK_TYPES.has(e.eventType)).length;
  const remarkNoAnswerCount   = mergedEntries.filter(e => NOANSWER_REMARK_TYPES.has(e.eventType)).length;
  const waInboundCount        = waMessages.filter(m => m.direction === "INBOUND").length;
  const noteCount             = notes.length;

  const connectedCount    = callConnectedCount + remarkConnectedCount + waInboundCount + noteCount;
  const unsuccessfulCount = callUnsuccessfulCount + remarkNoAnswerCount;

  const totalEntries = callLogs.length + waMessages.length + notes.length + mergedEntries.length;

  // ─── Filter helpers ────────────────────────────────────────────────────────

  function showCallLog(c: CallLogWithUser): boolean {
    if (filter === "ALL") return true;
    const eff = effectiveOutcome(c.outcome as string, c.notes);
    if (filter === "CONNECTED") return CONNECTED_OUTCOMES.has(eff);
    if (filter === "NO_ANSWER") return UNSUCCESSFUL_OUTCOMES.has(eff);
    return false;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="card p-5 border-l-4 border-emerald-500 bg-emerald-50/20">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="font-semibold flex items-center gap-2 text-base flex-wrap">
          💬 Conversation History
          {/* View toggle — Raw History (Audit Log) is the DEFAULT. Smart Timeline is
              an optional processed view that never alters the raw audit trail. */}
          <span className="inline-flex rounded-md border border-emerald-300 overflow-hidden text-[10px] font-medium">
            <button type="button" onClick={() => setViewMode("raw")}
              title="Exact imported text — no grouping, no dedup, no rewriting. Source of truth."
              className={viewMode === "raw" ? "px-2 py-0.5 bg-[#0b1a33] text-white" : "px-2 py-0.5 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"}>
              📜 Raw History
            </button>
            <button type="button" onClick={() => setViewMode("smart")}
              title="Processed convenience view — grouped & tidied. Never modifies the raw audit trail."
              className={viewMode === "smart" ? "px-2 py-0.5 bg-[#0b1a33] text-white" : "px-2 py-0.5 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"}>
              ✨ Smart Timeline
            </button>
          </span>
          <span className="text-[10px] text-gray-500 font-normal">
            {viewMode === "raw" ? "— Raw History (Audit Log) · verbatim" : "— Smart Timeline (Processed View)"}
          </span>
        </div>
        {/* Filter chips — Smart Timeline only (they operate on parsed entries) */}
        {viewMode === "smart" && (
        <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
          <button type="button" onClick={() => setFilter(f => f === "CONNECTED" ? "ALL" : "CONNECTED")}
            className={`chip chip-won cursor-pointer transition-opacity ${filter !== "ALL" && filter !== "CONNECTED" ? "opacity-30" : ""}`}>
            📞 {connectedCount} connected
          </button>
          <button type="button" onClick={() => setFilter(f => f === "NO_ANSWER" ? "ALL" : "NO_ANSWER")}
            className={`chip chip-cold cursor-pointer transition-opacity ${filter !== "ALL" && filter !== "NO_ANSWER" ? "opacity-30" : ""}`}>
            📵 {unsuccessfulCount} no-answer
          </button>
          {waInboundCount > 0 && (
            <button type="button" onClick={() => setFilter(f => f === "WA" ? "ALL" : "WA")}
              className={`chip src-wa cursor-pointer transition-opacity ${filter !== "ALL" && filter !== "WA" ? "opacity-30" : ""}`}>
              💬 {waInboundCount} WA
            </button>
          )}
          {noteCount > 0 && (
            <span className="chip text-[9px] border border-amber-300 bg-amber-50 text-amber-700">
              📝 {noteCount} {noteCount === 1 ? "note" : "notes"}
            </span>
          )}
          {filter !== "ALL" && (
            <button type="button" onClick={() => setFilter("ALL")} className="text-[10px] text-gray-400 hover:text-gray-600 px-1">✕ clear</button>
          )}
          {canControl && (
            <button type="button" onClick={() => { setManageMode(v => !v); setSelectedKeys(new Set()); }}
              title="Select multiple remarks to hide / remove / restore at once"
              className={`chip text-[10px] cursor-pointer ${manageMode ? "bg-[#0b1a33] text-white border border-[#0b1a33]" : "border border-gray-300 text-gray-600 hover:border-gray-400"}`}>
              {manageMode ? "✓ Managing" : "🛡 Manage"}
            </button>
          )}
        </div>
        )}
      </div>

      {/* ── Bulk moderation bar (controllers only, in Manage mode) ── */}
      {canControl && manageMode && (
        <div className="flex items-center gap-2 flex-wrap mb-3 px-3 py-2 rounded-lg bg-[#0b1a33] text-white text-xs">
          <span className="font-semibold">{selectedKeys.size} selected</span>
          <span className="text-white/40">·</span>
          <button type="button" disabled={bulkBusy || selectedKeys.size === 0} onClick={() => bulkAction("DELETE")} className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 disabled:opacity-40">🙈 Remove from view</button>
          <button type="button" disabled={bulkBusy || selectedKeys.size === 0} onClick={() => bulkAction("HIDE_ALL")} className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 disabled:opacity-40">🔒 Hide from everyone</button>
          <button type="button" disabled={bulkBusy || selectedKeys.size === 0} onClick={() => bulkAction("RESTORE")} className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 disabled:opacity-40">↩ Restore</button>
          <button type="button" onClick={() => { setManageMode(false); setSelectedKeys(new Set()); }} className="ml-auto text-white/70 hover:text-white">Done</button>
        </div>
      )}

      {/* Site Visits & Meetings are intentionally NOT summarised here — they live in
          their own right-side "Meetings & Site Visits" card. Conversation History is
          the original chronological remarks only (no duplicated grouped blocks). */}

      {/* ── Main stream ── */}
      <div className="space-y-1.5 text-sm max-h-[620px] overflow-y-auto pr-1">
        {totalEntries === 0 && (
          <div className="text-gray-500 text-xs text-center py-4">
            No calls, WhatsApp messages, or notes logged yet.
          </div>
        )}

        {/* ─ RAW HISTORY (Audit Log) — the exact imported remark, verbatim. No
              parser, no grouping, no dedup, no rewriting. Line breaks, dates,
              times, agent names, emojis preserved exactly (whitespace-pre-wrap).
              Unlimited length; the container above scrolls. ─ */}
        {viewMode === "raw" && rawRemarks && rawRemarks.trim() && (
          <div className="border-l-2 border-slate-400 bg-slate-50/70 dark:bg-slate-800/40 pl-3 pr-2 py-2 rounded-r">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5 flex-wrap">
              📜 Imported Remarks — verbatim audit log
              {/* "Edited by Lalit" — Admin/Super-Admin only. Agents just see the clean text. */}
              {rawEdit && isAdmin && (
                <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 normal-case"
                  title={`Edited ${new Date(rawEdit.at).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST`}>
                  ✏️ Edited by {rawEdit.by}
                </span>
              )}
              {/* Edit affordance — any ADMIN (Lalit, Samir). Backend re-checks. */}
              {isAdmin && !rawEditing && (
                <button type="button" onClick={() => { setRawEditing(true); setRawDraft(rawRemarks); setRawErr(null); }}
                  title="Correct the imported Raw History text. The original is preserved in the audit log; the assigned agent will see the corrected version."
                  className="ml-auto normal-case text-[10px] text-gray-500 hover:text-gray-800 dark:hover:text-slate-200">✏️ Edit</button>
              )}
            </div>
            {rawEditing ? (
              <div>
                <textarea value={rawDraft} onChange={(e) => setRawDraft(e.target.value)} rows={10} disabled={rawBusy} autoFocus
                  className="w-full text-xs text-gray-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded p-2 bg-white dark:bg-slate-800 font-mono focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:opacity-60" />
                {rawErr && <div className="text-[10px] text-red-600 dark:text-red-400 mt-1">{rawErr}</div>}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <button type="button" onClick={saveRawEdit} disabled={rawBusy}
                    className="text-[10px] px-2 py-1 rounded bg-[#0b1a33] text-white hover:bg-[#0b1a33]/90 disabled:opacity-40">{rawBusy ? "Saving…" : "Save correction"}</button>
                  <button type="button" onClick={() => { setRawEditing(false); setRawErr(null); }} disabled={rawBusy}
                    className="text-[10px] px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-gray-400 disabled:opacity-40">Cancel</button>
                  <span className="text-[9px] text-gray-400">Original kept in the audit log · the assigned agent sees the corrected text once saved</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed font-mono">{rawRemarks}</div>
            )}
          </div>
        )}

        {/* ─ Imported remarks — SMART TIMELINE (parsed, grouped, filtered) ─ */}
        {viewMode === "smart" && filter !== "WA" && displayRemarkEntries.map((item, idx) => {
          // Stable, CONTENT-based key so expansion state + React reconciliation track
          // the real entry across filter changes (an array index would attach state
          // to a position and expand the wrong row after filtering).
          const key = item.kind === "missed_group"
            ? `missed-${item.label}-${item.from?.getTime() ?? "x"}-${item.to?.getTime() ?? "x"}-${item.agentName ?? ""}`
            : `entry-${remarkKeyFor(item.entry)}`;
          // "Undated Imported Remarks" divider — rendered before the FIRST undated
          // item regardless of its kind (single entry OR missed-call group).
          const undatedHeader = (idx === datedRemarkCount && datedRemarkCount < displayRemarkEntries.length) ? (
            <div className="mt-2 mb-1 pt-2 border-t border-dashed border-gray-300 dark:border-slate-600 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
              Undated Imported Remarks
            </div>
          ) : null;

          if (item.kind === "missed_group") {
            const expanded = expandedGroups.has(key);
            return (
              <Fragment key={key}>
                {undatedHeader}
              <div className="border-l-2 border-red-200 bg-red-50/20 pl-3 pr-2 py-1.5 rounded-r">
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>
                    📵 <span className="font-medium">{item.label}</span>
                    {" · "}
                    <span className="font-semibold text-red-600">{item.count} times</span>
                    {" · "}
                    {fmtDateShort(item.from)} – {fmtDateShort(item.to)}
                    {item.agentName && <span className="ml-1 text-gray-400">· {item.agentName}</span>}
                  </span>
                  <button type="button" onClick={() => setExpandedGroups(s => {
                    const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n;
                  })} className="text-[10px] text-gray-400 hover:text-gray-600 ml-2">
                    {expanded ? "▲" : "▼"}
                  </button>
                </div>
                {/* Last attempt */}
                <div className="text-[10px] text-gray-400 mt-0.5">Last attempt: {fmtDate(item.to)}</div>
              </div>
              </Fragment>
            );
          }

          // Single remark entry
          const e: RemarkEntry = item.entry;
          const border = REMARK_BORDER[e.eventType];
          const bg     = REMARK_BG[e.eventType];
          const icon   = remarkIcon(e.eventType);
          // Header date — "12 Apr 2025 | 11:23 AM IST" when there's a real clock
          // time; date-only entries stay bare ("17 Jun 2026", no "… IST").
          const dateStr = e.date
            ? (hasTime(e.date)
                ? `${fmtDateTime(e.date).replace(/,\s*/, " | ").replace(/\b([ap]m)\b/i, (s) => s.toUpperCase())} IST`
                : fmtDateTime(e.date))
            : null;
          // Moderation state — only controllers ever reach here with a hidden entry.
          const rKey = remarkKeyFor(e);
          const ctrl = controlByKey.get(rKey) ?? null;
          const hiddenCount = (ctrl?.hiddenFromUserIds ?? "").split(",").map(s => s.trim()).filter(Boolean).length;
          const teamCount = (ctrl?.hiddenFromTeams ?? "").split(",").map(s => s.trim()).filter(Boolean).length;
          const moderated = !!ctrl && (ctrl.deletedFromView || ctrl.hiddenFromAll || hiddenCount > 0 || teamCount > 0);
          const modBadge = ctrl?.deletedFromView ? "removed" : ctrl?.hiddenFromAll ? "hidden · all" : teamCount > 0 ? `hidden · ${teamCount} team${teamCount > 1 ? "s" : ""}` : hiddenCount > 0 ? `hidden · ${hiddenCount} agent${hiddenCount > 1 ? "s" : ""}` : null;

          return (
            <Fragment key={key}>
              {undatedHeader}
            <div className={`border-l-2 ${border} ${bg} pl-3 pr-2 py-1.5 rounded-r ${moderated ? "opacity-60" : ""} ${canControl && manageMode && selectedKeys.has(rKey) ? "ring-2 ring-[#0b1a33]/40" : ""}`}>
              {/* Header — DATE/TIME on top, AGENT NAME on the second line, body
                  below (Lalit's Smart-Timeline spec). Controls float on the right. */}
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0 flex items-start gap-1.5">
                  {canControl && manageMode && (
                    <input type="checkbox" className="h-3.5 w-3.5 mt-0.5 flex-none accent-[#0b1a33]" checked={selectedKeys.has(rKey)} onChange={() => toggleSelect(rKey)} />
                  )}
                  <div className="min-w-0">
                    {dateStr
                      ? <div className={`text-[11px] font-semibold tracking-wide text-gray-500 dark:text-slate-400 ${e.dateInferred ? "italic opacity-70" : ""}`}>{dateStr}</div>
                      : <div className="text-[11px] italic text-gray-400 opacity-60">Undated</div>}
                    {e.agentName && (
                      <div className="text-xs font-semibold text-gray-700 dark:text-slate-200">{e.agentName}</div>
                    )}
                  </div>
                </div>
                <span className="flex-none inline-flex items-center gap-1 pt-0.5">
                  {canControl && modBadge && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{modBadge}</span>
                  )}
                  <span className="text-[10px]">{icon}</span>
                  {/* Per-entry edit (Lalit only) — routes to the Raw History editor so
                      the correction lands on the single source; Raw History + Smart
                      Timeline stay consistent and the entry's original date is kept. */}
                  {canControl && !manageMode && (
                    <button type="button"
                      onClick={() => { setViewMode("raw"); setRawEditing(true); setRawDraft(rawRemarks ?? ""); setRawErr(null); }}
                      title="Edit this entry in Raw History — keeps Raw History + Smart Timeline in sync; the original date/time is preserved"
                      className="text-[10px] text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">✏️ Edit</button>
                  )}
                  {canControl && !manageMode && (
                    <RemarkControlMenu leadId={leadId} remarkKey={rKey} control={ctrl} agents={agents} />
                  )}
                </span>
              </div>
              {/* Body — the remark text, preserved verbatim; only bracket/artifact
                  noise was stripped by the parser. One remark = one card. */}
              <div className="text-xs text-gray-700 dark:text-slate-200 break-words leading-relaxed whitespace-pre-line">
                {toReadableParagraph(e.text)}
              </div>
            </div>
            </Fragment>
          );
        })}

        {/* ─ Real CRM call logs ─ */}
        {callLogs.filter(showCallLog).map((c, idx) => {
          const col = callColour(c.outcome, c.notes);
          const displayName = canonicalAgentName(c.attributedAgentName ?? c.user.name, agentNames);
          const notesClean = c.notes
            ? c.notes.replace(/^[A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2}\s*:\s*/, "")
            : null;
          return (
            <div key={`c-${c.id}`} className={`border-l-2 ${col.border} ${col.bg} pl-3 pr-2 py-1.5 rounded-r`}>
              <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                <span>
                  📞 <b>{displayName}</b> · {fmtIST12Paren(c.startedAt)} IST
                  {c.durationSec ? ` · ${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : ""}
                </span>
                <span className={`chip ${col.pill} text-[9px]`}>{callOutcomeLabel(c.outcome, c.notes)}</span>
              </div>
              {notesClean && <div className="text-xs mt-1 text-gray-700 whitespace-pre-wrap">{notesClean}</div>}
              {c.recordingUrl && (
                <audio controls preload="none" src={c.recordingUrl} title={audioTitle} className="mt-1 h-7 max-w-full" />
              )}
            </div>
          );
        })}

        {/* ─ WhatsApp messages (inbound replies are a real two-way conversation, so
              they also appear under the Connected filter) ─ */}
        {filter !== "NO_ANSWER" && waMessages
          .filter(m => filter === "CONNECTED" ? m.direction === "INBOUND" : true)
          .map((m, idx) => {
          const col = waColour(m.direction);
          return (
            <div key={`w-${m.id}`} className={`border-l-2 ${col.border} ${col.bg} pl-3 pr-2 py-1.5 rounded-r`}>
              <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                <span>💬 <b>{m.direction === "INBOUND" ? "📥 Client" : "📤 Agent"}</b> · {fmtIST12Paren(m.receivedAt)} IST</span>
                <span className={`chip ${col.pill} text-[9px]`}>{m.direction === "INBOUND" ? "📥 Inbound" : "📤 Outbound"}</span>
              </div>
              <div className="text-xs mt-1 text-gray-800 whitespace-pre-wrap">{m.body}</div>
            </div>
          );
        })}

        {/* ─ Notes (voice + typed) — real conversation records, shown under Connected too.
              Notes are the only editable stream item: an admin (and, via the API, the
              author on the same IST day) can ✏️ edit the remark text inline. ─ */}
        {(filter === "ALL" || filter === "CONNECTED") && notes.map((n, idx) => {
          const editing = editNoteId === n.id;
          const noteEdit = editedNotes[n.id];
          return (
          <div key={`n-${n.id}`} className="border-l-2 border-amber-300 bg-amber-50/40 pl-3 pr-2 py-1.5 rounded-r">
            <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
              <span>📝 <b>{n.user?.name ?? "Agent"}</b> · {fmtIST12Paren(n.createdAt)} IST</span>
              <span className="inline-flex items-center gap-1.5">
                {noteEdit && isAdmin && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                    title={`Edited ${new Date(noteEdit.at).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST`}>✏️ Edited by {noteEdit.by}</span>
                )}
                {/* Edit: admins/managers any time; an AGENT only their OWN note on
                    the same IST day they wrote it. Backend re-checks the same rule. */}
                {canEditRemark({ id: meId ?? "", role: viewerRole ?? (isAdmin ? "ADMIN" : "AGENT") }, { createdById: n.userId ?? null, createdAt: n.createdAt }) && !editing && (
                  <button type="button" onClick={() => startEditNote(n.id, n.body)}
                    title="Edit this remark"
                    className="text-[10px] text-gray-400 hover:text-gray-600">✏️ Edit</button>
                )}
                <span className="chip text-[9px] border border-amber-300 bg-amber-100 text-amber-700">Note</span>
              </span>
            </div>
            {editing ? (
              <div className="mt-1">
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={3}
                  disabled={editBusy}
                  autoFocus
                  className="w-full text-xs text-gray-800 dark:text-slate-100 border border-amber-300 dark:border-amber-700 rounded p-2 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-60"
                />
                {editError && (
                  <div className="text-[10px] text-red-600 dark:text-red-400 mt-1">{editError}</div>
                )}
                <div className="flex items-center gap-2 mt-1.5">
                  <button type="button" onClick={() => saveEditNote(n.id)} disabled={editBusy || !editDraft.trim()}
                    className="text-[10px] px-2 py-1 rounded bg-[#0b1a33] text-white hover:bg-[#0b1a33]/90 disabled:opacity-40">
                    {editBusy ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={cancelEditNote} disabled={editBusy}
                    className="text-[10px] px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-gray-400 disabled:opacity-40">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs mt-1 text-gray-800 whitespace-pre-wrap">{n.body}</div>
            )}
          </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 pt-2 border-t border-emerald-200 flex items-center gap-3 flex-wrap text-[10px] text-gray-600">
        <span><span className="inline-block w-2 h-2 bg-emerald-400 rounded-full mr-1 align-middle" />Connected</span>
        <span><span className="inline-block w-2 h-2 bg-red-400 rounded-full mr-1 align-middle" />Missed</span>
        <span><span className="inline-block w-2 h-2 bg-blue-400 rounded-full mr-1 align-middle" />📥 Client WA</span>
        <span><span className="inline-block w-2 h-2 bg-purple-400 rounded-full mr-1 align-middle" />📤 Agent WA</span>
        <span><span className="inline-block w-2 h-2 bg-amber-400 rounded-full mr-1 align-middle" />📝 Note</span>
        <span><span className="inline-block w-2 h-2 bg-green-400 rounded-full mr-1 align-middle" />🏢 Site Visit</span>
        <span><span className="inline-block w-2 h-2 bg-blue-500 rounded-full mr-1 align-middle" />🤝 Meeting</span>
      </div>
    </div>
  );
}
