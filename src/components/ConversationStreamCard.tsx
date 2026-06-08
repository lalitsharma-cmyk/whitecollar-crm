"use client";

// Merged WhatsApp + Call stream — replaces the standalone CallHistoryCard
// mount on the lead detail page. One unified chronological feed lets the agent
// scan "what happened with this client" in time order instead of bouncing
// between two cards.
//
// Lalit's ask: "Merge call history + WhatsApp into one stream so I can see the
// real conversation flow, not two separate columns."

import { useState } from "react";
import { fmtIST12Paren, fmtISTDate } from "@/lib/datetime";
import type { CallLog, WhatsAppMessage } from "@prisma/client";
import { extractUndatedSegments, type SegmentEntry } from "@/lib/remarkParser";

// Voice notes + quick text notes — all saved to the Note model via
// /api/leads/[id]/notes. Displayed inline in the stream in IST order.
interface NoteWithUser {
  id: string;
  body: string;
  createdAt: Date;
  user: { name: string } | null;
}

// CONNECTED = actual two-way communication happened (call answered, or client
// expressed interest / disinterest — either way they spoke). INTERESTED and
// NOT_INTERESTED both imply a real conversation; only the outcome differs.
const CONNECTED_OUTCOMES = new Set(["CONNECTED", "INTERESTED", "NOT_INTERESTED"]);
// UNSUCCESSFUL = no connection was made regardless of reason.
const UNSUCCESSFUL_OUTCOMES = new Set(["NOT_PICKED", "BUSY", "SWITCHED_OFF", "WRONG_NUMBER", "CALLBACK"]);

// Compress consecutive unsuccessful attempts into a single collapsible row.
// NOT_PICKED: compressed regardless of age (Lalit: "merge all not-pick series")
// Other unsuccessful (BUSY, SWITCHED_OFF, etc.): compressed only when older than
// COMPRESS_THRESHOLD_DAYS and the call has no notes / recording.
const COMPRESS_THRESHOLD_DAYS = 30;
const COMPRESS_MIN_COUNT = 2; // lower from 3 → 2 so even pairs collapse

// Effective outcome for display purposes. Older entries logged as "Dropped Wa"
// in the remarks were incorrectly saved as CONNECTED before the "Dropped WA"
// outcome option existed. Detect these by remarks text and treat them as
// NOT_PICKED so they display and colour correctly without a DB migration.
function effectiveOutcome(outcome: string, notes: string | null | undefined): string {
  if (outcome === "CONNECTED" && notes && /dropped\s*wa/i.test(notes)) {
    return "NOT_PICKED";
  }
  return outcome;
}

function callOutcomeLabel(outcome: string, notes?: string | null): string {
  const eff = effectiveOutcome(outcome, notes);
  if (eff !== outcome) return "📵 Dropped WA";
  const map: Record<string, string> = {
    CONNECTED: "✅ Connected",
    NOT_PICKED: "📵 Not Picked",
    CALLBACK: "🔁 Callback",
    WRONG_NUMBER: "🚫 Wrong Number",
    BUSY: "⏳ Busy",
    SWITCHED_OFF: "📴 Switched Off",
    INTERESTED: "✅ Connected",       // interest belongs in BANT, not call history
    NOT_INTERESTED: "🛑 Not Interested",
  };
  return map[eff] ?? eff.replaceAll("_", " ");
}

type CallLogWithUser = CallLog & { user: { name: string } };

interface Props {
  callLogs: CallLogWithUser[];
  waMessages: WhatsAppMessage[];
  notes?: NoteWithUser[];
  forwardedTeam?: string | null;
  // Raw remarks text from the imported sheet — undated lines that the
  // date-parser skips are shown as "Import notes" so nothing is ever lost.
  rawRemarks?: string | null;
}

// Discriminated union — each row in the merged stream is either a call,
// a WhatsApp message, a typed/voice note, or an imported remark without a date.
// `at` is the sortable timestamp used by Array.sort.
type StreamRow =
  | { kind: "call"; at: Date; call: CallLogWithUser }
  | { kind: "wa"; at: Date; msg: WhatsAppMessage }
  | { kind: "note"; at: Date; note: NoteWithUser }
  | { kind: "imported"; at: Date; text: string; hasDate: boolean }; // §18: historical remarks

// A compressed placeholder for ≥ COMPRESS_MIN_COUNT consecutive unsuccessful
// attempts that are all older than the threshold and have no notes/recordings.
type CompressedGroup = {
  kind: "compressed";
  count: number;
  from: Date;  // oldest attempt in the group
  to: Date;    // newest attempt in the group
  rows: StreamRow[];
};

type DisplayRow = StreamRow | CompressedGroup;

// Map a call outcome to the colour theme for its row.
// Green = real conversation happened; red = no connection made.
function callColour(outcome: CallLog["outcome"], notes?: string | null): { border: string; bg: string; pill: string } {
  const eff = effectiveOutcome(outcome as string, notes);
  if (CONNECTED_OUTCOMES.has(eff)) {
    return { border: "border-emerald-300", bg: "bg-emerald-50/40", pill: "chip-won" };
  }
  return { border: "border-red-200", bg: "bg-red-50/30", pill: "chip-cold" };
}

// Inbound (blue) vs outbound (purple) for WhatsApp. Mirrors how WA chat
// apps colour-code their own message bubbles so it's intuitive.
function waColour(direction: WhatsAppMessage["direction"]): { border: string; bg: string; pill: string } {
  if (direction === "INBOUND") {
    return { border: "border-blue-300", bg: "bg-blue-50/40", pill: "chip-warm" };
  }
  return { border: "border-purple-300", bg: "bg-purple-50/40", pill: "src-wa" };
}

// Walk the newest-first row list and group consecutive compressible entries.
// Never compresses: connected calls, WA messages, calls with notes/recordings,
// or anything within the last COMPRESS_THRESHOLD_DAYS days.
function buildDisplayRows(rows: StreamRow[]): DisplayRow[] {
  const threshold = new Date(Date.now() - COMPRESS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const canCompress = (row: StreamRow): boolean => {
    if (row.kind !== "call") return false;
    const { outcome, notes, recordingUrl } = row.call;
    const eff = effectiveOutcome(outcome as string, notes);
    if (!UNSUCCESSFUL_OUTCOMES.has(eff)) return false;
    if (notes && notes.trim().length > 0) return false;
    if (recordingUrl) return false;
    // NOT_PICKED: always compressible regardless of age
    if (eff === "NOT_PICKED") return true;
    // Other unsuccessful outcomes: only compress if older than threshold
    return row.at < threshold;
  };

  const result: DisplayRow[] = [];
  let pending: StreamRow[] = [];

  const flush = () => {
    if (pending.length >= COMPRESS_MIN_COUNT) {
      // rows are newest-first → last item is oldest, first item is newest
      result.push({
        kind: "compressed",
        count: pending.length,
        from: pending[pending.length - 1].at,
        to: pending[0].at,
        rows: [...pending],
      });
    } else {
      result.push(...pending);
    }
    pending = [];
  };

  for (const row of rows) {
    if (canCompress(row)) {
      pending.push(row);
    } else {
      flush();
      result.push(row);
    }
  }
  flush();

  return result;
}

type FilterType = "ALL" | "CONNECTED" | "NO_ANSWER" | "WA";

export default function ConversationStreamCard({ callLogs, waMessages, notes = [], forwardedTeam, rawRemarks }: Props) {
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<FilterType>("ALL");

  // Imported MIS remarks were historically saved as synthetic CallLog rows
  // (attributedAgentName != null). They are NOT dialled calls — they render as
  // read-only Historical Notes (from rawRemarks, below), never as call rows and
  // never in the connected / no-answer counts. Defensive filter: rows may still
  // exist until the one-off import cleanup runs, and it guards future imports.
  const realCallLogs = callLogs.filter((c) => c.attributedAgentName == null);

  const toggleGroup = (idx: number) =>
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  // UAE recording-consent hint — Dubai team is reminded that recordings are
  // generally India-team only; Dubai-side calls typically aren't recorded.
  const audioTitle = forwardedTeam === "Dubai"
    ? "Recordings may exist only for India team (UAE consent rules)"
    : undefined;

  // §18: imported remarks — dated ones sort into correct position; truly undated go to bottom.
  const segments: SegmentEntry[] = rawRemarks ? extractUndatedSegments(rawRemarks) : [];
  const UNDATED_BASE = new Date(1); // epoch ~0 = always at bottom (below all real dates)

  // Merge then sort newest-first.
  const rows: StreamRow[] = [
    ...realCallLogs.map((c) => ({ kind: "call" as const, at: new Date(c.startedAt), call: c })),
    ...waMessages.map((m) => ({ kind: "wa" as const, at: new Date(m.receivedAt), msg: m })),
    ...notes.map((n) => ({ kind: "note" as const, at: new Date(n.createdAt), note: n })),
    // Segments with a parsed date → correct timeline position.
    // Segments without a date → epoch bottom, labelled "Historical note".
    ...segments.map((seg) => ({
      kind: "imported" as const,
      at: seg.date ?? UNDATED_BASE,
      text: seg.text,
      hasDate: seg.date !== null,
    })),
  ].sort((a, b) => {
    const d = b.at.getTime() - a.at.getTime();
    if (d !== 0) return d;
    // tie-break: call > note > wa
    const rank = (r: StreamRow) => r.kind === "call" ? 0 : r.kind === "note" ? 1 : 2;
    return rank(a) - rank(b);
  });

  // Header counts — use effectiveOutcome so "Dropped Wa" entries aren't
  // miscounted as connected even though they were saved with CONNECTED in DB.
  const connectedCount = realCallLogs.filter(c => CONNECTED_OUTCOMES.has(effectiveOutcome(c.outcome as string, c.notes))).length;
  const unsuccessfulCount = realCallLogs.filter(c => UNSUCCESSFUL_OUTCOMES.has(effectiveOutcome(c.outcome as string, c.notes))).length;
  const waInboundCount = waMessages.filter(m => m.direction === "INBOUND").length;
  const noteCount = notes.length;

  const displayRows = buildDisplayRows(rows);

  // Apply active filter to display rows.
  // Notes only appear in ALL — they're context, not a call/WA event.
  const filteredRows = filter === "ALL" ? displayRows : displayRows.filter(row => {
    if (row.kind === "note") return false;     // notes only in ALL view
    if (row.kind === "imported") return false; // imported remarks only in ALL view
    if (filter === "CONNECTED") {
      if (row.kind === "compressed") return false;
      if (row.kind === "wa") return false;
      return CONNECTED_OUTCOMES.has(effectiveOutcome(row.call.outcome as string, row.call.notes));
    }
    if (filter === "NO_ANSWER") {
      if (row.kind === "compressed") return true; // compressed = unsuccessful
      if (row.kind === "wa") return false;
      return UNSUCCESSFUL_OUTCOMES.has(effectiveOutcome(row.call.outcome as string, row.call.notes));
    }
    if (filter === "WA") {
      return row.kind === "wa";
    }
    return true;
  });

  return (
    <div className="card p-5 border-l-4 border-emerald-500 bg-emerald-50/20">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="font-semibold flex items-center gap-2 text-base">
          💬 Conversation history
          <span className="text-[10px] text-gray-500 font-normal">— calls · WhatsApp · notes, newest first</span>
        </div>
        {/* Filter chips — clickable to show only that category */}
        <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
          <button
            type="button"
            onClick={() => setFilter(f => f === "CONNECTED" ? "ALL" : "CONNECTED")}
            className={`chip chip-won cursor-pointer transition-opacity ${filter !== "ALL" && filter !== "CONNECTED" ? "opacity-30" : ""}`}
            title="Show only connected calls"
          >
            📞 {connectedCount} connected
          </button>
          <button
            type="button"
            onClick={() => setFilter(f => f === "NO_ANSWER" ? "ALL" : "NO_ANSWER")}
            className={`chip chip-cold cursor-pointer transition-opacity ${filter !== "ALL" && filter !== "NO_ANSWER" ? "opacity-30" : ""}`}
            title="Show only missed/declined calls"
          >
            📵 {unsuccessfulCount} no-answer
          </button>
          {waInboundCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter(f => f === "WA" ? "ALL" : "WA")}
              className={`chip src-wa cursor-pointer transition-opacity ${filter !== "ALL" && filter !== "WA" ? "opacity-30" : ""}`}
              title="Show only WhatsApp messages"
            >
              💬 {waInboundCount} WA replies
            </button>
          )}
          {noteCount > 0 && (
            <span
              className="chip text-[9px] border border-amber-300 bg-amber-50 text-amber-700"
              title="Notes (voice + typed) — always shown in All view"
            >
              📝 {noteCount} {noteCount === 1 ? "note" : "notes"}
            </span>
          )}
          {filter !== "ALL" && (
            <button
              type="button"
              onClick={() => setFilter("ALL")}
              className="text-[10px] text-gray-400 hover:text-gray-600 px-1"
            >
              ✕ clear
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 text-sm max-h-[520px] overflow-y-auto pr-1">
        {rows.length === 0 && (
          <div className="text-gray-500 text-xs text-center py-4">
            No calls, WhatsApp messages, or notes logged yet. Use the Log Call button or Voice Note recorder above.
          </div>
        )}
        {rows.length > 0 && filteredRows.length === 0 && (
          <div className="text-gray-400 text-xs text-center py-4">
            No {filter === "CONNECTED" ? "connected calls" : filter === "NO_ANSWER" ? "missed calls" : "WhatsApp messages"} in this lead.
          </div>
        )}

        {filteredRows.map((row, idx) => {
          // ── Compressed group ──────────────────────────────────────────────
          if (row.kind === "compressed") {
            const expanded = expandedGroups.has(idx);
            return (
              <div key={`grp-${idx}`} className="border-l-2 border-gray-300 bg-gray-50/60 pl-3 pr-2 py-1.5 rounded-r">
                <button
                  onClick={() => toggleGroup(idx)}
                  className="text-[11px] text-gray-500 flex items-center gap-1 w-full text-left hover:text-gray-700"
                >
                  <span>📵 {row.count} unsuccessful attempts</span>
                  <span className="text-gray-400">·</span>
                  <span>{fmtISTDate(row.from)} – {fmtISTDate(row.to)}</span>
                  <span className="ml-auto text-gray-400">{expanded ? "▲ Hide" : "▼ Expand"}</span>
                </button>
                {expanded && (
                  <div className="mt-2 space-y-1 pl-1 border-l border-gray-200">
                    {row.rows.map((r, ri) => {
                      if (r.kind !== "call") return null;
                      const c = r.call;
                      const col = callColour(c.outcome, c.notes);
                      const displayName = c.attributedAgentName ?? c.user.name;
                      return (
                        <div key={`cg-${c.id}-${ri}`} className={`border-l-2 ${col.border} ${col.bg} pl-3 pr-2 py-1 rounded-r`}>
                          <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                            <span>📞 <b>{displayName}</b> · {fmtIST12Paren(c.startedAt)} IST</span>
                            <span className={`chip ${col.pill} text-[9px]`}>{callOutcomeLabel(c.outcome, c.notes)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          // ── Call row ──────────────────────────────────────────────────────
          if (row.kind === "call") {
            const c = row.call;
            const col = callColour(c.outcome, c.notes);
            const displayName = c.attributedAgentName ?? c.user.name;
            // Strip leading "Agent: " prefix from MIS-imported remarks so we
            // don't show the name twice.
            const notesClean = c.notes
              ? c.notes.replace(/^[A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2}\s*:\s*/, "")
              : null;
            return (
              <div key={`c-${c.id}-${idx}`} className={`border-l-2 ${col.border} ${col.bg} pl-3 pr-2 py-1.5 rounded-r`}>
                <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                  <span>
                    📞 <b>{displayName}</b> · {fmtIST12Paren(c.startedAt)} IST
                    {c.durationSec ? ` · ${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : ""}
                  </span>
                  <span className={`chip ${col.pill} text-[9px]`}>{callOutcomeLabel(c.outcome, c.notes)}</span>
                </div>
                {notesClean && <div className="text-xs mt-1 text-gray-700 whitespace-pre-wrap">{notesClean}</div>}
                {c.recordingUrl && (
                  <audio
                    controls
                    preload="none"
                    src={c.recordingUrl}
                    title={audioTitle}
                    className="mt-1 h-7 max-w-full"
                  />
                )}
              </div>
            );
          }

          // ── WhatsApp row ──────────────────────────────────────────────────
          if (row.kind === "wa") {
            const m = row.msg;
            const col = waColour(m.direction);
            return (
              <div key={`w-${m.id}-${idx}`} className={`border-l-2 ${col.border} ${col.bg} pl-3 pr-2 py-1.5 rounded-r`}>
                <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                  <span>
                    💬 <b>{m.direction === "INBOUND" ? "📥 Client" : "📤 Agent"}</b> · {fmtIST12Paren(m.receivedAt)} IST
                  </span>
                  <span className={`chip ${col.pill} text-[9px]`}>{m.direction === "INBOUND" ? "📥 Inbound" : "📤 Outbound"}</span>
                </div>
                <div className="text-xs mt-1 text-gray-800 whitespace-pre-wrap">{m.body}</div>
              </div>
            );
          }

          // ── Note row (voice transcript or quick text note) ─────────────────
          if (row.kind === "note") {
          const n = row.note;
          return (
            <div key={`n-${n.id}-${idx}`} className="border-l-2 border-amber-300 bg-amber-50/40 pl-3 pr-2 py-1.5 rounded-r">
              <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                <span>
                  📝 <b>{n.user?.name ?? "Agent"}</b> · {fmtIST12Paren(n.createdAt)} IST
                </span>
                <span className="chip text-[9px] border border-amber-300 bg-amber-100 text-amber-700">Note</span>
              </div>
              <div className="text-xs mt-1 text-gray-800 whitespace-pre-wrap">{n.body}</div>
            </div>
          );
          }

          // ── Historical remark — no source badges. Clean date header or "Historical note".
          return (
            <div key={`imp-${idx}`} className="border-l-2 border-gray-100 dark:border-slate-700 pl-3 pr-2 py-1.5 rounded-r">
              <div className="text-[11px] text-gray-400 dark:text-slate-500 mb-0.5 font-medium">
                📋 Historical Note{row.hasDate ? ` · ${fmtISTDate(row.at)}` : ""}
              </div>
              <div className="text-xs text-gray-600 dark:text-slate-300 whitespace-pre-wrap">{row.text}</div>
            </div>
          );
        })}
      </div>

      {/* Tiny key for the colours so a brand-new agent knows what each row
          means without asking. */}
      <div className="mt-3 pt-2 border-t border-emerald-200 flex items-center gap-3 flex-wrap text-[10px] text-gray-600">
        <span><span className="inline-block w-2 h-2 bg-emerald-400 rounded-full mr-1 align-middle" />Call connected</span>
        <span><span className="inline-block w-2 h-2 bg-red-400 rounded-full mr-1 align-middle" />Call missed</span>
        <span><span className="inline-block w-2 h-2 bg-blue-400 rounded-full mr-1 align-middle" />📥 Client WA</span>
        <span><span className="inline-block w-2 h-2 bg-purple-400 rounded-full mr-1 align-middle" />📤 Agent WA</span>
        <span><span className="inline-block w-2 h-2 bg-amber-400 rounded-full mr-1 align-middle" />📝 Note</span>
      </div>
      {/* Date band — first → last conversation */}
      {rows.length > 1 && (
        <div className="mt-2 text-[10px] text-gray-500">
          {fmtISTDate(rows[rows.length - 1].at)} → {fmtISTDate(rows[0].at)}
        </div>
      )}

      {/* §18: Historical remarks are inline in the stream above — one unified timeline. */}
    </div>
  );
}
