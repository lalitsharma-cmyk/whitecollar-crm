// Admin AI Assistant — EXECUTE an approved PREVIEW run. Applies the change and
// records each lead's before-value so the run is fully reversible.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { executeRun } from "@/lib/adminAssistant/engine";
import { audit, reqMeta } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const runId = String(body.runId ?? "");
  if (!runId) return NextResponse.json({ error: "Missing runId" }, { status: 400 });

  const result = await executeRun(runId, me.id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 409 });

  await audit({ userId: me.id, action: "assistant.execute", entity: "AssistantRun", entityId: runId, meta: { affected: result.affected }, request: reqMeta(req) }).catch(() => {});
  return NextResponse.json({ ok: true, affected: result.affected });
}
