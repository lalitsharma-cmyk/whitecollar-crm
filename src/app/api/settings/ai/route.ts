// Admin-only: toggle the global AI kill-switch (ai.enabled), the AI
// trial-mode gate (ai.trialMode.enabled), and the monthly cost cap.
// All stored in the Setting table.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));

  const results: Record<string, boolean | number> = {};

  if (typeof body.enabled === "boolean") {
    await setSetting("ai.enabled", String(body.enabled));
    results.enabled = body.enabled;
  }

  if (typeof body.trialModeEnabled === "boolean") {
    await setSetting("ai.trialMode.enabled", String(body.trialModeEnabled));
    results.trialModeEnabled = body.trialModeEnabled;
  }

  if (typeof body.monthlyCostCapUsd === "number" && body.monthlyCostCapUsd >= 0) {
    await setSetting("ai.monthlyCostCapUsd", String(body.monthlyCostCapUsd));
    results.monthlyCostCapUsd = body.monthlyCostCapUsd;
  }

  await audit({
    userId: me.id, action: "settings.ai", entity: "Setting",
    meta: results, request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, ...results });
}
