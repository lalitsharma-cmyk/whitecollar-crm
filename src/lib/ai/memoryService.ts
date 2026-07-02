import "server-only";
// AI Sales OS — entity memory IO wrapper (M6), READ-ONLY. Pulls a lead's recent real
// activity (calls, notes/remarks, status changes) plus any PRIOR AI decisions from the
// AuditLog, and compacts them via the pure core. This is the "what do we already know
// about this client" the Reason layer carries. Never writes.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { prisma } from "@/lib/prisma";
import { compactMemory, type MemoryEvent, type EntityMemory } from "./memory";

export async function buildLeadMemory(leadId: string, cap = 8): Promise<EntityMemory> {
  const [calls, notes, history, ai] = await Promise.all([
    prisma.callLog.findMany({
      where: { leadId },
      select: { outcome: true, notes: true, startedAt: true, direction: true },
      orderBy: { startedAt: "desc" }, take: 20,
    }),
    prisma.note.findMany({
      where: { leadId },
      select: { body: true, createdAt: true },
      orderBy: { createdAt: "desc" }, take: 20,
    }),
    prisma.leadFieldHistory.findMany({
      where: { leadId, field: "currentStatus" },
      select: { oldValue: true, newValue: true, changedAt: true },
      orderBy: { changedAt: "desc" }, take: 20,
    }),
    prisma.auditLog.findMany({
      where: { entity: "Lead", entityId: leadId, action: { startsWith: "ai." } },
      select: { action: true, meta: true, createdAt: true },
      orderBy: { createdAt: "desc" }, take: 20,
    }),
  ]);

  const events: MemoryEvent[] = [
    ...calls.map((c) => ({
      at: c.startedAt.toISOString(),
      kind: "call" as const,
      summary: `${c.direction} call — ${c.outcome}${c.notes ? `: ${c.notes.slice(0, 120)}` : ""}`,
    })),
    ...notes.map((n) => ({ at: n.createdAt.toISOString(), kind: "remark" as const, summary: n.body.slice(0, 160) })),
    ...history.map((h) => ({
      at: h.changedAt.toISOString(),
      kind: "status" as const,
      summary: `Status ${h.oldValue ?? "?"} → ${h.newValue ?? "?"}`,
    })),
    ...ai.map((a) => ({
      at: a.createdAt.toISOString(),
      kind: "ai_decision" as const,
      summary: `${a.action}${a.meta ? ` ${a.meta.slice(0, 100)}` : ""}`,
    })),
  ];

  return compactMemory(leadId, events, cap);
}
