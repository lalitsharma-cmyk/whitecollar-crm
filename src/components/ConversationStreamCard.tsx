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
import { fmtIST12Paren, fmtISTDate } from "@/lib/datetime";
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

// ─── Main component ───────────────────────────────────────────────────────────

type FilterType = "ALL" | "CONNECTED" | "NO_ANSWER" | "WA";

export default function ConversationStreamCard({
  callLogs, waMessages, notes = [], forwardedTeam, rawRemarks, leadCreatedAt, agentNames = [],
  leadId = "", canControl = false, viewerId, viewerTeam, controls = [], agents = [],
}: Props) {
  const [filter, setFilter] = useState<FilterType>("ALL");
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
  const displayRemarkEntries = useMemo(() => groupEntries(filteredRemarkEntries), [filteredRemarkEntries]);

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
        <div className="font-semibold flex items-center gap-2 text-base">
          💬 Conversation History
          <span className="text-[10px] text-gray-500 font-normal">— complete lead journey</span>
        </div>
        {/* Filter chips */}
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

        {/* ─ Imported remarks (filtered to the active chip) ─ */}
        {filter !== "WA" && displayRemarkEntries.map((item, idx) => {
          const key = `remark-${idx}`;

          if (item.kind === "missed_group") {
            const expanded = expandedGroups.has(key);
            return (
              <div key={key} className="border-l-2 border-red-200 bg-red-50/20 pl-3 pr-2 py-1.5 rounded-r">
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
            );
          }

          // Single remark entry
          const e: RemarkEntry = item.entry;
          const border = REMARK_BORDER[e.eventType];
          const bg     = REMARK_BG[e.eventType];
          const icon   = remarkIcon(e.eventType);
          const dateStr = e.date ? fmtDateTime(e.date) : null;
          // Moderation state — only controllers ever reach here with a hidden entry.
          const rKey = remarkKeyFor(e);
          const ctrl = controlByKey.get(rKey) ?? null;
          const hiddenCount = (ctrl?.hiddenFromUserIds ?? "").split(",").map(s => s.trim()).filter(Boolean).length;
          const teamCount = (ctrl?.hiddenFromTeams ?? "").split(",").map(s => s.trim()).filter(Boolean).length;
          const moderated = !!ctrl && (ctrl.deletedFromView || ctrl.hiddenFromAll || hiddenCount > 0 || teamCount > 0);
          const modBadge = ctrl?.deletedFromView ? "removed" : ctrl?.hiddenFromAll ? "hidden · all" : teamCount > 0 ? `hidden · ${teamCount} team${teamCount > 1 ? "s" : ""}` : hiddenCount > 0 ? `hidden · ${hiddenCount} agent${hiddenCount > 1 ? "s" : ""}` : null;

          return (
            <div key={key} className={`border-l-2 ${border} ${bg} pl-3 pr-2 py-1.5 rounded-r ${moderated ? "opacity-60" : ""} ${canControl && manageMode && selectedKeys.has(rKey) ? "ring-2 ring-[#0b1a33]/40" : ""}`}>
              {/* Agent · date header */}
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-0.5 flex-wrap">
                {canControl && manageMode && (
                  <input type="checkbox" className="h-3.5 w-3.5 flex-none accent-[#0b1a33]" checked={selectedKeys.has(rKey)} onChange={() => toggleSelect(rKey)} />
                )}
                {e.agentName && (
                  <span className="font-semibold text-gray-600 dark:text-slate-300">{e.agentName}</span>
                )}
                {e.agentName && dateStr && <span>·</span>}
                {dateStr && (
                  <span className={e.dateInferred ? "italic opacity-60" : ""}>{dateStr}</span>
                )}
                {!dateStr && (
                  <span className="italic opacity-50">Undated</span>
                )}
                <span className="ml-auto inline-flex items-center gap-1">
                  {canControl && modBadge && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{modBadge}</span>
                  )}
                  <span className="text-[10px]">{icon}</span>
                  {canControl && !manageMode && (
                    <RemarkControlMenu leadId={leadId} remarkKey={rKey} control={ctrl} agents={agents} />
                  )}
                </span>
              </div>
              {/* Body — one merged remark block shown as a single readable
                  paragraph (broken line breaks / Excel splits normalised). */}
              <div className="text-xs text-gray-700 dark:text-slate-200 break-words leading-relaxed">
                {toReadableParagraph(e.text)}
              </div>
            </div>
          );
        })}

        {/* ─ Real CRM call logs ─ */}
        {callLogs.filter(showCallLog).map((c, idx) => {
          const col = callColour(c.outcome, c.notes);
          const displayName = c.attributedAgentName ?? c.user.name;
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

        {/* ─ Notes (voice + typed) — real conversation records, shown under Connected too ─ */}
        {(filter === "ALL" || filter === "CONNECTED") && notes.map((n, idx) => (
          <div key={`n-${n.id}`} className="border-l-2 border-amber-300 bg-amber-50/40 pl-3 pr-2 py-1.5 rounded-r">
            <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
              <span>📝 <b>{n.user?.name ?? "Agent"}</b> · {fmtIST12Paren(n.createdAt)} IST</span>
              <span className="chip text-[9px] border border-amber-300 bg-amber-100 text-amber-700">Note</span>
            </div>
            <div className="text-xs mt-1 text-gray-800 whitespace-pre-wrap">{n.body}</div>
          </div>
        ))}
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
