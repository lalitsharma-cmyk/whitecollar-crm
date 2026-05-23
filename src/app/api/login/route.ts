import { NextResponse, type NextRequest } from "next/server";
import { loginWithCredentials } from "@/lib/auth";

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
  const r = await loginWithCredentials(email, password);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 401 });

  // For form posts, redirect to dashboard; for JSON requests, return ok
  if (ct.includes("application/json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL("/dashboard", req.url), { status: 303 });
}
