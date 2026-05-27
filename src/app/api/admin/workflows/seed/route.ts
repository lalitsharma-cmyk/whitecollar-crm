// Bulk-seed all starter workflows from src/lib/workflowTemplates.ts.
// Admin only. Skips templates whose name already exists.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { WorkflowTrigger, WorkflowActionType } from "@prisma/client";
import { WORKFLOW_TEMPLATES } from "@/lib/workflowTemplates";

export const dynamic = "force-dynamic";

export async function POST() {
  const me = await requireRole("ADMIN");

  // Figure out which template names already exist so we can skip them.
  const names = WORKFLOW_TEMPLATES.map((t) => t.name);
  const existing = await prisma.workflow.findMany({
    where: { name: { in: names } },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((w) => w.name));

  const toCreate = WORKFLOW_TEMPLATES.filter((t) => !existingNames.has(t.name));
  const skippedNames = WORKFLOW_TEMPLATES
    .filter((t) => existingNames.has(t.name))
    .map((t) => t.name);

  // Validate enums up-front so we either commit everything or nothing.
  for (const t of toCreate) {
    if (!(Object.values(WorkflowTrigger) as string[]).includes(t.trigger)) {
      return NextResponse.json(
        { error: `Invalid trigger in template "${t.name}": ${t.trigger}` },
        { status: 400 },
      );
    }
    for (const a of t.actions) {
      if (!(Object.values(WorkflowActionType) as string[]).includes(a.type)) {
        return NextResponse.json(
          { error: `Invalid action type in template "${t.name}": ${a.type}` },
          { status: 400 },
        );
      }
    }
  }

  // Single transaction so the seeding either fully succeeds or fully rolls back.
  const createdNames: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const t of toCreate) {
      await tx.workflow.create({
        data: {
          name: t.name,
          description: t.description ?? null,
          trigger: t.trigger as WorkflowTrigger,
          triggerConfig: t.triggerConfig ? JSON.stringify(t.triggerConfig) : null,
          filterQuery: t.filterQuery ?? null,
          createdById: me.id,
          actions: {
            create: t.actions.map((a, i) => ({
              type: a.type as WorkflowActionType,
              sequenceOrder: i,
              delayMinutes: Math.max(0, Number(a.delayMinutes ?? 0)),
              config: JSON.stringify(a.config ?? {}),
            })),
          },
        },
      });
      createdNames.push(t.name);
    }
  });

  return NextResponse.json({
    ok: true,
    created: createdNames.length,
    skipped: skippedNames.length,
    names: { created: createdNames, skipped: skippedNames },
  });
}
