import type { CallLog } from "@prisma/client";

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
