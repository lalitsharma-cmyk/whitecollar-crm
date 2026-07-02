import "server-only";
// Sync engine — reconciles calls the provider has but we never received a webhook
// for (webhook drops, downtime). Pulls recent calls from the provider API and
// funnels each through the same idempotent sink (recordCallEvent), so re-seeing a
// call we already have is a no-op. Belt-and-suspenders behind the webhook.
import { prisma } from "@/lib/prisma";
import { telephonyListRecent, telephonyEnabled } from "./client";
import { recordCallEvent } from "./recordCall";
import { activeProvider } from "./config";

/** Sync calls from the last `windowMinutes` (default 6h). Idempotent + safe to run
 *  on a schedule. Returns a summary for the cron log / admin console. */
export async function syncRecentCalls(windowMinutes = 360): Promise<{ enabled: boolean; pulled: number; created: number; updated: number }> {
  if (!telephonyEnabled()) return { enabled: false, pulled: 0, created: 0, updated: 0 };
  const sinceISO = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const events = await telephonyListRecent(sinceISO);

  let created = 0, updated = 0;
  for (const ev of events) {
    try {
      const r = await recordCallEvent(ev);
      r.created ? created++ : updated++;
    } catch {
      // Persist a retry task rather than failing the whole sync.
      const { enqueue } = await import("./retryQueue");
      await enqueue("SYNC", activeProvider(), ev.providerCallId, ev as unknown).catch(() => {});
    }
  }

  // Housekeeping: expire DONE tasks older than 7d so the queue stays small.
  await prisma.callSyncTask.deleteMany({
    where: { status: "DONE", updatedAt: { lt: new Date(Date.now() - 7 * 864e5) } },
  }).catch(() => {});

  return { enabled: true, pulled: events.length, created, updated };
}
