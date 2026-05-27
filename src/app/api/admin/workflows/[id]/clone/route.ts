// Clone a workflow as a paused copy. Admin only.
//
// Duplicates the source workflow row + all of its WorkflowAction children in
// one transaction. The clone is created with active=false so the admin must
// explicitly enable it — prevents accidental double-firing of the same
// automation against the same leads.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole("ADMIN");
  const { id } = await params;

  const source = await prisma.workflow.findUnique({
    where: { id },
    include: { actions: true },
  });
  if (!source) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const newId = await prisma.$transaction(async (tx) => {
    const created = await tx.workflow.create({
      data: {
        name: `${source.name} (copy)`,
        description: source.description,
        trigger: source.trigger,
        triggerConfig: source.triggerConfig,
        filterQuery: source.filterQuery,
        active: false,
      },
    });
    if (source.actions.length > 0) {
      await tx.workflowAction.createMany({
        data: source.actions.map((a) => ({
          workflowId: created.id,
          type: a.type,
          sequenceOrder: a.sequenceOrder,
          delayMinutes: a.delayMinutes,
          config: a.config,
        })),
      });
    }
    return created.id;
  });

  return NextResponse.json({ ok: true, newId });
}
