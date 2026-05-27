// Toggle active / rename / replace conditions / replace actions / delete a workflow.
// Admin only. Editing actions = delete + recreate inside one transaction.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { WorkflowActionType, WorkflowTrigger } from "@prisma/client";

interface ActionPayload {
  type: WorkflowActionType;
  sequenceOrder?: number;
  delayMinutes?: number;
  config?: Record<string, unknown>;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.name === "string") data.name = body.name.trim().slice(0, 120);
  if (typeof body.description === "string") data.description = body.description.trim() || null;
  if (typeof body.trigger === "string") {
    if (!(Object.values(WorkflowTrigger) as string[]).includes(body.trigger)) {
      return NextResponse.json({ error: "Invalid trigger" }, { status: 400 });
    }
    data.trigger = body.trigger;
  }
  // "conditions" is the spec's name for the optional IF clause. The schema
  // stores it as a filterQuery string (used by leadMatchesQuery in the engine).
  if (body.conditions !== undefined) {
    data.filterQuery = body.conditions ? String(body.conditions) : null;
  } else if (body.filterQuery !== undefined) {
    data.filterQuery = body.filterQuery ? String(body.filterQuery) : null;
  }
  if (body.triggerConfig !== undefined) {
    data.triggerConfig = body.triggerConfig ? JSON.stringify(body.triggerConfig) : null;
  }

  const replaceActions = Array.isArray(body.actions);
  if (replaceActions) {
    for (const a of body.actions as ActionPayload[]) {
      if (!(Object.values(WorkflowActionType) as string[]).includes(a.type)) {
        return NextResponse.json({ error: `Invalid action type: ${a.type}` }, { status: 400 });
      }
    }
  }

  if (Object.keys(data).length === 0 && !replaceActions) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.workflow.update({ where: { id }, data });
    }
    if (replaceActions) {
      await tx.workflowAction.deleteMany({ where: { workflowId: id } });
      const incoming = body.actions as ActionPayload[];
      if (incoming.length > 0) {
        await tx.workflowAction.createMany({
          data: incoming.map((a, i) => ({
            workflowId: id,
            type: a.type,
            sequenceOrder: a.sequenceOrder ?? i,
            delayMinutes: Math.max(0, Number(a.delayMinutes ?? 0)),
            config: JSON.stringify(a.config ?? {}),
          })),
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  // Cascade via Prisma onDelete: Cascade on WorkflowAction + WorkflowRun
  await prisma.workflow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
