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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.next(); // fail open in dev if not configured
  const session = await verifySession(token, secret);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
