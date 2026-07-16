// /api/admin/routing-rules — ADMIN-only CRUD for the Lead Routing Scheduler.
//   GET  → list rules (+computed status Active/Scheduled/Expired/Disabled/Deleted
//          + assignedCount). ?includeDeleted=1 also returns soft-deleted rules.
//   POST → create a rule. Every mutation writes a RoutingRuleVersion row.
// No cron anywhere: status is computed from startsAt/endsAt at read time.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit, reqMeta } from "@/lib/audit";
import { isRoutingPaused } from "@/lib/leadRouting";
import type { Prisma } from "@prisma/client";
import { requireRoutingAdmin, parseRuleBody, carryAssignedCounts, serializeRule, writeRuleVersion } from "./shared";

export async function GET(req: NextRequest) {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;

  const includeDeleted = req.nextUrl.searchParams.get("includeDeleted") === "1";
  const [rules, paused] = await Promise.all([
    prisma.routingRule.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      include: {
        createdBy: { select: { name: true } },
        versions: { orderBy: { changedAt: "desc" }, take: 1, select: { action: true } },
      },
    }),
    isRoutingPaused(),
  ]);

  const now = new Date();
  const serialized = rules.map((r) => serializeRule(r, now)).filter((r) => includeDeleted || !r.deleted);
  return NextResponse.json({ ok: true, paused, rules: serialized });
}

export async function POST(req: NextRequest) {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;
  const me = g.me;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = await parseRuleBody(body, { existing: null });
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = parsed.rule;

  const created = await prisma.$transaction(async (tx) => {
    const rule = await tx.routingRule.create({
      data: {
        name: r.name,
        priority: r.priority,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        scope: r.scope as unknown as Prisma.InputJsonValue,
        // Fresh rule → per-recipient assigned counters start at 0.
        recipients: carryAssignedCounts(r.recipients, null) as unknown as Prisma.InputJsonValue,
        strategy: r.strategy,
        createdById: me.id,
      },
    });
    await writeRuleVersion(tx, rule, "created", me.id);
    return rule;
  });

  await audit({
    userId: me.id,
    action: "routing.rule.create",
    entity: "RoutingRule",
    entityId: created.id,
    meta: { name: created.name, priority: created.priority, strategy: created.strategy },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, rule: serializeRule(created) });
}
