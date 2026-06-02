// Admin-only: configure the B-20 daily-motivation / voice pilot.
// Sets BOTH motivationPilot.enabled and motivationPilot.team in one call so the
// settings UI can offer a single Off / India / Dubai / Both control.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

// Teams the pilot can target. "ALL" = every team (Lalit's "both"); "" = off.
const ALLOWED_TEAMS = new Set(["India", "Dubai", "ALL"]);

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const enabled = body.enabled === true;

  // Canonicalise the requested team so "india" → "India" and "all"/"both" → "ALL".
  let team = typeof body.team === "string" ? body.team.trim() : "";
  const lower = team.toLowerCase();
  if (lower === "india") team = "India";
  else if (lower === "dubai") team = "Dubai";
  else if (lower === "all" || lower === "both") team = "ALL";

  // Guard: don't let the pilot go live without a recognised target team.
  if (enabled && !ALLOWED_TEAMS.has(team)) {
    return NextResponse.json(
      { ok: false, error: "Pick a team (India, Dubai, or Both) before turning the pilot on." },
      { status: 400 },
    );
  }

  await setSetting("motivationPilot.enabled", String(enabled));
  await setSetting("motivationPilot.team", team);
  await audit({
    userId: me.id, action: "settings.motivation-pilot", entity: "Setting",
    meta: { enabled, team }, request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, enabled, team });
}
