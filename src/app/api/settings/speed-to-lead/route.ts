// Admin-only: toggle the speed-to-lead auto-response feature.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const enabled = Boolean(body.enabled);
  await setSetting("speedToLead.enabled", enabled ? "true" : "false");
  await audit({
    userId: me.id,
    action: "settings.speed-to-lead",
    entity: "Setting",
    meta: { enabled },
    request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, enabled });
}
