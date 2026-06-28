import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { loginWithCredentials } from "@/lib/auth";
import { isRateLimited, clearRateLimit } from "@/lib/rateLimit";
import { audit, reqMeta } from "@/lib/audit";
import { autoMarkAttendanceOnLogin } from "@/lib/attendance";
import { requestMetaFrom } from "@/lib/device";

// Durable per-browser-context device id. Resolution order (login route):
//   client localStorage value → this httpOnly cookie → freshly generated UUID.
// The cookie is the RELIABLE anchor: iOS Safari/PWA can block or clear localStorage
// (Private mode, ITP), which previously left the client sending NO deviceId and the
// user hard-blocked. An httpOnly first-party cookie survives that, is scoped per
// browser context (Safari and each installed PWA have SEPARATE cookie jars on iOS),
// and is NOT synced across physical devices by Apple continuity/iCloud — so it both
// fixes the login failure AND keeps every device/context a separate approval.
const DID_COOKIE = "wcr_did";

// Where a user lands right after a successful login. HR-only users (e.g. Nisha)
// go straight to the HR workspace; everyone else to the main CRM dashboard, which
// itself routes by role. (The (app)/(hr) layouts also enforce this, so this is
// just a cleaner first hop.)
function landingPathFor(user: { hrOnly?: boolean | null }): string {
  return user.hrOnly ? "/hr" : "/dashboard";
}

export async function POST(req: NextRequest) {
  let email = "", password = "", deviceId = "", displayMode = "";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    email = String((body as { email?: string }).email ?? "");
    password = String((body as { password?: string }).password ?? "");
    deviceId = String((body as { deviceId?: string }).deviceId ?? "");
    displayMode = String((body as { displayMode?: string }).displayMode ?? "");
  } else {
    const fd = await req.formData();
    email = String(fd.get("email") ?? "");
    password = String(fd.get("password") ?? "");
    deviceId = String(fd.get("deviceId") ?? "");
    displayMode = String(fd.get("displayMode") ?? "");
  }
  if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });

  // Rate limit per IP+email combo — stops brute force
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rlKey = `${ip}:${email.toLowerCase()}`;
  const rl = isRateLimited(rlKey);
  if (rl.limited) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  // Resolve a STABLE device id: prefer the client localStorage value (the original
  // anchor the admin approved), else the durable cookie, else mint a new one. Then
  // (re)write the cookie so it always mirrors the resolved id — if localStorage later
  // breaks, the cookie carries the SAME id and the device stays recognised (no new
  // pending device). Set on every response so even a failed attempt establishes it.
  const jar = await cookies();
  const cookieDid = (jar.get(DID_COOKIE)?.value ?? "").trim();
  const did = deviceId.trim() || cookieDid || randomUUID();
  jar.set(DID_COOKIE, did, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
  const pwa = displayMode === "standalone";

  const meta = requestMetaFrom(req.headers);
  const r = await loginWithCredentials(email, password, { deviceId: did, meta, pwa });
  if (!r.ok) {
    const pending = "pending" in r && r.pending;
    const blocked = "blocked" in r && r.blocked;
    await audit({
      action: pending ? "auth.login.device_pending" : blocked ? "auth.login.device_blocked" : "auth.login.fail",
      entity: "User",
      meta: { email },
      request: reqMeta(req),
    });
    // JSON callers get a structured response; native form posts redirect back to
    // /login?error= so the message (incl. "sent to admin") renders on the page.
    if (ct.includes("application/json")) {
      return NextResponse.json({ error: r.error, pending, blocked }, { status: pending || blocked ? 403 : 401 });
    }
    const back = new URL("/login", req.url);
    back.searchParams.set("error", r.error);
    return NextResponse.redirect(back, { status: 303 });
  }

  clearRateLimit(rlKey); // success resets counter
  await audit({
    userId: r.user.id,
    action: "auth.login.success",
    entity: "User",
    entityId: r.user.id,
    request: reqMeta(req),
  });
  // Auto-mark daily attendance — PRESENT before 10:30am IST, LATE after.
  // Idempotent: no-op if already marked today (admin overrides preserved).
  autoMarkAttendanceOnLogin(r.user.id).catch(() => {});

  const landing = landingPathFor(r.user);
  if (ct.includes("application/json")) return NextResponse.json({ ok: true, redirect: landing });
  return NextResponse.redirect(new URL(landing, req.url), { status: 303 });
}
