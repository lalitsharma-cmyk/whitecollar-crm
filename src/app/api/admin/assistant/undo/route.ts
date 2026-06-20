// Admin AI Assistant — UNDO an executed run. Restores every captured
// before-value exactly.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { undoRun } from "@/lib/adminAssistant/engine";
import { audit, reqMeta } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const runId = String(body.runId ?? "");
  if (!runId) return NextResponse.json({ error: "Missing runId" }, { status: 400 });

  const result = await undoRun(runId, me.id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 409 });

  await audit({ userId: me.id, action: "assistant.undo", entity: "AssistantRun", entityId: runId, meta: { restored: result.restored }, request: reqMeta(req) }).catch(() => {});
  return NextResponse.json({ ok: true, restored: result.restored });
}
