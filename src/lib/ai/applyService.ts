import "server-only";
// AI Sales OS — apply IO wrapper (M4). Executes a SINGLE approved, reversible,
// whitelisted mutation and records it to the existing immutable AuditLog so it can
// be reviewed and reversed. No new schema table — the audit row carries the full
// before/after, which is all an undo needs.
//
// Safety chain (every apply passes ALL of these):
//   1. planApply()  — reversible + whitelisted field + non-empty + not a no-op
//   2. optimistic before-check — current DB value must still equal mutation.from
//      (someone edited it since detection → we abort, never clobber)
//   3. AuditLog write — action "ai.apply", actor, entity, {field, from, to}
// The caller (route) additionally enforces ADMIN + ai.enabled.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { planApply, describeApply } from "./apply";
import type { AiMutation } from "./types";

/** IP/UA carrier — matches AuditEntry["request"] (no exported alias upstream). */
type ReqMeta = { ip?: string | null; userAgent?: string | null };

export type ApplyOutcome =
  | { applied: true; description: string }
  | { applied: false; reason: string };

/** Apply one approved AI mutation. Returns applied:false (never throws) for
 *  business rejections so the route can surface them as 4xx cleanly. */
export async function applyMutation(
  mutation: AiMutation,
  actorId: string,
  request?: ReqMeta,
): Promise<ApplyOutcome> {
  const planned = planApply(mutation);
  if (!planned.ok) return { applied: false, reason: planned.reason };

  // Only Lead is wired today (the whitelist enforces this too, but be explicit).
  if (mutation.entity !== "Lead") return { applied: false, reason: "only Lead applies are supported" };

  const field = mutation.field;
  const current = await prisma.lead.findUnique({
    where: { id: mutation.entityId },
    select: { id: true, [field]: true } as { id: true },
  });
  if (!current) return { applied: false, reason: "record not found" };

  // Optimistic concurrency: only apply if the value the AI observed is still there.
  const now = (current as Record<string, unknown>)[field] ?? null;
  const from = mutation.from ?? null;
  if (now !== from) {
    return { applied: false, reason: `value changed since detection (now ${JSON.stringify(now)}), not applied` };
  }

  await prisma.lead.update({
    where: { id: mutation.entityId },
    data: { [field]: mutation.to } as Record<string, unknown>,
  });

  await audit({
    userId: actorId,
    action: "ai.apply",
    entity: mutation.entity,
    entityId: mutation.entityId,
    meta: { field, from: mutation.from, to: mutation.to, reversible: true },
    request,
  });

  return { applied: true, description: describeApply(mutation) };
}
