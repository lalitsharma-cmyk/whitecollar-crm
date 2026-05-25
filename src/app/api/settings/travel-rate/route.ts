// Admin-only: set the per-km travel reimbursement rate.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const v = Number(body.perKmInr);
  if (isNaN(v) || v < 0 || v > 1000) {
    return NextResponse.json({ error: "Per-km rate must be 0-1000 INR" }, { status: 400 });
  }
  await setSetting("travel.perKmInr", String(v));
  await audit({ userId: me.id, action: "settings.travel-rate", entity: "Setting",
    meta: { perKmInr: v }, request: reqMeta(req) });
  return NextResponse.json({ ok: true, perKmInr: v });
}
