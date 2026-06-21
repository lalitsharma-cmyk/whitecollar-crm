import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

// Temporary push-enrolment diagnostics (Lalit: "why do iPhones get stuck?").
// The client posts {context, permission, supported, ios, standalone, ua, result,
// error, saved, …}. We stash it in the audit log so we can read EXACTLY what each
// device reports without needing the user's console. Read via scripts/audit-push-debug.ts.
export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  await audit({
    userId: me.id,
    action: "push.debug",
    entity: "PushSubscription",
    meta: {
      context: String(body.context ?? ""),
      permission: String(body.permission ?? ""),
      supported: body.supported === true,
      ios: body.ios === true,
      standalone: body.standalone === true,
      result: String(body.result ?? ""),
      saved: body.saved === true,
      hasSub: body.hasSub === true,
      error: body.error ? String(body.error).slice(0, 300) : undefined,
      ua: String(body.ua ?? "").slice(0, 220),
    },
    request: reqMeta(req),
  });
  return NextResponse.json({ ok: true });
}
