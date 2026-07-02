"use client";

// Unified conversation timeline — calls · WhatsApp · notes · imported remarks.
// Redesigned 2026-06 per Lalit's spec:
//   • No technical labels ("Historical Note", "Imported From Excel", etc.)
//   • Agent ownership shown where known (Yasir • 15 Jan 2025)
//   • Consecutive missed calls grouped ("Call not picked 8 times, 05 Jan–12 Jan")
//   • Site Visit / Meeting / Virtual Meeting summaries surfaced separately
//   • All entries visible; nothing discarded

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { fmtIST12Paren, fmtISTDate, toISTLocalInput } from "@/lib/datetime";
import { canonicalAgentName } from "@/lib/agentName";
import { canEditRemark, canEditActivity } from "@/lib/remarkPerms";
import CallRecordingPlayer from "@/components/CallRecordingPlayer";
import type { CallLog, WhatsAppMessage } from "@prisma/client";
import {
  parseRemarksTimeline,
  mergeSameMoment,
  remarkKeyFor,
  isNoonSentinel,
  type RemarkEntry,
  type RemarkEventType,
} from "@/lib/remarkParser";
import { type RemarkControlState } from "@/components/RemarkControlMenu";
import TimelineEntryEditModal from "@/components/TimelineEntryEditModal";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NoteWithUser {
  id: string;
  body: string;
  createdAt: Date;
  userId?: string | null;
  user: { name: string } | null;
}

// `user` is nullable: an unmatched inbound telephony call is left UNASSIGNED
// (userId null) and shown via `attributedAgentName` ("Unknown Agent") instead.
type CallLogWithUser = CallLog & { user: { name: string } | null };
// An outbound WhatsApp carries its sender in `actor` (nullable: inbound + all
// automation-sent messages have no human actor).
type WAMessageWithActor = WhatsAppMessage & { actor?: { name: string } | null };

// A CRM-logged Activity event (meeting/visit/status-change/reopen/…) shown in the
// conversation stream so EVERY agent action appears in Conversation History.
type ActivityStreamRow = {
  id: string; type: string; title?: string | null; description?: string | null;
  scheduledAt?: Date | null; completedAt?: Date | null; createdAt: Date;
  status?: string | null; outcome?: string | null; followupDate?: Date | null;
  actionContext?: string | null;
  /** Author of the activity — drives the agent own-entry edit gate. */
  userId?: string | null;
  user?: { name: string } | null;
};
// Activity types rendered in the stream. CALL / WHATSAPP / NOTE are EXCLUDED — they
// already render via their own CallLog / WhatsAppMessage / Note rows (no double-up).
//
// Smart Timeline = CLIENT COMMUNICATION ONLY (Lalit 2026-06). System / audit events
// are NOT conversation and are deliberately excluded here — STATUS_CHANGE,
// LEAD_CREATED, COLD_TO_LEAD (revived) and REMINDER_FIRED all live in the admin
// "Change History" card (field-level audit via LeadFieldHistory: status, owner /
// assignment, follow-up, every inline edit, plus the import batch — nothing is
// lost). Only genuine client touchpoints render in the conversation: meetings /
// visits, project discussed, brochure sent, email.
const ACTIVITY_STREAM_TYPES = new Set([
  "SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING", "HOME_VISIT", "EXPO_MEETING",
  "MEETING", "BROCHURE_SENT", "PROJECT_DISCUSSED", "EMAIL",
]);
// Narrow carve-out: a FEW Activity rows are typed NOTE but are NOT free-text notes
// (those mirror a Note-model row and would double-up). These are system audit
// events the server logs as NOTE — a FOLLOW-UP-DATE change ("followup-change:*")
// or an admin INLINE FIELD EDIT ("Inline edit: N field(s)"). Surfacing exactly
// these — and nothing else NOTE-typed — adds "follow-up changes" + "admin edits"
// to Smart Timeline without re-introducing the note double-count.
function isSurfacedNoteActivity(a: ActivityStreamRow): boolean {
  if (a.type !== "NOTE") return false;
  const ctx = a.actionContext ?? "";
  if (ctx.startsWith("followup-change")) return true;
  if ((a.title ?? "").startsWith("Inline edit:")) return true;
  return false;
}
const ACTIVITY_ICON: Record<string, string> = {
  SITE_VISIT: "🚗", OFFICE_MEETING: "🏢", VIRTUAL_MEETING: "💻", HOME_VISIT: "🏠",
  EXPO_MEETING: "🎪", MEETING: "📅", STATUS_CHANGE: "🔄", LEAD_CREATED: "✨",
  COLD_TO_LEAD: "🔥", BROCHURE_SENT: "📄", PROJECT_DISCUSSED: "🏗", REMINDER_FIRED: "🔔", EMAIL: "✉️",
};
const ACTIVITY_LABEL: Record<string, string> = {
  SITE_VISIT: "Site Visit", OFFICE_MEETING: "Office Meeting", VIRTUAL_MEETING: "Virtual Meeting",
  HOME_VISIT: "Home Visit", EXPO_MEETING: "Expo", MEETING: "Meeting", STATUS_CHANGE: "Status",
  LEAD_CREATED: "Lead Created", COLD_TO_LEAD: "Revived", BROCHURE_SENT: "Brochure",
  PROJECT_DISCUSSED: "Project", REMINDER_FIRED: "Reminder", EMAIL: "Email",
};

interface Props {
  callLogs: CallLogWithUser[];
  waMessages: WAMessageWithActor[];
  notes?: NoteWithUser[];
  /** CRM-logged activity events — rendered in BOTH views so every action shows. */
  activities?: ActivityStreamRow[];
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
  /** callId → edit marker, for the per-call "Edited by …" badge. */
  editedCalls?: Record<string, { by: string; at: string }>;
  /** The lead OWNER's display name — the truthful fallback actor for stream rows
   *  whose own author is unknown (a Note/Activity with no recorded user, or an
   *  outbound WhatsApp which has no actor column). NEVER show the literal "Agent":
   *  resolve user → System (system-cron rows) → this owner → "Unknown User". */
  leadOwnerName?: string | null;
  /** Which surface renders this card — makes the component CONTEXT-AWARE instead
   *  of hardcoding per-page conditions. Only the active Lead view ("lead") shows
   *  the inline edit / raw-correction affordances; the data-bank / staging
   *  surfaces (cold · revival · archived) render the SAME timeline READ-ONLY,
   *  matching the Buyer Data view (BuyerActivityTimeline). Defaults to "lead" so
   *  the Lead view is byte-identical to before — purely additive, no Lead change.
   *  Future surfaces (Revival, Archived) can pass their own value to diverge
   *  layout without duplicating the component. */
  context?: "lead" | "cold" | "revival" | "archived";
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

// ─── Remark event-type count sets ────────────────────────────────────────────
// Parsed imported-remark entries are BOTH rendered as Smart Timeline cards (one
// clean dated card per remark) AND classified here for the cross-source
// connected / no-answer COUNT chips in the header — so an imported-only lead
// shows accurate conversation counters AND its historical comments inline.
const CONNECTED_REMARK_TYPES = new Set<RemarkEventType>([
  "CALL_CONNECTED", "MEETING", "VIRTUAL_MEETING", "SITE_VISIT", "CALL_NOT_INTERESTED", "NOTE",
]);
const NOANSWER_REMARK_TYPES = new Set<RemarkEventType>([
  "CALL_NOT_PICKED", "CALL_BUSY", "CALL_SWITCHED_OFF", "CALL_CALLBACK",
]);
// CRM-logged activities that are genuine two-way client contact ("connected").
// One-way touches (brochure sent, email, project note) are not conversations, so
// they show only under ALL — this keeps the CONNECTED chip count == the rows it
// filters (the header count and the stream filter share this exact set).
const CONNECTED_ACTIVITY_TYPES = new Set<string>([
  "SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING", "HOME_VISIT", "EXPO_MEETING", "MEETING",
]);

// Per-imported-remark icon by classified event type — small visual cue mirroring
// the call/activity rows. Falls back to the imported-note glyph.
const REMARK_ICON: Record<RemarkEventType, string> = {
  CALL_CONNECTED: "📞", CALL_NOT_PICKED: "📵", CALL_BUSY: "⏳", CALL_SWITCHED_OFF: "📴",
  CALL_CALLBACK: "🔁", CALL_NOT_INTERESTED: "🛑", SITE_VISIT: "🚗", MEETING: "🏢",
  VIRTUAL_MEETING: "💻", NOTE: "🗒",
};
// Imported-remark left-border + background tint by event class. Connected /
// meeting tones lean emerald; no-answer tones lean red; plain notes stay slate —
// consistent with the call/WhatsApp colour language, just muted for "imported".
function remarkColour(t: RemarkEventType): { border: string; bg: string } {
  if (CONNECTED_REMARK_TYPES.has(t) && t !== "NOTE")
    return { border: "border-emerald-300", bg: "bg-emerald-50/30" };
  if (NOANSWER_REMARK_TYPES.has(t))
    return { border: "border-red-200", bg: "bg-red-50/20" };
  return { border: "border-slate-300", bg: "bg-slate-50/60" };
}

// ─── Main component ───────────────────────────────────────────────────────────

type FilterType = "ALL" | "CONNECTED" | "NO_ANSWER" | "WA";

export default function ConversationStreamCard({
  callLogs, waMessages, notes = [], activities = [], forwardedTeam, rawRemarks, leadCreatedAt, agentNames = [],
  leadId = "", canControl = false, viewerId, viewerTeam, controls = [],
  isAdmin = false, meId, viewerRole, rawEdit = null, editedNotes = {}, editedCalls = {}, leadOwnerName = null,
}: Props) {
  // Actor attribution rule (Lalit, 2026-07-01): the timeline shows WHO PERFORMED
  // the action, never who OWNS the lead. When a row has no stored actor (userId
  // null) we must NOT fall back to the owner — that fabricates false authorship.
  // A null actor means either a system/automation event or an actor we can't
  // recover; either way the truthful label is "System", never the owner.
  // (Human-driven rows always store their actor, so they never reach this.)
  const SYSTEM_ACTOR = "System";
  const fallbackActor = SYSTEM_ACTOR;
  // `leadOwnerName` is intentionally no longer used for authorship — retained only
  // for the outbound-WhatsApp legacy rows that predate the actor column (see below).
  void leadOwnerName;
  const [filter, setFilter] = useState<FilterType>("ALL");
  // View mode — "smart" = Smart Timeline (Processed View) is the DEFAULT (Lalit,
  // 2026-06-20) so agents see the tidy parsed conversation first. "raw" = Raw
  // History (Audit Log), the verbatim stored text. Smart NEVER mutates raw; if
  // they disagree, Raw wins (it is the stored audit trail), still one tap away.
  const [viewMode, setViewMode] = useState<"raw" | "smart">("smart");
  // ── Per-entry Smart Timeline edit (admin/super-admin only) ──
  // Holds the Activity row currently open in the edit modal, or null. Gated by
  // `isAdmin` at the call site; the PATCH endpoint re-checks server-side (403).
  const [editActivity, setEditActivity] = useState<ActivityStreamRow | null>(null);

  const router = useRouter();
  // NOTE: the old per-remark bulk-moderation UI (Manage / hide / remove) acted on
  // imported-remark CARDS that no longer render in Smart Timeline. The visibility
  // OVERLAY is still applied to the count chips (controlByKey / hiddenForViewer
  // below), so a hidden remark still drops out of the connected/no-answer totals —
  // but there is no longer a per-card selection UI to drive bulk actions here.

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

  // ── Inline CALL-REMARK editing (✏️) ──
  // The note typed when a call is logged (CallLog.notes) is the agent's OWN free-text
  // remark and the MOST COMMON conversation entry — so it's editable too, with the
  // identical rule (ADMIN/MANAGER any · agent own + same IST day, enforced server-side
  // by canEditRemark). Only the remark TEXT changes; the call's outcome/time/recording
  // stay immutable. The original is preserved in RemarkAuditLog (action EDIT_CALL).
  const [editCallId, setEditCallId] = useState<string | null>(null);
  const [callDraft, setCallDraft] = useState("");
  const [callBusy, setCallBusy] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  function startEditCall(id: string, body: string) { setEditCallId(id); setCallDraft(body); setCallError(null); }
  function cancelEditCall() { setEditCallId(null); setCallDraft(""); setCallError(null); setCallBusy(false); }
  async function saveEditCall(id: string) {
    if (callBusy) return;
    setCallBusy(true); setCallError(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/calls/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: callDraft.trim() }),
      });
      if (r.ok) { cancelEditCall(); router.refresh(); return; }
      const j = await r.json().catch(() => ({}));
      setCallError(j.error ?? "Couldn't save the edit.");
    } catch {
      setCallError("Network error — couldn't save the edit.");
    } finally {
      setCallBusy(false);
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

  // ── Parse the raw remarks into structured entries ──────────────────────────
  // Derived from the IMMUTABLE imported text (rawRemarks). Used for BOTH the
  // header count chips AND — now — the Smart Timeline cards (one clean dated card
  // per remark). The Raw History tab still shows the untouched verbatim blob.
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
  // `mergedEntries` powers BOTH the cross-source connected / no-answer COUNT chips
  // in the header AND the Smart Timeline imported-remark cards (one clean dated
  // card per remark), so an imported-only lead shows accurate counters AND its
  // historical comments inline. It already respects the moderation overlay (it
  // derives from `remarkEntries`, which drops viewer-hidden entries).
  const mergedEntries = useMemo(() => mergeSameMoment(remarkEntries), [remarkEntries]);

  // ── Counts ────────────────────────────────────────────────────────────────
  // Connected = real two-way conversation across ALL sources (CRM calls + imported
  // remarks + inbound WhatsApp + notes) — not just CRM call logs (the old bug that
  // showed 0/0 on imported leads). No-answer = failed call attempts only. Each count
  // uses the same predicate as its filter, so the counter equals the rows shown.
  // Client-communication activities only. Surfaced system NOTE rows (follow-up
  // changes, admin inline edits) are audit events → they appear in the Change
  // History card (field-level audit), NOT in the conversation stream.
  const streamActs = activities.filter((a) => ACTIVITY_STREAM_TYPES.has(a.type));

  const callConnectedCount    = callLogs.filter(c => CONNECTED_OUTCOMES.has(effectiveOutcome(c.outcome as string, c.notes))).length;
  const callUnsuccessfulCount = callLogs.filter(c => UNSUCCESSFUL_OUTCOMES.has(effectiveOutcome(c.outcome as string, c.notes))).length;
  const remarkConnectedCount  = mergedEntries.filter(e => CONNECTED_REMARK_TYPES.has(e.eventType)).length;
  const remarkNoAnswerCount   = mergedEntries.filter(e => NOANSWER_REMARK_TYPES.has(e.eventType)).length;
  const waInboundCount        = waMessages.filter(m => m.direction === "INBOUND").length;
  const noteCount             = notes.length;
  // Meetings / site-visits logged as CRM activities are real two-way contact — count
  // them as connected too, using the SAME set the CONNECTED filter uses (below) so
  // the chip number always equals the rows it shows.
  const activityConnectedCount = streamActs.filter(a => CONNECTED_ACTIVITY_TYPES.has(a.type)).length;

  const connectedCount    = callConnectedCount + remarkConnectedCount + waInboundCount + noteCount + activityConnectedCount;
  const unsuccessfulCount = callUnsuccessfulCount + remarkNoAnswerCount;
  // Total rows shown in Smart Timeline = genuine CRM events (calls + WhatsApp +
  // notes + CRM activities) PLUS every parsed imported remark (mergedEntries).
  // Imported remarks now render as their own clean dated cards in the stream
  // (date → author → full body), so an imported-only lead shows its historical
  // comments inline instead of a bare "view Raw History" hint. The verbatim blob
  // is still available, unchanged, in the Raw History tab.
  const totalEntries =
    callLogs.length + waMessages.length + notes.length + streamActs.length + mergedEntries.length;

  // ─── Filter helpers ────────────────────────────────────────────────────────

  function showCallLog(c: CallLogWithUser): boolean {
    if (filter === "ALL") return true;
    const eff = effectiveOutcome(c.outcome as string, c.notes);
    if (filter === "CONNECTED") return CONNECTED_OUTCOMES.has(eff);
    if (filter === "NO_ANSWER") return UNSUCCESSFUL_OUTCOMES.has(eff);
    return false;
  }

  // ── Unified Smart Timeline stream (newest-first across ALL event types) ──────
  // Smart Timeline interleaves every event type into one newest-first stream:
  // call logs, WhatsApp, notes, CRM-logged activities (meetings / visits / status
  // changes / reject / convert / brochure / email / AI + manual entries) AND every
  // parsed imported remark (one clean dated card per remark). It still never dumps
  // the raw imported BLOB as one messy entry — each remark is a parsed clean card;
  // the verbatim blob remains in the Raw History tab only.
  //
  // Every event is normalised to a single shape with an effective IST timestamp
  // (completedAt ?? scheduledAt ?? createdAt for activities; the source timestamp
  // otherwise) and the whole list is sorted DESCENDING — latest at the top, oldest
  // at the bottom — across every type. A plain numeric sort (not a stable merge of
  // pre-sorted buckets) guarantees the order is correct regardless of source.
  type StreamKind = "call" | "wa" | "note" | "activity" | "remark";
  type StreamItem = { kind: StreamKind; at: number; id: string;
    call?: CallLogWithUser; wa?: WAMessageWithActor; note?: NoteWithUser; act?: ActivityStreamRow;
    remark?: RemarkEntry; remarkUndated?: boolean };

  const unifiedStream = useMemo<StreamItem[]>(() => {
    const items: StreamItem[] = [];
    for (const c of callLogs) items.push({ kind: "call", at: c.startedAt.getTime(), id: `c-${c.id}`, call: c });
    for (const m of waMessages) items.push({ kind: "wa", at: m.receivedAt.getTime(), id: `w-${m.id}`, wa: m });
    for (const n of notes) items.push({ kind: "note", at: n.createdAt.getTime(), id: `n-${n.id}`, note: n });
    for (const a of streamActs) {
      const eff = a.completedAt ?? a.scheduledAt ?? a.createdAt;
      items.push({ kind: "activity", at: eff.getTime(), id: `a-${a.id}`, act: a });
    }
    // ── PARSED IMPORTED REMARKS — one clean card per remark ──
    // Every parsed entry from the imported rawRemarks blob is merged into the SAME
    // newest-first stream as a clean dated card (date → author → FULL body, no
    // length cap). An entry with no parseable date is NOT dropped — it sinks to a
    // stable epoch-0 position so it always renders (as an undated "Imported note").
    // The remarkKey (date+text hash) gives a stable React key across renders.
    for (const e of mergedEntries) {
      items.push({
        kind: "remark",
        at: e.date ? e.date.getTime() : 0,
        id: `r-${remarkKeyFor(e)}`,
        remark: e,
        remarkUndated: !e.date,
      });
    }
    // Newest first. Equal timestamps keep a deterministic id tiebreak.
    return items.sort((x, y) => (y.at - x.at) || (x.id < y.id ? 1 : -1));
  }, [callLogs, waMessages, notes, streamActs, mergedEntries]);

  // Apply the active filter chip to the unified stream.
  function showStreamItem(it: StreamItem): boolean {
    if (it.kind === "call") {
      if (filter === "WA") return false;
      return showCallLog(it.call!);
    }
    if (it.kind === "wa") {
      if (filter === "NO_ANSWER") return false;
      if (filter === "CONNECTED") return it.wa!.direction === "INBOUND";
      return true; // ALL or WA
    }
    if (it.kind === "note") return filter === "ALL" || filter === "CONNECTED";
    if (it.kind === "remark") {
      // Classify an imported remark by its parsed event type so the connected /
      // no-answer chips filter it the same way they filter a real call.
      const t = it.remark!.eventType;
      if (filter === "ALL") return true;
      if (filter === "CONNECTED") return CONNECTED_REMARK_TYPES.has(t);
      if (filter === "NO_ANSWER") return NOANSWER_REMARK_TYPES.has(t);
      return false; // WA filter → imported remarks excluded
    }
    // activity — meetings/visits are two-way contact → CONNECTED; every activity
    // shows under ALL. Mirrors CONNECTED_ACTIVITY_TYPES so the count == the rows.
    if (filter === "CONNECTED") return CONNECTED_ACTIVITY_TYPES.has(it.act!.type);
    return filter === "ALL";
  }
  const filteredStream = unifiedStream.filter(showStreamItem);

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
        </div>
        )}
      </div>

      {/* Site Visits & Meetings are intentionally NOT summarised here — they live in
          their own right-side "Meetings & Site Visits" card. Conversation History is
          the original chronological remarks only (no duplicated grouped blocks). */}

      {/* ── Main stream ── */}
      <div className="space-y-1.5 text-sm max-h-[620px] overflow-y-auto pr-1">
        {/* Empty-state. Parsed imported remarks now render as their own cards in
            Smart Timeline, so totalEntries already includes them — this hint can
            ONLY fire when rawRemarks exists but parsed to ZERO entries (a genuinely
            unparseable blob, very rare). In that one edge case we still point the
            user to the verbatim Raw History so nothing is hidden. Otherwise → the
            plain "nothing logged" empty state (or, in Raw mode, the blob renders
            below). */}
        {totalEntries === 0 && (
          viewMode === "smart" && rawRemarks && rawRemarks.trim() ? (
            <div className="text-center py-5 px-3">
              <div className="text-gray-500 dark:text-slate-400 text-xs">No timeline entries could be parsed.</div>
              <div className="text-gray-600 dark:text-slate-300 text-xs mt-1">
                📋 The full imported history is available, verbatim, in the Raw History tab.
              </div>
              <button type="button" onClick={() => setViewMode("raw")}
                className="mt-2 text-[11px] px-2.5 py-1 rounded-md bg-[#0b1a33] text-white hover:bg-[#0b1a33]/90">
                📜 View Raw History
              </button>
            </div>
          ) : !(viewMode === "raw" && rawRemarks && rawRemarks.trim()) && (
            <div className="text-gray-500 text-xs text-center py-4">
              No calls, WhatsApp messages, or notes logged yet.
            </div>
          )
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

        {/* ═══ SMART TIMELINE — unified, newest-first stream of PROCESSED CRM EVENTS
              ONLY (calls · WhatsApp · notes · CRM activities). The raw imported
              remark blob is NOT rendered here — it lives verbatim in the Raw
              History tab. Every item is sorted by its effective IST timestamp,
              latest at the TOP. ═══ */}
        {viewMode === "smart" && filteredStream.map((it) => {
          // ── CALL LOG ──
          if (it.kind === "call") {
            const c = it.call!;
            const col = callColour(c.outcome, c.notes);
            const displayName = canonicalAgentName(c.attributedAgentName ?? c.user?.name ?? "Unknown Agent", agentNames);
            const notesClean = c.notes
              ? c.notes.replace(/^[A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2}\s*:\s*/, "")
              : null;
            // Per-call REMARK edit — ADMIN/MANAGER any · agent own + same IST day
            // (canEditRemark off the call's author + startedAt). Server re-checks (403).
            const callEdited = editedCalls[c.id];
            const callEditing = editCallId === c.id;
            const callEditable = canEditRemark(
              { id: meId ?? "", role: viewerRole ?? (isAdmin ? "ADMIN" : "AGENT") },
              { createdById: c.userId ?? null, createdAt: c.startedAt },
            );
            return (
              <div key={it.id} className={`border-l-2 ${col.border} ${col.bg} pl-3 pr-2 py-1.5 rounded-r`}>
                <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                  <span>
                    📞 <b>{displayName}</b> · {fmtIST12Paren(c.startedAt)} IST
                    {c.durationSec ? ` · ${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : ""}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    {callEdited && (
                      <span className="text-[9px] text-gray-400 italic"
                        title={`Edited ${new Date(callEdited.at).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST`}>✏️ Edited by {callEdited.by}</span>
                    )}
                    <span className={`chip ${col.pill} text-[9px]`}>{callOutcomeLabel(c.outcome, c.notes)}</span>
                    {callEditable && !callEditing && (
                      <button type="button" onClick={() => startEditCall(c.id, c.notes ?? "")}
                        title="Edit this call remark (the original is kept in the audit log)"
                        className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline">✏️ Edit</button>
                    )}
                  </span>
                </div>
                {callEditing ? (
                  <div className="mt-1">
                    <textarea value={callDraft} onChange={(e) => setCallDraft(e.target.value)} rows={3} autoFocus
                      className="w-full text-xs border border-indigo-300 rounded px-2 py-1 dark:bg-slate-800 dark:border-slate-600"
                      placeholder="Call remark…" />
                    {callError && <div className="text-[10px] text-rose-600 mt-0.5">{callError}</div>}
                    <div className="flex gap-2 mt-1">
                      <button type="button" onClick={() => saveEditCall(c.id)} disabled={callBusy}
                        className="text-[11px] font-semibold px-2.5 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">{callBusy ? "Saving…" : "Save"}</button>
                      <button type="button" onClick={cancelEditCall} disabled={callBusy}
                        className="text-[11px] px-2.5 py-0.5 rounded border border-gray-300 text-gray-600 dark:border-slate-600 dark:text-slate-300">Cancel</button>
                    </div>
                  </div>
                ) : (
                  notesClean && <div className="text-xs mt-1 text-gray-700 dark:text-slate-200 whitespace-pre-wrap">{notesClean}</div>
                )}
                {c.recordingUrl && (
                  // Stream through the scope-checked proxy (never expose the provider
                  // URL/token to the browser) + download — parity with the Buyer timeline.
                  <div className="mt-1" title={audioTitle}><CallRecordingPlayer callId={c.id} compact /></div>
                )}
              </div>
            );
          }

          // ── WHATSAPP ──
          if (it.kind === "wa") {
            const m = it.wa!;
            const col = waColour(m.direction);
            return (
              <div key={it.id} className={`border-l-2 ${col.border} ${col.bg} pl-3 pr-2 py-1.5 rounded-r`}>
                <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                  {/* Actor attribution (Lalit, 2026-07-01): an OUTBOUND message shows
                      the agent who actually SENT it (m.actor), canonicalised. When
                      there is no actor — automation-sent, or a legacy row that predates
                      the actorUserId column — show the neutral "Outbound", NEVER the
                      lead owner and NEVER a fabricated "Agent". Inbound stays "Client". */}
                  <span>💬 <b>{m.direction === "INBOUND" ? "📥 Client" : `📤 ${m.actor?.name ? canonicalAgentName(m.actor.name, agentNames) : "Outbound"}`}</b> · {fmtIST12Paren(m.receivedAt)} IST</span>
                  <span className={`chip ${col.pill} text-[9px]`}>{m.direction === "INBOUND" ? "📥 Inbound" : "📤 Outbound"}</span>
                </div>
                <div className="text-xs mt-1 text-gray-800 whitespace-pre-wrap">{m.body}</div>
              </div>
            );
          }

          // ── NOTE (voice + typed) — editable inline (admin, or author same IST day) ──
          if (it.kind === "note") {
            const n = it.note!;
            const editing = editNoteId === n.id;
            const noteEdit = editedNotes[n.id];
            return (
              <div key={it.id} className="border-l-2 border-amber-300 bg-amber-50/40 pl-3 pr-2 py-1.5 rounded-r">
                <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                  <span>📝 <b>{n.user?.name ?? fallbackActor}</b> · {fmtIST12Paren(n.createdAt)} IST</span>
                  <span className="inline-flex items-center gap-1.5">
                    {noteEdit && isAdmin && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                        title={`Edited ${new Date(noteEdit.at).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST`}>✏️ Edited by {noteEdit.by}</span>
                    )}
                    {canEditRemark({ id: meId ?? "", role: viewerRole ?? (isAdmin ? "ADMIN" : "AGENT") }, { createdById: n.userId ?? null, createdAt: n.createdAt }) && !editing && (
                      <button type="button" onClick={() => startEditNote(n.id, n.body)}
                        title="Edit this remark"
                        className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline">✏️ Edit</button>
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
          }

          // ── IMPORTED REMARK (parsed from the rawRemarks audit blob) ──
          // One clean card per remark: date → author → FULL body (never truncated).
          // A subtle "Imported" chip marks the provenance; the verbatim blob still
          // lives unchanged in the Raw History tab. Date-only remarks (noon
          // sentinel) show the DATE ALONE — no invented clock time. Undated
          // fragments render as "Imported note" so nothing is ever dropped.
          if (it.kind === "remark") {
            const e = it.remark!;
            const col = remarkColour(e.eventType);
            const who = e.agentName ? canonicalAgentName(e.agentName, agentNames) : null;
            const dateLabel = !e.date
              ? null
              : isNoonSentinel(e.date)
                ? `${fmtISTDate(e.date)}`             // date-only remark — no clock time
                : `${fmtIST12Paren(e.date)} IST`;     // real timestamp
            return (
              <div key={it.id} className={`border-l-2 ${col.border} ${col.bg} pl-3 pr-2 py-1.5 rounded-r`}>
                <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                  <span>
                    {REMARK_ICON[e.eventType] ?? "🗒"} {who ? <><b>{who}</b> · </> : null}
                    {dateLabel ?? "Imported note"}
                  </span>
                  <span className="chip text-[9px] border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300" title="Parsed from the imported Raw History (verbatim original preserved in the Raw History tab)">📋 Imported</span>
                </div>
                {/* FULL body — whitespace-pre-wrap + break-words, NO max-height / NO
                    truncation, so even a very long imported remark renders complete. */}
                <div className="text-xs mt-1 text-gray-800 dark:text-slate-200 whitespace-pre-wrap break-words">{e.text}</div>
              </div>
            );
          }

          // ── CRM ACTIVITY (meeting / visit / status change / reject / convert /
          //    brochure / email / reminder …). Admin/super-admin gets a per-card
          //    ✏️ Edit on the RIGHT that opens the edit modal for THIS entry only. ──
          const a = it.act!;
          const when = a.completedAt ?? a.scheduledAt ?? a.createdAt;
          // Actor resolution — NEVER the literal "Agent". Priority:
          //   1. the recorded author (a.user.name), canonicalised; else
          //   2. "System" for system-cron rows — STATUS_CHANGE activities written
          //      with NO user by the AI rescorer / revival engine / reconciler /
          //      follow-up rollover (so automation isn't mis-attributed to a person);
          //      else
          //   3. the lead owner's real name; else "Unknown User".
          // A user-driven reject also writes STATUS_CHANGE but WITH a userId, so it
          // resolves via (1) to the real rejecting user — not "System".
          const who = a.user?.name
            ? canonicalAgentName(a.user.name, agentNames)
            : a.type === "STATUS_CHANGE"
              ? "System"
              : fallbackActor;
          // Surfaced system NOTE activities (follow-up change / admin inline edit)
          // have no entry in the meeting/status icon+label maps — give them a
          // sensible icon + chip so they read as what they are.
          // IMPORTANT (UI clarity): an inline-field-edit row ("Inline edit: N
          // field(s)") is a SYSTEM audit line, not a freely-editable entry. It must
          // NEVER show the word "Edit" (or a ✏️ pencil) — that read as a broken,
          // unclickable Edit button next to the real per-entry Edit affordance. It
          // gets a neutral "🛈 System" chip instead; the real Edit button below is
          // suppressed for surfacedNote rows. (followup-change keeps its own
          // "📅 Follow-up" label — also non-Edit, so unambiguous.)
          const surfacedNote = isSurfacedNoteActivity(a);
          const isFollowupChange = surfacedNote && (a.actionContext ?? "").startsWith("followup-change");
          const actIcon = ACTIVITY_ICON[a.type] ?? (isFollowupChange ? "📅" : surfacedNote ? "🛈" : "•");
          const actLabel = ACTIVITY_LABEL[a.type] ?? (isFollowupChange ? "Follow-up" : surfacedNote ? "System" : "Activity");
          return (
            <div key={it.id} className="border-l-2 border-slate-300 bg-slate-50/70 pl-3 pr-2 py-1.5 rounded-r">
              <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                <span>{actIcon} <b>{who}</b> · {fmtIST12Paren(when)} IST</span>
                <span className="inline-flex items-center gap-1.5">
                  {a.outcome && (
                    <span className="chip text-[9px] border border-emerald-300 bg-emerald-50 text-emerald-700">{a.outcome}</span>
                  )}
                  <span className="chip text-[9px] border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{actLabel}</span>
                  {/* Per-entry edit. ADMIN / MANAGER → any entry, any date. AGENT →
                      ONLY their OWN free-text entry (meeting/visit/discussion/email/
                      brochure) and ONLY on the IST day they logged it — computed from
                      the entry's stored createdAt + author + role via canEditActivity
                      (NOT a mount-time or admin-only flag), so an EXISTING same-day
                      entry is editable without recreating it. The PATCH endpoint
                      re-enforces the identical rule (403 otherwise). NOT offered on
                      surfaced system NOTE rows (follow-up/inline-edit audit lines). */}
                  {!surfacedNote && canEditActivity(
                    { id: meId ?? "", role: viewerRole ?? (isAdmin ? "ADMIN" : "AGENT") },
                    { type: a.type, createdById: a.userId ?? null, createdAt: a.createdAt },
                  ) && (
                    <button type="button" onClick={() => setEditActivity(a)}
                      title="Edit this timeline entry (original kept in the audit log)"
                      className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline">✏️ Edit</button>
                  )}
                </span>
              </div>
              {(a.title || a.description) && (
                <div className="text-xs mt-1 text-gray-800 whitespace-pre-wrap">
                  {a.title}{a.title && a.description ? " — " : ""}{a.description}
                </div>
              )}
              {a.followupDate && (
                <div className="text-[10px] text-emerald-700 mt-0.5">📅 Follow-up: {fmtIST12Paren(a.followupDate)} IST</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Per-entry edit modal (admin/super-admin) — opens for one Activity. ── */}
      {editActivity && (
        <TimelineEntryEditModal
          leadId={leadId}
          activityId={editActivity.id}
          initial={{
            type: editActivity.type,
            outcome: editActivity.outcome ?? "",
            description: editActivity.description ?? "",
            // Effective date the card shows: completedAt ?? scheduledAt. Tell the
            // modal which field that maps to so a completed event isn't moved onto
            // scheduledAt (or vice-versa) on save.
            when: toISTLocalInput(editActivity.completedAt ?? editActivity.scheduledAt ?? editActivity.createdAt),
            whenIsScheduled: !editActivity.completedAt && !!editActivity.scheduledAt,
            followup: toISTLocalInput(editActivity.followupDate),
          }}
          onClose={() => setEditActivity(null)}
        />
      )}

      {/* Legend */}
      <div className="mt-3 pt-2 border-t border-emerald-200 flex items-center gap-3 flex-wrap text-[10px] text-gray-600">
        <span><span className="inline-block w-2 h-2 bg-emerald-400 rounded-full mr-1 align-middle" />Connected</span>
        <span><span className="inline-block w-2 h-2 bg-red-400 rounded-full mr-1 align-middle" />Missed</span>
        <span><span className="inline-block w-2 h-2 bg-blue-400 rounded-full mr-1 align-middle" />📥 Client WA</span>
        <span><span className="inline-block w-2 h-2 bg-purple-400 rounded-full mr-1 align-middle" />📤 Outbound WA</span>
        <span><span className="inline-block w-2 h-2 bg-amber-400 rounded-full mr-1 align-middle" />📝 Note</span>
        <span><span className="inline-block w-2 h-2 bg-green-400 rounded-full mr-1 align-middle" />🏢 Site Visit</span>
        <span><span className="inline-block w-2 h-2 bg-blue-500 rounded-full mr-1 align-middle" />🤝 Meeting</span>
      </div>
    </div>
  );
}
