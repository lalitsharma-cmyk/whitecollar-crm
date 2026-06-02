// Admin-only: BANT qualification stage-gate mode.
// "off" = no check · "soft" = warn-but-allow (default) · "hard" = block advancing
// to Qualified+ until all four BANT signals are captured.
// See src/lib/bantGate.ts for the gate logic and src/components/BantGateToggle.tsx
// for the admin control.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const mode = String(body.mode ?? "").toLowerCase();
  if (mode !== "off" && mode !== "soft" && mode !== "hard") {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }
  await setSetting("bantGate.mode", mode);
  await audit({
    userId: me.id, action: "settings.bant-gate", entity: "Setting",
    meta: { mode }, request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, mode });
}
