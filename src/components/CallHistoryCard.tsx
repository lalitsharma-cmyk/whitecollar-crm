// Dedicated server component for the lead-detail "📞 Call history" panel.
//
// Lalit asked: "Put Call History in front after name etc field in leads —
// agent can read all history first before calling".
//
// Extracted from the right rail of leads/[id]/page.tsx so it can sit at the
// top of the LEFT column (right under the header + remarks) where it's the
// first thing an agent sees before dialling. The right rail used to hide it
// below 4 other cards on mobile.

import { fmtIST12Paren, fmtISTDate } from "@/lib/datetime";
import { aggregateCalls } from "@/lib/callStats";
import CallRecordingPlayer from "@/components/CallRecordingPlayer";
import type { CallLog } from "@prisma/client";

// Accept any Prisma CallLog row that includes the user relation. The page-level
// findMany already includes user, so this shape matches what gets passed in.
type CallLogWithUser = CallLog & { user: { name: string } };

interface Props {
  callLogs: CallLogWithUser[];
}

// Outcomes that mean "couldn't reach the client" — these are the ones we collapse
// when they happen back-to-back.
const NO_ANSWER_OUTCOMES = new Set(["NOT_PICKED", "SWITCHED_OFF", "BUSY"]);

type Group =
  | { kind: "single"; call: CallLogWithUser }
  | {
      kind: "no-answer-streak";
      attempts: CallLogWithUser[];   // 2+ consecutive no-answer calls
      firstAt: Date;
      lastAt: Date;
      displayName: string;
    };

/**
 * Walk the (newest-first) call list and collapse consecutive no-answer attempts
 * by the same agent into a single grouped row. Connected / Interested / Callback
 * always render as separate entries — those are the useful conversations.
 *
 * Lalit's request: "if there are many call not picked comments, they can be
 * summarised in group in Call history as call not pick (From 21st to 26 april)".
 */
/**
 * "Not picked for N days" computation.
 *
 * Input: call log array (newest-first as Prisma orderBy { startedAt: "desc" }).
 *
 * Returns: number of FULL days since the most recent CONNECTED call (or since
 * the FIRST call if none ever connected), provided at least one no-answer call
 * has happened since then. Returns null when not applicable (no calls, or the
 * latest call connected so they're being reached fine).
 *
 * Used for the "📵 Not picked Nd" chip in the card header + downstream by the
 * /leads filter chip.
 */
function computeNotPickedDays(callLogs: CallLogWithUser[]): number | null {
  if (callLogs.length === 0) return null;
  // Newest-first iteration: find the most recent CONNECTED.
  let lastConnectedAt: Date | null = null;
  for (const c of callLogs) {
    if (c.outcome === "CONNECTED" || c.outcome === "INTERESTED") {
      lastConnectedAt = c.startedAt;
      break;
    }
  }
  // No-answer outcomes that count as "tried but couldn't reach".
  const noAnswerSet = new Set(["NOT_PICKED", "SWITCHED_OFF", "BUSY"]);
  // Has there been a no-answer call AFTER the last connected? (or ever, if no connected)
  const since = lastConnectedAt;
  const recentNoAnswers = since
    ? callLogs.filter((c) => c.startedAt > since && noAnswerSet.has(c.outcome))
    : callLogs.filter((c) => noAnswerSet.has(c.outcome));
  if (recentNoAnswers.length === 0) return null;
  const anchor = lastConnectedAt ?? callLogs[callLogs.length - 1].startedAt;
  const days = Math.floor((Date.now() - anchor.getTime()) / 86_400_000);
  return days >= 1 ? days : null;
}

function groupCalls(callLogs: CallLogWithUser[]): Group[] {
  const out: Group[] = [];
  let i = 0;
  while (i < callLogs.length) {
    const c = callLogs[i];
    const isNoAnswer = NO_ANSWER_OUTCOMES.has(c.outcome);
    if (!isNoAnswer) {
      out.push({ kind: "single", call: c });
      i++;
      continue;
    }
    // Look ahead: extend the streak while the next entry is also a no-answer
    // by the SAME displayed agent (so collapsing doesn't muddy who tried).
    const displayName = c.attributedAgentName ?? c.user?.name ?? "Unknown Agent";
    const streak: CallLogWithUser[] = [c];
    let j = i + 1;
    while (j < callLogs.length) {
      const n = callLogs[j];
      const nName = n.attributedAgentName ?? n.user?.name ?? "Unknown Agent";
      if (NO_ANSWER_OUTCOMES.has(n.outcome) && nName === displayName) {
        streak.push(n);
        j++;
      } else break;
    }
    if (streak.length >= 2) {
      // newest first → first attempt is the LAST in array; last attempt is the FIRST
      const firstAt = streak[streak.length - 1].startedAt;
      const lastAt = streak[0].startedAt;
      out.push({ kind: "no-answer-streak", attempts: streak, firstAt, lastAt, displayName });
      i = j;
    } else {
      out.push({ kind: "single", call: c });
      i++;
    }
  }
  return out;
}

export default function CallHistoryCard({ callLogs }: Props) {
  // aggregateCalls expects the same shape — we already pass it in.
  const callStats = aggregateCalls(callLogs);
  // "Not picked for N days" — counts days since the most recent CONNECTED call,
  // provided at least one NOT_PICKED has happened since then. Surfaces leads
  // that are going stale despite repeated attempts, without screaming about
  // brand-new cold leads that have only had one attempt.
  const notPickedDays = computeNotPickedDays(callLogs);
  // First & Last call dates — Lalit's ask. callLogs comes in newest-first
  // (orderBy: { startedAt: "desc" }), so head = most recent, tail = oldest.
  const lastCallAt = callLogs[0]?.startedAt ?? null;
  const firstCallAt = callLogs[callLogs.length - 1]?.startedAt ?? null;
  const spanDays = firstCallAt && lastCallAt
    ? Math.max(0, Math.floor((lastCallAt.getTime() - firstCallAt.getTime()) / 86_400_000))
    : 0;

  return (
    <div className="card p-5 border-l-4 border-emerald-500 bg-emerald-50/30">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="font-semibold flex items-center gap-2 text-base">
          📞 Call history
          <span className="text-[10px] text-gray-500 font-normal">— read this before calling</span>
        </div>
        <div className="flex items-center gap-2">
          {notPickedDays != null && notPickedDays >= 1 && (
            <span className={`chip text-[10px] font-semibold ${
              notPickedDays >= 7 ? "chip-hot" : notPickedDays >= 3 ? "chip-warm" : "chip-lost"
            }`}>
              📵 Not picked {notPickedDays}d
            </span>
          )}
          <div className="text-[10px] text-gray-500">{callStats.total} total</div>
        </div>
      </div>

      {/* First / last call dates — derived from call history. Lalit's ask:
          "Show First call date and last call date somewhere on lead details
          page from Call history". One-line summary so agent sees activity
          span without scrolling the full history. */}
      {firstCallAt && lastCallAt && (
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-gray-700 mb-3 px-2 py-1.5 rounded bg-white border border-emerald-200">
          <span><b className="text-gray-500 font-semibold mr-1">First call:</b>{fmtISTDate(firstCallAt)}</span>
          <span><b className="text-gray-500 font-semibold mr-1">Last call:</b>{fmtISTDate(lastCallAt)}</span>
          {spanDays > 0 && <span className="text-gray-500">· spanning {spanDays} day{spanDays === 1 ? "" : "s"}</span>}
        </div>
      )}

      {/* Breakdown badges — the agent should scan these first */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center text-xs mb-3">
        <div className="p-2 rounded bg-blue-50 border border-blue-200">
          <div className="text-lg font-bold text-blue-700">{callStats.total}</div>
          <div className="text-[10px] text-gray-600">Dialed</div>
        </div>
        <div className="p-2 rounded bg-emerald-50 border border-emerald-200">
          <div className="text-lg font-bold text-emerald-700">{callStats.connected}</div>
          <div className="text-[10px] text-gray-600">Connected</div>
        </div>
        <div className="p-2 rounded bg-red-50 border border-red-200">
          <div className="text-lg font-bold text-red-700">{callStats.notPicked}</div>
          <div className="text-[10px] text-gray-600">Not picked</div>
        </div>
        <div className="p-2 rounded bg-amber-50 border border-amber-200">
          <div className="text-lg font-bold text-amber-700">{callStats.callback}</div>
          <div className="text-[10px] text-gray-600">Callback</div>
        </div>
      </div>

      {callStats.notPickedStreak >= 2 && (
        <div className="text-xs bg-amber-50 border border-amber-300 rounded p-2 mb-3 text-amber-800">
          ⚠ <b>{callStats.notPickedStreak} not-picked in a row</b> — try a different time slot or WhatsApp first
        </div>
      )}

      {/* Chronological log — date · agent · outcome · remark.
          Max-height + scroll keeps the card from pushing the rest of the page down
          when there are 50+ entries. Consecutive no-answer attempts by the same
          agent collapse into a single grouped row (Lalit's request — wall of
          "Not picked" lines was hard to scan past). */}
      <div className="space-y-2 text-sm max-h-[480px] overflow-y-auto pr-1">
        {callLogs.length === 0 && (
          <div className="text-gray-500 text-xs text-center py-4">
            No calls logged yet. Use the 📝 Log Call button above to record the first one.
          </div>
        )}
        {groupCalls(callLogs).map((g, idx) => {
          if (g.kind === "no-answer-streak") {
            const sameDay = g.firstAt.toDateString() === g.lastAt.toDateString();
            const range = sameDay
              ? `${fmtISTDate(g.firstAt)}`
              : `${fmtISTDate(g.firstAt)} → ${fmtISTDate(g.lastAt)}`;
            return (
              <details key={`grp-${idx}`} className="border-l-2 border-amber-300 pl-3 py-1.5 group">
                <summary className="cursor-pointer list-none">
                  <div className="text-[11px] text-gray-500">
                    <b>{g.displayName}</b> · {range} IST
                  </div>
                  <div className="text-xs font-semibold mt-0.5 text-amber-800">
                    📵 Not picked × {g.attempts.length}
                    <span className="text-[10px] text-gray-500 font-normal ml-1.5 group-open:hidden">— click to expand</span>
                    <span className="text-[10px] text-gray-500 font-normal ml-1.5 hidden group-open:inline">— click to collapse</span>
                  </div>
                </summary>
                <div className="mt-2 space-y-1.5 pl-2 border-l border-amber-200">
                  {g.attempts.map((c) => {
                    const notesClean = c.notes
                      ? c.notes.replace(new RegExp(`^${g.displayName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*:\\s*`, "i"), "")
                      : null;
                    return (
                      <div key={c.id} className="text-[11px]">
                        <span className="text-gray-500">{fmtIST12Paren(c.startedAt)} IST</span>
                        <span className="ml-2 font-semibold">{c.outcome.replaceAll("_", " ")}</span>
                        {notesClean && <div className="text-xs text-gray-700 whitespace-pre-wrap mt-0.5">{notesClean}</div>}
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          }
          // Single entry
          const c = g.call;
          const displayName = c.attributedAgentName ?? c.user?.name ?? "Unknown Agent";
          const notesClean = c.notes
            ? c.notes.replace(/^[A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2}\s*:\s*/, "")
            : null;
          return (
            <div key={c.id} className="border-l-2 border-[#e5e7eb] pl-3 py-1.5">
              <div className="text-[11px] text-gray-500">
                <b>{displayName}</b> · {fmtIST12Paren(c.startedAt)} IST
                {c.durationSec ? ` · ${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : ""}
                {c.ivrProvider && <span className="ml-1 chip src text-[9px]">{c.ivrProvider}</span>}
              </div>
              <div className="text-xs font-semibold mt-0.5">{c.outcome.replaceAll("_", " ")}</div>
              {notesClean && <div className="text-xs mt-1 text-gray-700 whitespace-pre-wrap">{notesClean}</div>}
              {c.recordingUrl && (
                <div className="mt-1.5">
                  {/* Streams through the scope-checked proxy (no raw provider URL) + download. */}
                  <CallRecordingPlayer callId={c.id} compact />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
