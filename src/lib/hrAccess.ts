// ─────────────────────────────────────────────────────────────────────────────
// HR CRM — SERVER-SIDE authorization guards (the enforcement layer).
//
// Every HR API route and server page MUST gate through one of these. UI hiding
// (via hrPermissions.ts in client components) is cosmetic only — this module is
// where access is actually enforced. Denials return 404 (not 403) for a specific
// candidate so we never confirm a record's existence to someone out of scope,
// matching the Sales loadOwnedLead pattern.
// ─────────────────────────────────────────────────────────────────────────────
import "server-only";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  hrRoleOf, hrScopeWhere, canTouchCandidate, permissionsFor,
  type HrRole, type HrPermissions,
} from "@/lib/hrPermissions";

export * from "@/lib/hrPermissions";

type Me = Awaited<ReturnType<typeof requireUser>>;

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// ── API guards (return a NextResponse on failure; never throw a redirect) ─────

/** Resolve the current user + HR role for an API route, or an error response. */
export async function hrApiAuth(): Promise<
  | { me: Me; role: HrRole; perms: HrPermissions; error?: undefined }
  | { error: NextResponse; me?: undefined; role?: undefined; perms?: undefined }
> {
  const me = await requireUser();
  const role = hrRoleOf(me);
  if (!role) return { error: notFound() }; // not an HR user → pretend nothing here
  return { me, role, perms: permissionsFor(role) };
}

/** Require a specific HR permission for an API route. */
export async function requireHrPermission(perm: keyof HrPermissions): Promise<
  | { me: Me; role: HrRole; error?: undefined }
  | { error: NextResponse; me?: undefined; role?: undefined }
> {
  const auth = await hrApiAuth();
  if (auth.error) return { error: auth.error };
  if (!auth.perms[perm]) return { error: forbidden() };
  return { me: auth.me, role: auth.role };
}

/**
 * Load a candidate the caller is allowed to act on, or return a 404 response.
 * Mirrors loadOwnedLead. Use in EVERY /api/hr/candidates/[id]/* route.
 */
export async function loadOwnedCandidate(candidateId: string): Promise<
  | { me: Me; role: HrRole; candidate: { id: string; primaryOwnerId: string | null; secondaryOwnerId: string | null; name: string; phone: string | null }; error?: undefined }
  | { error: NextResponse; me?: undefined; role?: undefined; candidate?: undefined }
> {
  const auth = await hrApiAuth();
  if (auth.error) return { error: auth.error };
  const candidate = await prisma.hRCandidate.findFirst({
    where: { id: candidateId, deletedAt: null },
    select: { id: true, primaryOwnerId: true, secondaryOwnerId: true, name: true, phone: true },
  });
  if (!candidate) return { error: notFound() };
  if (!canTouchCandidate(auth.me, candidate)) return { error: notFound() };
  return { me: auth.me, role: auth.role, candidate };
}

/** The candidate-list scope where-fragment for the current user (server). */
export async function hrScopeForCurrentUser() {
  const me = await requireUser();
  return { me, where: hrScopeWhere(me), role: hrRoleOf(me) };
}

// ── Page guards (redirect on failure — for server components) ─────────────────

/** Require the user to be ANY HR user; redirect non-HR away. Returns user+role+perms. */
export async function requireHrPage(): Promise<{ me: Me; role: HrRole; perms: HrPermissions }> {
  const me = await requireUser();
  const role = hrRoleOf(me);
  if (!role) redirect("/dashboard");
  return { me, role, perms: permissionsFor(role) };
}

/** Require a specific permission for a server page; redirect to /hr if lacking. */
export async function requireHrPagePermission(perm: keyof HrPermissions): Promise<{ me: Me; role: HrRole; perms: HrPermissions }> {
  const ctx = await requireHrPage();
  if (!ctx.perms[perm]) redirect("/hr");
  return ctx;
}

export { notFound as hrNotFound, forbidden as hrForbidden, unauthorized as hrUnauthorized };
