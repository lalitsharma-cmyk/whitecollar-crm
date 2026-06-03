import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * PATCH /api/admin/unmatched-mentions/[id]
 * Admin/manager resolves or ignores an unmatched mention.
 *
 * Body: { action: "link" | "ignore", projectId?: string }
 *
 * action === "link"   — links the mention to a project, marks it resolved,
 *                       and upserts a LeadProject entry.
 * action === "ignore" — marks the mention as resolved + ignored.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const me = await requireUser();
  if (me.role !== "ADMIN" && me.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;

  if (action !== "link" && action !== "ignore") {
    return NextResponse.json(
      { error: 'action must be "link" or "ignore"' },
      { status: 400 }
    );
  }

  // Fetch the mention so we have leadId and can validate ownership
  const mention = await prisma.unmatchedMention.findUnique({
    where: { id },
  });

  if (!mention) {
    return NextResponse.json(
      { error: "Unmatched mention not found" },
      { status: 404 }
    );
  }

  if (action === "link") {
    const projectId = String(body.projectId ?? "").trim();

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required when action is link" },
        { status: 400 }
      );
    }

    // Verify the project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Mark mention as resolved and record the linked project
    await prisma.unmatchedMention.update({
      where: { id },
      data: { resolved: true, resolvedProjectId: projectId },
    });

    // Upsert a LeadProject entry to formalise the link
    await prisma.leadProject.upsert({
      where: {
        leadId_projectId: {
          leadId: mention.leadId,
          projectId,
        },
      },
      update: {
        // Preserve any existing manual data; only back-fill if missing
        sourceType: "REMARK",
        autoDetected: true,
        sourceDate: mention.sourceDate,
        sourceText: mention.sourceText,
      },
      create: {
        leadId: mention.leadId,
        projectId,
        status: "DISCUSSED",
        autoDetected: true,
        sourceType: "REMARK",
        sourceDate: mention.sourceDate,
        sourceText: mention.sourceText,
      },
    });
  } else {
    // action === "ignore"
    await prisma.unmatchedMention.update({
      where: { id },
      data: { resolved: true, resolvedIgnored: true },
    });
  }

  return NextResponse.json({ ok: true });
}
