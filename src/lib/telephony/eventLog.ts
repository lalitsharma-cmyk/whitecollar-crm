import "server-only";
// Verbatim inbound-webhook audit (CallEvent). Every webhook is logged BEFORE
// processing so a call is never lost even if linking throws, and any event can be
// replayed from the admin console.
import { prisma } from "@/lib/prisma";
import type { NormalizedCallEvent } from "./types";

/** Log the raw webhook (query + body merged) before parsing/processing. */
export async function logRawEvent(provider: string, raw: Record<string, unknown>, parsed: NormalizedCallEvent | null): Promise<string> {
  const row = await prisma.callEvent.create({
    data: {
      provider,
      providerCallId: parsed?.providerCallId ?? null,
      direction: parsed?.direction ?? null,
      eventType: parsed?.eventType ?? null,
      accountId: parsed?.accountId ?? null,
      rawPayload: raw as object,
    },
  });
  return row.id;
}

/** Mark a logged event processed (or record its processing error). */
export async function markEventProcessed(eventId: string, callLogId: string | null, error: string | null): Promise<void> {
  await prisma.callEvent.update({
    where: { id: eventId },
    data: { processed: !error, callLogId: callLogId ?? undefined, error: error ?? null },
  }).catch(() => {});
}
