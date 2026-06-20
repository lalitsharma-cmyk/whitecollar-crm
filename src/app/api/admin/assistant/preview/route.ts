// Admin AI Assistant — PREVIEW (read-only). Parses the command, computes the
// affected leads + the proposed change, and saves a PREVIEW run the admin can
// approve. NOTHING is written to leads here.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { parseCommand } from "@/lib/adminAssistant/parse";
import { previewParsed } from "@/lib/adminAssistant/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const command = String(body.command ?? "").trim();
  if (!command) return NextResponse.json({ error: "Empty command" }, { status: 400 });
  if (command.length > 500) return NextResponse.json({ error: "Command too long" }, { status: 400 });

  const parsed = parseCommand(command);
  const preview = await previewParsed(parsed);

  // Only actionable, in-scope mutations get a saved run (something to execute).
  let runId: string | null = null;
  if (preview.ok && !preview.readOnly && preview.field) {
    const run = await prisma.assistantRun.create({
      data: {
        command,
        intent: preview.intent,
        field: preview.field,
        parsed: parsed as object,
        status: "PREVIEW",
        affectedCount: preview.count,
        affectedIds: preview.affectedIds,
        newValue: preview.newValueRaw ?? null,
        createdById: me.id,
      },
      select: { id: true },
    });
    runId = run.id;
  }

  return NextResponse.json({
    ok: preview.ok,
    runId,
    intent: preview.intent,
    explanation: preview.explanation,
    error: preview.error ?? null,
    field: preview.field ?? null,
    newValueLabel: preview.newValueLabel ?? null,
    count: preview.count,
    sample: preview.sample,
    readOnly: preview.readOnly,
    agentCandidates: preview.agentCandidates ?? null,
  });
}
