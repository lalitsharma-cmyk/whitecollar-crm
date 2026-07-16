import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { recordHeartbeat, endPresenceSession } from "@/lib/presence";

// POST /api/presence/heartbeat — any AUTHENTICATED user. Fired by
// <PresenceBeacon/> every 60s while the tab is visible, on route change, on
// tab-hide (active:false) and on pagehide ({end:true} via sendBeacon).
//
// Body: { sessionKey, route, module?, device?: { os, browser, isPwa }, active?: boolean, end?: boolean }
//
// Contract (Lalit spec):
//   • MUST be cheap — a single ownership-guarded upsert, no joins.
//   • Server stamps every timestamp (client clocks are never trusted).
//   • Route is stripped to PATHNAME server-side (query strings can carry
//     search text / phone numbers — never stored).
//   • PRIVACY: no message content, no note text, no phone numbers, no field
//     values, no GPS, no IP persisted. Operational metadata only.
//   • Responds 204 with NO body — presence data must never leak into any
//     non-admin payload.
//
// getCurrentUser() (not requireUser()) because requireUser() REDIRECTS on
// failure — a background beacon must get a plain 401, never a login redirect.
export async function POST(req: NextRequest) {
  try {
    const me = await getCurrentUser();
    if (!me) return new NextResponse(null, { status: 401 });

    // navigator.sendBeacon posts a Blob — parse the raw text, don't assume
    // a JSON content-type.
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse((await req.text()) || "{}") as Record<string, unknown>;
    } catch {
      body = {};
    }

    const sessionKey = typeof body.sessionKey === "string" ? body.sessionKey.trim().slice(0, 80) : "";
    if (!sessionKey || sessionKey.length < 8) {
      return new NextResponse(null, { status: 400 });
    }

    if (body.end === true) {
      await endPresenceSession(sessionKey, me.id);
      return new NextResponse(null, { status: 204 });
    }

    const device = (body.device ?? {}) as Record<string, unknown>;
    await recordHeartbeat({
      userId: me.id,
      sessionKey,
      route: typeof body.route === "string" ? body.route : "/",
      isActive: body.active === true,
      userAgent: req.headers.get("user-agent"),
      client: {
        os: typeof device.os === "string" ? device.os : null,
        browser: typeof device.browser === "string" ? device.browser : null,
        isPwa: device.isPwa === true,
      },
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    // A presence failure must NEVER surface to the user — swallow and 204.
    return new NextResponse(null, { status: 204 });
  }
}
