// List + create Workflows. Admin only.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { WorkflowTrigger, WorkflowActionType } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireRole("ADMIN", "MANAGER");
  const items = await prisma.workflow.findMany({
    include: { actions: { orderBy: { sequenceOrder: "asc" } }, _count: { select: { runs: true } } },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ items });
}

interface ActionPayload {
  type: WorkflowActionType;
  sequenceOrder?: number;
  delayMinutes?: number;
  config?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 120);
  const description = body.description ? String(body.description).trim() : null;
  const trigger = String(body.trigger ?? "");
  const triggerConfig = body.triggerConfig ? JSON.stringify(body.triggerConfig) : null;
  // "conditions" is the spec name for IF clauses; persisted as filterQuery.
  const filterQuery = body.conditions
    ? String(body.conditions)
    : body.filterQuery
      ? String(body.filterQuery)
      : null;
  const actions: ActionPayload[] = Array.isArray(body.actions) ? body.actions : [];

  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!(Object.values(WorkflowTrigger) as string[]).includes(trigger)) {
    return NextResponse.json({ error: "Invalid trigger" }, { status: 400 });
  }
  if (actions.length === 0) return NextResponse.json({ error: "At least one action required" }, { status: 400 });
  for (const a of actions) {
    if (!(Object.values(WorkflowActionType) as string[]).includes(a.type)) {
      return NextResponse.json({ error: `Invalid action type: ${a.type}` }, { status: 400 });
    }
  }

  // Create workflow + child actions in one transaction (Prisma nested create
  // already runs as a single transaction, so this is atomic).
  const wf = await prisma.workflow.create({
    data: {
      name, description,
      trigger: trigger as WorkflowTrigger,
      triggerConfig, filterQuery,
      createdById: me.id,
      actions: {
        create: actions.map((a, i) => ({
          type: a.type as WorkflowActionType,
          sequenceOrder: a.sequenceOrder ?? i,
          delayMinutes: Math.max(0, Number(a.delayMinutes ?? 0)),
          config: JSON.stringify(a.config ?? {}),
        })),
      },
    },
    include: { actions: true },
  });
  return NextResponse.json({ ok: true, id: wf.id });
}
