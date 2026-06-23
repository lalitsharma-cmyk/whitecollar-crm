// Admin-only: toggle the DAILY buyer auto-distribution on/off (+ optional team
// scope). When ON, the daily cron round-robins ADMIN_POOL buyers across the active
// team. Default OFF (an automation action). Mirrors the round-robin toggle route.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const enabled = body.enabled === true;
  await setSetting("buyerAutoDistribute.enabled", String(enabled));
  if (typeof body.team === "string") {
    await setSetting("buyerAutoDistribute.team", body.team.trim());
  }
  await audit({
    userId: me.id, action: "settings.buyer-distribute", entity: "Setting",
    meta: { enabled, team: typeof body.team === "string" ? body.team.trim() : undefined }, request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, enabled });
}
