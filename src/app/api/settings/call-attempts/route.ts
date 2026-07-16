// Admin-only: set the two Call Attempt Tracking thresholds in one call
// (mirrors the motivation-pilot route's two-keys-one-POST shape):
//   • ghostingThreshold  — Normal Leads: attempts-with-no-response before the
//     👻 Ghosting tag applies. Allowed 3–30, default 10.
//   • revivalMaxAttempts — Revival/cold: attempts-with-no-response before the
//     record auto-returns to the Admin queue. Allowed 2–15, default 5.
// Values are stored as strings in Setting (like every other numeric setting);
// the engine (src/lib/callAttempts.ts) and the backfill script read + clamp them.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));

  const ghosting = Number(body.ghostingThreshold);
  const revivalMax = Number(body.revivalMaxAttempts);

  if (!Number.isInteger(ghosting) || ghosting < 3 || ghosting > 30) {
    return NextResponse.json(
      { error: "Ghosting Threshold must be a whole number between 3 and 30." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(revivalMax) || revivalMax < 2 || revivalMax > 15) {
    return NextResponse.json(
      { error: "Revival Max Attempts must be a whole number between 2 and 15." },
      { status: 400 },
    );
  }

  await setSetting("ghostingThreshold", String(ghosting));
  await setSetting("revivalMaxAttempts", String(revivalMax));
  await audit({
    userId: me.id, action: "settings.call-attempts", entity: "Setting",
    meta: { ghostingThreshold: ghosting, revivalMaxAttempts: revivalMax }, request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, ghostingThreshold: ghosting, revivalMaxAttempts: revivalMax });
}
