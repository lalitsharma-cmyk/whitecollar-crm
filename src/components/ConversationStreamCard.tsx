// Merged WhatsApp + Call stream — replaces the standalone CallHistoryCard
// mount on the lead detail page. One unified chronological feed lets the agent
// scan "what happened with this client" in time order instead of bouncing
// between two cards.
//
// Lalit's ask: "Merge call history + WhatsApp into one stream so I can see the
// real conversation flow, not two separate columns."

import { fmtIST12Paren, fmtISTDate } from "@/lib/datetime";
import type { CallLog, WhatsAppMessage } from "@prisma/client";

type CallLogWithUser = CallLog & { user: { name: string } };

interface Props {
  callLogs: CallLogWithUser[];
  waMessages: WhatsAppMessage[];
  // Optional: when "Dubai", surface a tiny UAE-consent reminder tooltip on the
  // audio control. UAE call-recording rules require explicit consent, so we
  // hint to the agent that any recording here likely belongs to the India team
  // workflow only. Caller may omit; we degrade silently.
  forwardedTeam?: string | null;
}

// Discriminated union — each row in the merged stream is either a call or
// a WhatsApp message. `at` is the sortable timestamp used by Array.sort.
type StreamRow =
  | { kind: "call"; at: Date; call: CallLogWithUser }
  | { kind: "wa"; at: Date; msg: WhatsAppMessage };

// Map a call outcome to the colour theme for its row. CONNECTED / INTERESTED
// → green (real conversation), everything else → red (no answer / declined).
function callColour(outcome: CallLog["outcome"]): { border: string; bg: string; pill: string } {
  if (outcome === "CONNECTED" || outcome === "INTERESTED") {
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

export default function ConversationStreamCard({ callLogs, waMessages, forwardedTeam }: Props) {
  // UAE recording-consent hint — Dubai team is reminded that recordings are
  // generally India-team only; Dubai-side calls typically aren't recorded.
  const audioTitle = forwardedTeam === "Dubai"
    ? "Recordings may exist only for India team (UAE consent rules)"
    : undefined;
  // Merge then sort newest-first. Stable Date comparison; ties broken by
  // CALL > WA so a "log call + send confirmation" pair shows the action first.
  const rows: StreamRow[] = [
    ...callLogs.map((c) => ({ kind: "call" as const, at: c.startedAt, call: c })),
    ...waMessages.map((m) => ({ kind: "wa" as const, at: m.receivedAt, msg: m })),
  ].sort((a, b) => {
    const d = b.at.getTime() - a.at.getTime();
    if (d !== 0) return d;
    return a.kind === "call" && b.kind === "wa" ? -1 : a.kind === "wa" && b.kind === "call" ? 1 : 0;
  });

  // Header counts — agent skims these before scrolling.
  const callCount = callLogs.length;
  const waCount = waMessages.length;
  const connectedCount = callLogs.filter((c) => c.outcome === "CONNECTED" || c.outcome === "INTERESTED").length;

  return (
    <div className="card p-5 border-l-4 border-emerald-500 bg-emerald-50/20">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="font-semibold flex items-center gap-2 text-base">
          💬 Conversation history
          <span className="text-[10px] text-gray-500 font-normal">— calls + WhatsApp, newest first</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="chip chip-warm">📞 {callCount}</span>
          <span className="chip chip-won">✅ {connectedCount}</span>
          <span className="chip src-wa">💬 {waCount}</span>
        </div>
      </div>

      <div className="space-y-2 text-sm max-h-[520px] overflow-y-auto pr-1">
        {rows.length === 0 && (
          <div className="text-gray-500 text-xs text-center py-4">
            No calls or WhatsApp messages logged yet. Use 📝 Log Call above to record the first one.
          </div>
        )}

        {rows.map((row, idx) => {
          if (row.kind === "call") {
            const c = row.call;
            const col = callColour(c.outcome);
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
                  <span className={`chip ${col.pill} text-[9px]`}>{c.outcome.replaceAll("_", " ")}</span>
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
          // WhatsApp row.
          const m = row.msg;
          const col = waColour(m.direction);
          const arrow = m.direction === "INBOUND" ? "↙" : "↗";
          return (
            <div key={`w-${m.id}-${idx}`} className={`border-l-2 ${col.border} ${col.bg} pl-3 pr-2 py-1.5 rounded-r`}>
              <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-gray-500">
                <span>
                  💬 {arrow} <b>{m.direction === "INBOUND" ? "Client" : "Agent"}</b> · {fmtIST12Paren(m.receivedAt)} IST
                </span>
                <span className={`chip ${col.pill} text-[9px]`}>{m.direction === "INBOUND" ? "Inbound" : "Outbound"}</span>
              </div>
              <div className="text-xs mt-1 text-gray-800 whitespace-pre-wrap">{m.body}</div>
            </div>
          );
        })}
      </div>

      {/* Tiny key for the colours so a brand-new agent knows what each row
          means without asking. */}
      <div className="mt-3 pt-2 border-t border-emerald-200 flex items-center gap-3 flex-wrap text-[10px] text-gray-600">
        <span><span className="inline-block w-2 h-2 bg-emerald-400 rounded-full mr-1 align-middle" />Call connected</span>
        <span><span className="inline-block w-2 h-2 bg-red-400 rounded-full mr-1 align-middle" />Call missed/declined</span>
        <span><span className="inline-block w-2 h-2 bg-blue-400 rounded-full mr-1 align-middle" />WA inbound</span>
        <span><span className="inline-block w-2 h-2 bg-purple-400 rounded-full mr-1 align-middle" />WA outbound</span>
      </div>
      {/* Date band — first → last conversation (handy at a glance even on a
          super long history). */}
      {rows.length > 1 && (
        <div className="mt-2 text-[10px] text-gray-500">
          {fmtISTDate(rows[rows.length - 1].at)} → {fmtISTDate(rows[0].at)}
        </div>
      )}
    </div>
  );
}
