import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

const PUBLIC_PATHS = [
  "/login", "/api/intake", "/embed.js", "/api/health", "/api/logout", "/api/login", "/api/cron",
  // Acefone webhook is auth'd by ACEFONE_WEBHOOK_TOKEN inside the handler, not by session
  "/api/acefone/webhook",
  // PWA assets — must be reachable without auth so phones can install before login
  "/manifest.webmanifest", "/sw.js",
  "/icon", "/apple-icon", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/og-image.png",
  // Brand assets — logo used on the login page and apple-icon before auth
  "/brand/",
];

// Never let the browser cache a private page — this is what stops "press Back
// after logout and the old dashboard reappears" (back/forward cache replay).
const NO_STORE = "no-store, max-age=0, must-revalidate";

// Boundary-aware public check. A bare `startsWith(p)` would let any FUTURE route
// that merely begins with a public prefix bypass auth (e.g. /login-as-admin,
// /api/intake-secret). Match the exact path, a path segment under it (p + "/"),
// or a query on it — and treat entries ending in "/" as explicit prefix dirs.
//
// Public capability download for a shared gallery resource. ONLY the exact
// `/api/resources/<id>/file` path is public (the cuid is the unguessable
// capability) so a client who receives a WhatsApp/Email share link can open the
// file without a CRM login. Nothing else under /api/resources is exposed — the
// list/create/edit/delete/share routes still require a session. Anchored regex
// so a stray trailing segment does NOT match.
const PUBLIC_RESOURCE_FILE = /^\/api\/resources\/[^/]+\/file(?:[/?]|$)/;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_RESOURCE_FILE.test(pathname)) return true;
  return PUBLIC_PATHS.some((p) =>
    p.endsWith("/")
      ? pathname.startsWith(p)
      : pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"),
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.next(); // fail open in dev if not configured
  const session = await verifySession(token, secret);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("from", pathname);
    const res = NextResponse.redirect(url);
    res.headers.set("Cache-Control", NO_STORE);
    return res;
  }
  // Authenticated private route → continue, but mark it no-store so a logged-out
  // user can never see it again from cache.
  const res = NextResponse.next();
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
