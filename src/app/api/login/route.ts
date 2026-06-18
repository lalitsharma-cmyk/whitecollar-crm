import { NextResponse, type NextRequest } from "next/server";
import { loginWithCredentials } from "@/lib/auth";
import { isRateLimited, clearRateLimit } from "@/lib/rateLimit";
import { audit, reqMeta } from "@/lib/audit";
import { autoMarkAttendanceOnLogin } from "@/lib/attendance";
import { requestMetaFrom } from "@/lib/device";

// Where a user lands right after a successful login. HR-only users (e.g. Nisha)
// go straight to the HR workspace; everyone else to the main CRM dashboard, which
// itself routes by role. (The (app)/(hr) layouts also enforce this, so this is
// just a cleaner first hop.)
function landingPathFor(user: { hrOnly?: boolean | null }): string {
  return user.hrOnly ? "/hr" : "/dashboard";
}

export async function POST(req: NextRequest) {
  let email = "", password = "", deviceId = "";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    email = String((body as { email?: string }).email ?? "");
    password = String((body as { password?: string }).password ?? "");
    deviceId = String((body as { deviceId?: string }).deviceId ?? "");
  } else {
    const fd = await req.formData();
    email = String(fd.get("email") ?? "");
    password = String(fd.get("password") ?? "");
    deviceId = String(fd.get("deviceId") ?? "");
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

  const meta = requestMetaFrom(req.headers);
  const r = await loginWithCredentials(email, password, deviceId ? { deviceId, meta } : undefined);
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
