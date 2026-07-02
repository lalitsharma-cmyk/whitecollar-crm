import "server-only";
// Durable telephony retry queue (CallSyncTask). At-least-once processing for work
// that can transiently fail. Drained by /api/telephony/retry (cron heartbeat).
import { prisma } from "@/lib/prisma";
import type { NormalizedCallEvent } from "./types";
import { recordCallEvent } from "./recordCall";

export type TaskKind = "WEBHOOK" | "CLICK_TO_CALL" | "SYNC";

/** Exponential backoff: 1m, 2m, 4m, 8m, 16m, 32m … capped at ~1h. */
function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** attempts, 60 * 60_000);
}

export async function enqueue(kind: TaskKind, provider: string, refId: string | null, payload: unknown, maxAttempts = 6): Promise<void> {
  await prisma.callSyncTask.create({
    data: { kind, provider, refId, payload: payload as object, maxAttempts, status: "PENDING" },
  });
}

/** Process due PENDING tasks. Returns a small summary for the console/cron log. */
export async function processQueue(limit = 25): Promise<{ processed: number; done: number; failed: number; retried: number }> {
  const now = new Date();
  const due = await prisma.callSyncTask.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });

  let done = 0, failed = 0, retried = 0;
  for (const task of due) {
    try {
      await runTask(task.kind, task.payload);
      await prisma.callSyncTask.update({ where: { id: task.id }, data: { status: "DONE", attempts: { increment: 1 }, lastError: null } });
      done++;
    } catch (e) {
      const attempts = task.attempts + 1;
      const giveUp = attempts >= task.maxAttempts;
      await prisma.callSyncTask.update({
        where: { id: task.id },
        data: {
          attempts, lastError: String(e).slice(0, 500),
          status: giveUp ? "FAILED" : "PENDING",
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        },
      });
      giveUp ? failed++ : retried++;
    }
  }
  return { processed: due.length, done, failed, retried };
}

/** Execute one queued job by kind. WEBHOOK/SYNC replay a normalized event. */
async function runTask(kind: string, payload: unknown): Promise<void> {
  if (kind === "WEBHOOK" || kind === "SYNC") {
    const ev = reviveEvent(payload as Record<string, unknown>);
    await recordCallEvent(ev);
    return;
  }
  if (kind === "CLICK_TO_CALL") {
    const { telephonyClickToCall } = await import("./client");
    const p = payload as { agentExt: string; destinationNumber: string; customIdentifier?: string };
    const r = await telephonyClickToCall(p);
    if (!r.ok) throw new Error(r.message);
    return;
  }
  throw new Error(`Unknown task kind: ${kind}`);
}

/** JSON round-trips Dates to strings — revive them back to a NormalizedCallEvent. */
function reviveEvent(p: Record<string, unknown>): NormalizedCallEvent {
  const d = (v: unknown) => (v ? new Date(String(v)) : null);
  return {
    provider: String(p.provider ?? ""),
    providerCallId: String(p.providerCallId ?? ""),
    accountId: (p.accountId as string) ?? null,
    direction: p.direction === "inbound" ? "inbound" : "outbound",
    otherNumber: (p.otherNumber as string) ?? null,
    agentExt: (p.agentExt as string) ?? null,
    status: (p.status as string) ?? null,
    startedAt: d(p.startedAt),
    endedAt: d(p.endedAt),
    durationSec: (p.durationSec as number) ?? null,
    recordingUrl: (p.recordingUrl as string) ?? null,
    customIdentifier: (p.customIdentifier as string) ?? null,
    eventType: (p.eventType as string) ?? null,
  };
}
