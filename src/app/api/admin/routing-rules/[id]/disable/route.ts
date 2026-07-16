// POST /api/admin/routing-rules/[id]/disable — ADMIN-only. Turn a rule OFF
// (active=false + disabledAt). Reversible via /enable. Writes a "disabled"
// RoutingRuleVersion row.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit, reqMeta } from "@/lib/audit";
import { requireRoutingAdmin, serializeRule, writeRuleVersion } from "../../shared";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;
  const me = g.me;
  const { id } = await params;

  const rule = await prisma.routingRule.findUnique({
    where: { id },
    include: { versions: { orderBy: { changedAt: "desc" }, take: 1, select: { action: true } } },
  });
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  if (rule.versions[0]?.action === "deleted") {
    return NextResponse.json({ error: "This rule was deleted." }, { status: 409 });
  }
  if (!rule.active || rule.disabledAt) {
    return NextResponse.json({ error: "Rule is already disabled." }, { status: 409 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.routingRule.update({
      where: { id },
      data: { active: false, disabledAt: new Date(), updatedById: me.id },
    });
    await writeRuleVersion(tx, next, "disabled", me.id);
    return next;
  });

  await audit({
    userId: me.id,
    action: "routing.rule.disable",
    entity: "RoutingRule",
    entityId: id,
    meta: { name: rule.name },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, rule: serializeRule(updated) });
}
