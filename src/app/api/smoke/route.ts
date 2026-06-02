// Programmatic post-deploy smoke test.
//
// Hit this immediately after `npm run push` finishes. It runs ~15 cheap checks
// that together prove:
//   1. DB is reachable AND all the new (Round 2-6) tables / columns exist.
//   2. The AI plumbing is wired (env vars present, helpers importable).
//   3. The new components compiled into the build (a missing or broken
//      component would throw at import time here too — so a successful
//      require() is a strong signal the deploy is whole).
//
// Returns:
//   { ok: true,  checks: [...] }   when everything passes
//   { ok: false, failed: [...], checks: [...] }   otherwise (HTTP 500)
//
// Each check is shaped `{ name, ok, durationMs, error? }`.
//
// AUTH:
//   - If process.env.SMOKE_TOKEN is set, require `Authorization: Bearer <token>`
//     OR `?token=<token>` query param. This lets CI / curl scripts authenticate
//     without a session cookie.
//   - Otherwise fall back to `requireUser()` so a logged-in admin can curl it
//     from the browser dev console.
//
// PERFORMANCE: All checks run in parallel; total wall-clock < 500ms in a healthy
// deploy (most are simple `count()` queries). The slowest check times out
// individually at 2 s — a single laggy probe shouldn't sink the whole response.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai";

type Check = {
  name: string;
  ok: boolean;
  durationMs: number;
  detail?: unknown;
  error?: string;
};

const PER_CHECK_TIMEOUT_MS = 2_000;

// Wrap a check fn so we always get a Check row back — never an unhandled throw.
async function runCheck(name: string, fn: () => Promise<unknown>): Promise<Check> {
  const started = Date.now();
  try {
    const detail = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${PER_CHECK_TIMEOUT_MS}ms`)), PER_CHECK_TIMEOUT_MS),
      ),
    ]);
    return { name, ok: true, durationMs: Date.now() - started, detail };
  } catch (e) {
    return {
      name,
      ok: false,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// Authenticate. Returns null when authorized, or a NextResponse to short-circuit with.
async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const tokenEnv = process.env.SMOKE_TOKEN?.trim();
  if (tokenEnv) {
    const header = req.headers.get("authorization") ?? "";
    const bearer = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : null;
    const queryToken = req.nextUrl.searchParams.get("token");
    if (bearer === tokenEnv || queryToken === tokenEnv) return null;
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  // No SMOKE_TOKEN configured — require a logged-in user (any role).
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized — log in or set SMOKE_TOKEN" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);
  const started = Date.now();

  // All checks run concurrently. Order in the array = display order in the response.
  const checks: Check[] = await Promise.all([
    // ── 1. DB connectivity (the cheapest possible read) ──
    runCheck("db.lead.count", async () => {
      const n = await prisma.lead.count();
      return { count: n };
    }),

    // ── 2. Round 2 — StickyNote table exists (migration ran) ──
    runCheck("db.stickyNote.count", async () => {
      const n = await prisma.stickyNote.count();
      return { count: n };
    }),

    // ── 3. Round 2 — Lead.authorityLevel column exists & is queryable ──
    //    (a missing column would throw a Prisma error here.)
    runCheck("db.lead.authorityLevel.queryable", async () => {
      const sample = await prisma.lead.findMany({
        where: { authorityLevel: { not: null } },
        select: { id: true, authorityLevel: true },
        take: 1,
      });
      return { rowsScanned: sample.length };
    }),

    // ── 4. Round 2 — Lead.needSummary column exists ──
    runCheck("db.lead.needSummary.queryable", async () => {
      const sample = await prisma.lead.findMany({
        where: { needSummary: { not: null } },
        select: { id: true },
        take: 1,
      });
      return { rowsScanned: sample.length };
    }),

    // ── 5. At least one ADMIN exists — without one, login + role gating is broken ──
    runCheck("db.user.admin.exists", async () => {
      const n = await prisma.user.count({ where: { role: "ADMIN" } });
      if (n < 1) throw new Error("No ADMIN users in the database");
      return { adminCount: n };
    }),

    // ── 6. AI plumbing — aiEnabled() must be a boolean (no API call made) ──
    runCheck("ai.enabled.flag", async () => {
      const enabled = aiEnabled();
      if (typeof enabled !== "boolean") throw new Error(`aiEnabled() returned non-boolean: ${typeof enabled}`);
      return { enabled };
    }),

    // ── 7. Round 5 — Project.country populated → property scoping setup ──
    runCheck("db.project.country.queryable", async () => {
      const grouped = await prisma.project.groupBy({
        by: ["country"],
        _count: { _all: true },
      });
      const countries = grouped.map((g) => ({ country: g.country, count: g._count._all }));
      return { countries };
    }),

    // ── 8. New components compile into the build. A failed build / broken
    //      import would throw at require() time. We only check the module
    //      loads; we do NOT render it (server-only here).
    runCheck("build.component.InvestorBanner", async () => {
      const mod = await import("@/components/InvestorBanner");
      if (!mod || (!mod.default && !("InvestorBanner" in mod))) {
        throw new Error("InvestorBanner module loaded but has no default export");
      }
      return { loaded: true };
    }),

    runCheck("build.component.SmartCMACard", async () => {
      const mod = await import("@/components/SmartCMACard");
      if (!mod || (!mod.default && !("SmartCMACard" in mod))) {
        throw new Error("SmartCMACard module loaded but has no default export");
      }
      return { loaded: true };
    }),

    runCheck("build.component.QualityScoreCard", async () => {
      const mod = await import("@/components/QualityScoreCard");
      if (!mod || (!mod.default && !("QualityScoreCard" in mod))) {
        throw new Error("QualityScoreCard module loaded but has no default export");
      }
      return { loaded: true };
    }),

    runCheck("build.component.IamHereCard", async () => {
      const mod = await import("@/components/IamHereCard");
      if (!mod || (!mod.default && !("IamHereCard" in mod))) {
        throw new Error("IamHereCard module loaded but has no default export");
      }
      return { loaded: true };
    }),

    runCheck("build.component.StickyNoteWidget", async () => {
      const mod = await import("@/components/StickyNoteWidget");
      if (!mod || (!mod.default && !("StickyNoteWidget" in mod))) {
        throw new Error("StickyNoteWidget module loaded but has no default export");
      }
      return { loaded: true };
    }),

    runCheck("build.component.RejectLeadModal", async () => {
      const mod = await import("@/components/RejectLeadModal");
      if (!mod || (!mod.default && !("RejectLeadModal" in mod))) {
        throw new Error("RejectLeadModal module loaded but has no default export");
      }
      return { loaded: true };
    }),

    // ── 9. ANTHROPIC_API_KEY — present check only. NEVER log the value. ──
    runCheck("env.anthropic_api_key.present", async () => {
      const present = !!process.env.ANTHROPIC_API_KEY?.trim();
      return { present };
    }),

    // ── 10. DATABASE_URL — must exist AND start with postgresql:// in prod ──
    runCheck("env.database_url.postgres", async () => {
      const raw = process.env.DATABASE_URL?.trim() ?? "";
      if (!raw) throw new Error("DATABASE_URL is not set");
      if (!raw.startsWith("postgresql://") && !raw.startsWith("postgres://")) {
        throw new Error("DATABASE_URL does not start with postgresql:// or postgres://");
      }
      return { protocol: raw.split("://")[0] };
    }),

    // ── 11. NEXTAUTH_SECRET present — without it the session cookie can't sign ──
    runCheck("env.nextauth_secret.present", async () => {
      const present = !!process.env.NEXTAUTH_SECRET?.trim();
      if (!present) throw new Error("NEXTAUTH_SECRET is not set — login will be broken");
      return { present };
    }),
  ]);

  const failed = checks.filter((c) => !c.ok);
  const ok = failed.length === 0;
  const totalMs = Date.now() - started;

  return NextResponse.json(
    {
      ok,
      commit,
      ts: new Date().toISOString(),
      totalMs,
      checkCount: checks.length,
      ...(ok ? {} : { failed }),
      checks,
    },
    { status: ok ? 200 : 500 },
  );
}
