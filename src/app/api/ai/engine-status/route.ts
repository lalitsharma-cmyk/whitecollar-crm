// GET /api/ai/engine-status — ADMIN-only. Reports which LLM provider is configured and
// whether it's ready (key present) or degrading to the deterministic mock. Exposes NO
// secrets (never the key itself). Intentionally NOT gated behind ai.enabled, so an admin
// can verify configuration before switching AI on.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { engineStatus } from "@/lib/ai/engine";

export async function GET() {
  await requireRole("ADMIN");
  const status = engineStatus();
  const aiEnabled = (await getSetting("ai.enabled")).toLowerCase() === "true";
  return NextResponse.json({ ok: true, aiEnabled, ...status });
}
