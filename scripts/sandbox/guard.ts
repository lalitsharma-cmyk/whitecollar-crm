// ─────────────────────────────────────────────────────────────────────────────
// SANDBOX PROD-SAFETY GUARD
//
// The single chokepoint that makes it STRUCTURALLY IMPOSSIBLE for a sandbox
// seed / reset to touch production. Every sandbox script MUST obtain its Prisma
// client from `sandboxClient()` here — never `new PrismaClient()` (which would
// pick up the ambient DATABASE_URL = production).
//
// Rules enforced before a single row is written:
//   1. SANDBOX_DATABASE_URL must be set (a DEDICATED var — we never fall back to
//      DATABASE_URL). The client is built explicitly from this URL.
//   2. It must NOT equal DATABASE_URL (the production connection string).
//   3. Its host or database name must carry a sandbox marker
//      (sandbox|dev|test|staging|demo) — a typo that points at prod is rejected.
//   4. The caller must pass --confirm (guards against an accidental run).
//
// If any check fails we THROW before creating the client. There is no override
// flag on purpose: to seed a differently-named DB, rename it or set the marker.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";

const SANDBOX_MARKER = /(sandbox|dev|test|staging|demo)/i;

function parseHostAndDb(url: string): { host: string; db: string } {
  // postgres://user:pass@HOST:port/DB?params  — tolerate missing port / params.
  const host = (url.match(/@([^/:?]+)/)?.[1] ?? "").toLowerCase();
  const db = (url.match(/\/([^/?]+)(?:\?|$)/)?.[1] ?? "").toLowerCase();
  return { host, db };
}

/** Validate the sandbox target and return its URL. Throws (never returns) on any
 *  doubt that we are pointed at a dedicated sandbox database. */
export function resolveSandboxUrl(opts?: { requireConfirm?: boolean }): string {
  const url = process.env.SANDBOX_DATABASE_URL?.trim();
  const prod = process.env.DATABASE_URL?.trim();

  if (!url) {
    throw new Error(
      "SANDBOX_DATABASE_URL is not set.\n" +
        "The sandbox seed runs ONLY against SANDBOX_DATABASE_URL — it never uses DATABASE_URL.\n" +
        "Set it to your dedicated sandbox Neon connection string and retry.",
    );
  }
  if (prod && url === prod) {
    throw new Error("REFUSING: SANDBOX_DATABASE_URL equals DATABASE_URL (production). These must be different databases.");
  }

  const { host, db } = parseHostAndDb(url);
  if (!host) throw new Error("Could not parse a host from SANDBOX_DATABASE_URL — check the connection string.");

  if (prod) {
    const p = parseHostAndDb(prod);
    if (p.host && p.host === host && p.db === db) {
      throw new Error(`REFUSING: SANDBOX_DATABASE_URL points at the same host+db as production (${host}/${db}).`);
    }
  }

  if (!SANDBOX_MARKER.test(host) && !SANDBOX_MARKER.test(db)) {
    throw new Error(
      `REFUSING: neither the host ("${host}") nor the database ("${db}") contains a sandbox marker ` +
        `(sandbox|dev|test|staging|demo).\n` +
        "This guard rejects any target that doesn't clearly look like a sandbox, to prevent an accidental " +
        "production seed. Name your sandbox DB/branch with one of those words.",
    );
  }

  if ((opts?.requireConfirm ?? true) && !process.argv.includes("--confirm")) {
    throw new Error("REFUSING: add --confirm to actually write to the sandbox (safety interlock).");
  }

  return url;
}

/** The ONLY sanctioned way for a sandbox script to get a Prisma client. The client
 *  is bound explicitly to the validated sandbox URL, so it can never talk to prod. */
export function sandboxClient(opts?: { requireConfirm?: boolean }): { prisma: PrismaClient; url: string } {
  const url = resolveSandboxUrl(opts);
  const { host, db } = parseHostAndDb(url);
  // eslint-disable-next-line no-console
  console.log(`🧪 SANDBOX target OK → ${host}/${db} (production is untouched).`);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { prisma, url };
}
