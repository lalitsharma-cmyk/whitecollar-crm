// Admin-only: master testing-mode kill-switch.
// When ON, pauses every auto-outbound action + every nagging escalation.
// See src/components/TestingModeToggle.tsx for the full list of suppressed features.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const enabled = body.enabled === true;
  await setSetting("testingMode.enabled", String(enabled));
  await audit({
    userId: me.id, action: "settings.testing-mode", entity: "Setting",
    meta: { enabled }, request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, enabled });
}
