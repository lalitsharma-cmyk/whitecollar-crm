// GET /api/admin/routing-rules/[id]/versions — ADMIN-only. The per-rule history
// timeline: every created/updated/disabled/enabled/deleted mutation with its
// full snapshot + who did it + when. Backs the History drawer.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoutingAdmin } from "../../shared";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;
  const { id } = await params;

  const rule = await prisma.routingRule.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  const versions = await prisma.routingRuleVersion.findMany({
    where: { ruleId: id },
    orderBy: { changedAt: "desc" },
    take: 100,
  });

  // changedById → name (RoutingRuleVersion has no relation on purpose — resolve here).
  const actorIds = [...new Set(versions.map((v) => v.changedById))];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const nameOf = new Map(actors.map((a) => [a.id, a.name] as const));

  return NextResponse.json({
    ok: true,
    ruleName: rule.name,
    versions: versions.map((v) => ({
      id: v.id,
      action: v.action,
      snapshot: v.snapshot,
      changedByName: nameOf.get(v.changedById) ?? "Unknown",
      changedAt: v.changedAt.toISOString(),
    })),
  });
}
