// Admin-only: toggle the 5-min round-robin auto-assigner on/off.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const enabled = body.enabled === true;
  await setSetting("roundRobin.enabled", String(enabled));
  await audit({
    userId: me.id, action: "settings.round-robin", entity: "Setting",
    meta: { enabled }, request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, enabled });
}
