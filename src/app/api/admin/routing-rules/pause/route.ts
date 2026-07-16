// /api/admin/routing-rules/pause — the GLOBAL "⏸ Pause Automatic Assignment"
// emergency override (ADMIN-only). Backed by the "routingPause" Setting so it
// takes effect on the very next lead (read at assign time — no cron, no cache).
//
// While paused, EVERY auto-assign choke point leaves new records UNASSIGNED
// ("all leads remain unassigned until manually distributed"). Manual assignment
// is never affected.
//   GET    → { paused }
//   POST   → pause  (audited)
//   DELETE → resume (audited)
import { NextResponse, type NextRequest } from "next/server";
import { audit, reqMeta } from "@/lib/audit";
import { isRoutingPaused, setRoutingPaused } from "@/lib/leadRouting";
import { requireRoutingAdmin } from "../shared";

export async function GET() {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;
  return NextResponse.json({ ok: true, paused: await isRoutingPaused() });
}

export async function POST(req: NextRequest) {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;
  const me = g.me;

  await setRoutingPaused(true);
  await audit({
    userId: me.id,
    action: "routing.pause.on",
    entity: "Setting",
    entityId: "routingPause",
    meta: { paused: true },
    request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, paused: true });
}

export async function DELETE(req: NextRequest) {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;
  const me = g.me;

  await setRoutingPaused(false);
  await audit({
    userId: me.id,
    action: "routing.pause.off",
    entity: "Setting",
    entityId: "routingPause",
    meta: { paused: false },
    request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, paused: false });
}
