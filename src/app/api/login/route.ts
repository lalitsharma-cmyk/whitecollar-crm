import { NextResponse, type NextRequest } from "next/server";
import { loginWithCredentials } from "@/lib/auth";
import { isRateLimited, clearRateLimit } from "@/lib/rateLimit";
import { audit, reqMeta } from "@/lib/audit";
import { autoMarkAttendanceOnLogin } from "@/lib/attendance";

export async function POST(req: NextRequest) {
  let email = "", password = "";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    email = String((body as { email?: string }).email ?? "");
    password = String((body as { password?: string }).password ?? "");
  } else {
    const fd = await req.formData();
    email = String(fd.get("email") ?? "");
    password = String(fd.get("password") ?? "");
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

  const r = await loginWithCredentials(email, password);
  if (!r.ok) {
    await audit({
      action: "auth.login.fail",
      entity: "User",
      meta: { email },
      request: reqMeta(req),
    });
    return NextResponse.json({ error: r.error }, { status: 401 });
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

  if (ct.includes("application/json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL("/dashboard", req.url), { status: 303 });
}
