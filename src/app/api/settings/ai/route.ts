// Admin-only: toggle the global AI kill-switch (ai.enabled) and the AI
// trial-mode gate (ai.trialMode.enabled). Both stored in the Setting table.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));

  const results: Record<string, boolean> = {};

  if (typeof body.enabled === "boolean") {
    await setSetting("ai.enabled", String(body.enabled));
    results.enabled = body.enabled;
  }

  if (typeof body.trialModeEnabled === "boolean") {
    await setSetting("ai.trialMode.enabled", String(body.trialModeEnabled));
    results.trialModeEnabled = body.trialModeEnabled;
  }

  await audit({
    userId: me.id, action: "settings.ai", entity: "Setting",
    meta: results, request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, ...results });
}
