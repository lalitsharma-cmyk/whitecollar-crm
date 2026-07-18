import type { CallLog } from "@prisma/client";
import { isPendingCall } from "@/lib/ghosting";

export interface CallStats {
  total: number;
  connected: number;
  notPicked: number;
  callback: number;
  other: number;
  lastCallAt: Date | null;
  lastConnectedAt: Date | null;
  todayDialed: number;
  todayConnected: number;
  notPickedStreak: number;  // consecutive recent not-picked attempts (without an interleaved connect)
}

export function aggregateCalls(calls: CallLog[]): CallStats {
  // Only REAL, agent-logged calls count toward statistics. Imported MIS remarks
  // were historically stored as synthetic CallLog rows (attributedAgentName set);
  // they are Historical Notes, never dialled calls, and must never move the
  // connected / no-answer / last-outcome / today counters.
  //
  // PENDING dials are dropped for the same reason (Lalit P0, 2026-07-18): a
  // CallLog row is written the INSTANT the agent taps Call, carrying INITIATED /
  // RINGING before any result exists, and the SAME row is later transitioned to a
  // terminal outcome (one dial = one row). Counting the tap would inflate `total`
  // ("Dialed"), `todayDialed`, `other` (pending falls through to the else-branch
  // below) and would let an abandoned tap set `lastCallAt` — a tap is not a call.
  // Filtering ONCE here guards every field this function returns; the connected /
  // notPicked / callback counters match outcomes explicitly and were already
  // immune, and notPickedStreak is unaffected (a pending row hit the else-branch,
  // which neither counts nor breaks the streak).
  calls = calls.filter((c) => c.attributedAgentName == null && !isPendingCall(c.outcome));

  const stats: CallStats = {
    total: calls.length, connected: 0, notPicked: 0, callback: 0, other: 0,
    lastCallAt: null, lastConnectedAt: null,
    todayDialed: 0, todayConnected: 0,
    notPickedStreak: 0,
  };
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

  // calls expected newest-first OR oldest-first — sort defensively newest-first
  const sorted = [...calls].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  let streakBroken = false;

  for (const c of sorted) {
    if (!stats.lastCallAt) stats.lastCallAt = c.startedAt;
    if (c.startedAt >= startOfDay) stats.todayDialed++;

    if (c.outcome === "CONNECTED" || c.outcome === "INTERESTED") {
      stats.connected++;
      if (!stats.lastConnectedAt) stats.lastConnectedAt = c.startedAt;
      if (c.startedAt >= startOfDay) stats.todayConnected++;
      streakBroken = true;
    } else if (c.outcome === "NOT_PICKED" || c.outcome === "SWITCHED_OFF" || c.outcome === "BUSY") {
      stats.notPicked++;
      if (!streakBroken) stats.notPickedStreak++;
    } else if (c.outcome === "CALLBACK") {
      stats.callback++;
    } else {
      stats.other++;
    }
  }
  return stats;
}

export function callBreakdownString(s: CallStats): string {
  const parts: string[] = [];
  parts.push(`${s.total} dialed`);
  parts.push(`${s.connected} connected`);
  if (s.notPicked > 0) parts.push(`${s.notPicked} not picked`);
  if (s.callback > 0) parts.push(`${s.callback} callback`);
  return parts.join(" · ");
}
