import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { revertOperation } from "@/lib/operationLog";

// ── Revert a structural operation — ADMIN / Super-Admin ONLY ─────────────────
// Restores every affected record to the before-state captured when the op ran.
// Managers + agents get 403. Writes an audit row (who reverted, which op, count).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (me.role !== "ADMIN") {
    return NextResponse.json({ error: "Only an admin can revert operations." }, { status: 403 });
  }
  const { id } = await params;
  const res = await revertOperation(id, me.id);
  if (!res.ok) return NextResponse.json({ error: res.error ?? "Revert failed." }, { status: 400 });
  await audit({
    userId: me.id, action: "operation.revert", entity: "OperationLog", entityId: id,
    meta: { restored: res.restored }, request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, restored: res.restored });
}
