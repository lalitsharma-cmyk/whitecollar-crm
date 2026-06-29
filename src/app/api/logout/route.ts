import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { logout, getCurrentUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

// Derive redirect target from the incoming request so it always lands on the
// right host (Vercel preview / prod / localhost) — never trust NEXTAUTH_URL alone.
function buildLogoutRedirect(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  // Delete the session cookie on the SAME path it was set ("/"), and also expire
  // it explicitly, so no browser keeps a stale session.
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, expires: new Date(0) });
  // Never cache a logout — otherwise back/forward could replay a logged-in view.
  res.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  return res;
}

// REVOKE the server-side session row (not just the cookie) so a copied/restored
// cookie can't reopen access after logout, then audit + clear the cookie.
async function doLogout(req: NextRequest): Promise<NextResponse> {
  const me = await getCurrentUser().catch(() => null);
  await logout(); // revokes the UserSession (sid) row + deletes the cookie via the jar
  if (me) await audit({ userId: me.id, action: "auth.logout", entity: "User", entityId: me.id, request: reqMeta(req) });
  return buildLogoutRedirect(req);
}

export async function POST(req: NextRequest) {
  return doLogout(req);
}

// Also allow GET so logout link tags work without JS
export async function GET(req: NextRequest) {
  return doLogout(req);
}
