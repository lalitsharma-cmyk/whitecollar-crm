import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { setSetting, AUTOMATION_KEYS, type AutomationKey } from "@/lib/settings";
import { audit, reqMeta } from "@/lib/audit";

// Toggle a single Automation Control (admin only). Notifications/reminders are
// NOT governed here — they always fire. Each automated ACTION stays OFF until an
// admin flips its own flag. Body: { key: AutomationKey, enabled: boolean }.
export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const key = String(body.key ?? "");
  const enabled = body.enabled === true;
  if (!(AUTOMATION_KEYS as string[]).includes(key)) {
    return NextResponse.json({ error: "Unknown automation key" }, { status: 400 });
  }
  await setSetting(key as AutomationKey, String(enabled));
  await audit({
    userId: me.id,
    action: "settings.automation",
    entity: "Setting",
    meta: { key, enabled },
    request: reqMeta(req),
  });
  return NextResponse.json({ ok: true });
}
