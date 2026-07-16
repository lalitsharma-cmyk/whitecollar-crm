// /api/admin/routing-rules/[id] — ADMIN-only.
//   PATCH  → update a rule (per-recipient assigned counters are carried over,
//            never reset by an edit). Writes a RoutingRuleVersion "updated".
//   DELETE → SOFT delete: active=false + disabledAt + a "deleted" version row.
//            The row (and its full history) is preserved; a deleted rule can
//            never fire and is hidden from the default list.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit, reqMeta } from "@/lib/audit";
import type { Prisma } from "@prisma/client";
import { requireRoutingAdmin, parseRuleBody, carryAssignedCounts, serializeRule, writeRuleVersion } from "../shared";

async function loadRule(id: string) {
  return prisma.routingRule.findUnique({
    where: { id },
    include: { versions: { orderBy: { changedAt: "desc" }, take: 1, select: { action: true } } },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;
  const me = g.me;
  const { id } = await params;

  const rule = await loadRule(id);
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  if (rule.versions[0]?.action === "deleted") {
    return NextResponse.json({ error: "This rule was deleted — create a new rule instead." }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = await parseRuleBody(body, { existing: rule });
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = parsed.rule;

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.routingRule.update({
      where: { id },
      data: {
        name: r.name,
        priority: r.priority,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        scope: r.scope as unknown as Prisma.InputJsonValue,
        recipients: carryAssignedCounts(r.recipients, rule.recipients) as unknown as Prisma.InputJsonValue,
        strategy: r.strategy,
        updatedById: me.id,
      },
    });
    await writeRuleVersion(tx, next, "updated", me.id);
    return next;
  });

  await audit({
    userId: me.id,
    action: "routing.rule.update",
    entity: "RoutingRule",
    entityId: id,
    meta: { name: updated.name, priority: updated.priority, strategy: updated.strategy },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, rule: serializeRule(updated) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;
  const me = g.me;
  const { id } = await params;

  const rule = await loadRule(id);
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  if (rule.versions[0]?.action === "deleted") {
    return NextResponse.json({ error: "Already deleted." }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    const next = await tx.routingRule.update({
      where: { id },
      data: { active: false, disabledAt: rule.disabledAt ?? new Date(), updatedById: me.id },
    });
    await writeRuleVersion(tx, next, "deleted", me.id);
  });

  await audit({
    userId: me.id,
    action: "routing.rule.delete",
    entity: "RoutingRule",
    entityId: id,
    meta: { name: rule.name },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true });
}
