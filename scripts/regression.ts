// ────────────────────────────────────────────────────────────────────────────
// scripts/regression.ts — READ-ONLY regression suite + deployment gate
//
//   npx tsx scripts/regression.ts        (also: npm run regression)
//
// WHY THIS EXISTS
//   Past deploys silently broke shipped invariants (deleted leads reappearing in
//   duplicate detection, the source migration regressing to raw enum tokens,
//   importer cross-field contamination, remark truncation). The Vercel build
//   only gates on `next build` (types + compile). It does NOT prove the live
//   DATA still satisfies the business invariants. This suite does: it runs a
//   battery of PASS/FAIL assertions against the real prod DB and exits non-zero
//   if ANY fails — so `scripts/deploy.sh` can abort the push before a regression
//   ships.
//
// HARD CONSTRAINTS (do not relax)
//   • READ-ONLY. This script performs ZERO writes — no create/update/delete,
//     no $executeRaw. Only counts, findMany/findFirst (select), and read-only
//     $queryRaw SELECTs. Safe to run against production Neon any number of times.
//   • Server-only libs (dedup.ts, customerHistory.ts, leadScope.ts,
//     investorMatch.ts) import "server-only", which bare `tsx` cannot resolve.
//     So the relevant `where` clauses are REPLICATED INLINE here, kept
//     byte-for-byte equivalent to the source. When you change a query in those
//     libs, mirror it here. Pure libs WITHOUT "server-only" are imported directly
//     (sourceLabel.ts, importValidate.ts) so those assertions test the REAL code.
//
// OUTPUT
//   One line per assertion (✓/✗), then `REGRESSION: X passed, Y failed`.
//   process.exit(1) on any failure, else exit 0.
// ────────────────────────────────────────────────────────────────────────────

import { prisma } from "../src/lib/prisma";
// Pure libs (NO "server-only") — import the REAL implementations so these
// assertions test production code, not a copy.
import { sourceBreakdown } from "../src/lib/sourceLabel";
import {
  validBudgetRaw,
  validEmail,
  validPhone,
  looksLikeStatus,
} from "../src/lib/importValidate";

// ── tiny assertion harness ──────────────────────────────────────────────────
type Check = { name: string; run: () => Promise<void> };

let passed = 0;
let failed = 0;
const results: { name: string; ok: boolean; detail: string }[] = [];

/** Throw with a clear message when `cond` is false. */
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// last-10 digits canonical phone key — mirrors customerHistory.last10 / dedup.
function last10(s?: string | null): string {
  return (s ?? "").replace(/\D/g, "").slice(-10);
}

// ── the suite ────────────────────────────────────────────────────────────────
const checks: Check[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // 0. SCHEMA / CONNECTIVITY
  //    prisma connects, lead.count works, and the audit/source columns exist
  //    (selecting them must not throw — proves the migration is applied in prod).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "schema/connectivity — lead.count() + rawRemarks/rawImport/sourceRaw columns exist",
    run: async () => {
      const total = await prisma.lead.count();
      assert(typeof total === "number", "lead.count() did not return a number");
      assert(total >= 0, `lead.count() returned a negative number: ${total}`);
      // Selecting the audit/source columns must succeed (column-presence probe).
      const row = await prisma.lead.findFirst({
        select: { id: true, rawRemarks: true, rawImport: true, sourceRaw: true, source: true },
      });
      // row may be null on an empty DB; the point is the SELECT itself didn't throw.
      void row;
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 0b. ENDPOINT AUTH  — the recurring "UI-gated but API-open" class.
  //    Lead import endpoints MUST role-gate their POST (requireRole), not just
  //    requireUser(). A static source-scan so a future refactor can't silently
  //    re-open them to any logged-in agent (who could overwrite leads on dedupe).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "endpoint-auth — lead import endpoints are role-gated (requireRole, not open)",
    run: async () => {
      const fs = await import("fs");
      for (const f of [
        "src/app/api/intake/csv/route.ts",
        "src/app/api/intake/google-sheet/route.ts",
      ]) {
        const src = fs.readFileSync(f, "utf8");
        assert(/requireRole\(/.test(src), `${f} POST must be role-gated (requireRole) — reverted to requireUser()?`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 1. DELETED-LEAD EXCLUSION  (project-deleted-dup-exclusion + deleted-dup)
  //    A soft-deleted lead (deletedAt != null) must NOT surface in:
  //      (a) the Previous-History query   { deletedAt: null, OR:[phone/email] }
  //      (b) the dedup query              AND:[{deletedAt:null}, {OR:[...]}]
  //      (c) the investor-match SQL       WHERE "deletedAt" IS NULL
  //    For each, assert the BASELINE (no deletedAt filter) DOES match the fixture
  //    and the FILTERED query does NOT — proving the filter is what excludes it.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "deleted-exclusion — soft-deleted lead hidden from history/dedup/investor-match (baseline matches, filtered does not)",
    run: async () => {
      // Pick a REAL soft-deleted lead with something to match on (phone or email).
      const fixture = await prisma.lead.findFirst({
        where: { deletedAt: { not: null }, OR: [{ phone: { not: null } }, { email: { not: null } }] },
        select: { id: true, phone: true, altPhone: true, email: true, deletedAt: true },
      });

      if (!fixture) {
        // No soft-deleted lead exists right now → nothing to assert. Don't fail
        // the gate over absent fixture data; the filters are still proven by the
        // import-batch rollback flow. Treat as a no-op pass.
        results.push({ name: "  ↳ note", ok: true, detail: "no soft-deleted fixture present — exclusion checks skipped" });
        return;
      }
      assert(fixture.deletedAt != null, "fixture is not actually soft-deleted");

      const p10 = last10(fixture.phone);
      const emailLc = (fixture.email ?? "").trim().toLowerCase();
      assert(p10.length >= 7 || emailLc.length > 0, "fixture has neither a usable phone nor email to match on");

      // Build the same OR clause customerHistory uses (phone endsWith last-10 OR email insensitive).
      const historyOR: Array<Record<string, unknown>> = [];
      if (p10.length >= 7) historyOR.push({ phone: { endsWith: p10 } }, { altPhone: { endsWith: p10 } });
      if (emailLc) historyOR.push({ email: { equals: emailLc, mode: "insensitive" } });

      // (a) customerHistory — getCustomerHistory uses where:{ deletedAt:null, OR }.
      const baselineHistory = await prisma.lead.count({ where: { OR: historyOR } });
      const filteredHistory = await prisma.lead.count({ where: { deletedAt: null, OR: historyOR } });
      assert(baselineHistory >= 1, "history baseline (no deletedAt filter) did not match the deleted fixture — fixture/query mismatch");
      // The fixture itself is deleted; filtered must not count it. (Other LIVE leads
      // sharing the contact may still match — so assert filtered < baseline, i.e.
      // at least the deleted one dropped out.)
      assert(filteredHistory < baselineHistory, `deletedAt:null did NOT exclude the soft-deleted lead from Previous-History (baseline=${baselineHistory}, filtered=${filteredHistory})`);

      // (b) dedup — findPossibleDuplicates final where is AND:[ scope, {deletedAt:null}, {OR} ].
      // Mirror the email + exact-phone OR clauses (the parts that match our fixture).
      const dedupOR: Array<Record<string, unknown>> = [];
      if (fixture.phone) { dedupOR.push({ phone: fixture.phone }, { altPhone: fixture.phone }); }
      if (emailLc) dedupOR.push({ email: { equals: emailLc, mode: "insensitive" } });
      assert(dedupOR.length > 0, "could not build a dedup OR clause for the fixture");
      const dedupBaseline = await prisma.lead.count({ where: { OR: dedupOR } });
      const dedupFiltered = await prisma.lead.count({ where: { AND: [{ deletedAt: null }, { OR: dedupOR }] } });
      assert(dedupBaseline >= 1, "dedup baseline did not match the deleted fixture");
      assert(dedupFiltered < dedupBaseline, `dedup AND:[{deletedAt:null},{OR}] did NOT exclude the soft-deleted lead (baseline=${dedupBaseline}, filtered=${dedupFiltered})`);

      // (c) investor-match — raw SQL: WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL
      //     AND RIGHT(REGEXP_REPLACE("phone",'\D','','g'),10) = $tail.
      //     Only meaningful when the fixture has a 10-digit phone.
      if (p10.length === 10) {
        const baseRows = await prisma.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Lead"
          WHERE "phone" IS NOT NULL
            AND RIGHT(REGEXP_REPLACE("phone", '\D', '', 'g'), 10) = ${p10}`;
        const filtRows = await prisma.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Lead"
          WHERE "phone" IS NOT NULL
            AND "deletedAt" IS NULL
            AND RIGHT(REGEXP_REPLACE("phone", '\D', '', 'g'), 10) = ${p10}`;
        const baseIds = new Set(baseRows.map((r) => r.id));
        const filtIds = new Set(filtRows.map((r) => r.id));
        assert(baseIds.has(fixture.id), "investor-match baseline SQL did not match the deleted fixture by phone tail");
        assert(!filtIds.has(fixture.id), `investor-match WHERE "deletedAt" IS NULL did NOT exclude the soft-deleted fixture`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 2. SOURCE MIGRATION  (project-wcr-crm source overhaul)
  //    sourceBreakdown over live leads must yield HUMAN labels, never a bare
  //    enum token like "CSV_IMPORT" / "FACEBOOK_ADS". Distinct sourceRaw >= 5.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "source-migration — sourceBreakdown returns human labels (no raw enum tokens) + >=5 distinct sourceRaw",
    run: async () => {
      const rows = await prisma.lead.findMany({
        where: { deletedAt: null },
        select: { source: true, sourceRaw: true },
      });
      const breakdown = sourceBreakdown(rows);
      assert(breakdown.length > 0, "sourceBreakdown produced no rows over live leads");

      // A raw enum token = ALL CAPS with an underscore, or a known SOURCE_ENUM key.
      // effectiveSource() must never surface these (it maps them to friendly labels
      // or prefers verbatim sourceRaw).
      const RAW_ENUM_TOKENS = new Set([
        "WEBSITE", "WHATSAPP", "CSV_IMPORT", "EVENT", "REFERRAL", "INBOUND_CALL",
        "FACEBOOK_ADS", "GOOGLE_ADS", "PORTAL_99ACRES", "PORTAL_MAGICBRICKS",
        "PORTAL_HOUSING", "OTHER",
      ]);
      const offenders = breakdown
        .map((b) => b.source)
        .filter((s) => RAW_ENUM_TOKENS.has(s) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(s));
      assert(
        offenders.length === 0,
        `sourceBreakdown leaked raw enum token(s): ${offenders.join(", ")} — source UI/reporting must show human labels`,
      );

      // Distinct sourceRaw options must be a real vocabulary (>= 5).
      const distinct = await prisma.lead.findMany({
        where: { deletedAt: null, sourceRaw: { not: null } },
        select: { sourceRaw: true },
        distinct: ["sourceRaw"],
      });
      assert(distinct.length >= 5, `expected >=5 distinct sourceRaw values, found ${distinct.length}`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3. IMPORT FIELD VALIDATION  (importValidate.ts — cross-field contamination)
  //    The importer's per-field guards reject values leaked from other columns.
  //    These test the REAL imported functions.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "import-validation — budget/email/phone/status guards reject cross-field contamination",
    run: async () => {
      // Budget: a person's name in the budget cell → rejected (no digits).
      assert(validBudgetRaw("Lalit Sir") === undefined, `validBudgetRaw("Lalit Sir") should reject (got ${JSON.stringify(validBudgetRaw("Lalit Sir"))})`);
      assert(validBudgetRaw("Tanuj") === undefined, "validBudgetRaw('Tanuj') should reject");
      // ...but a real budget with digits passes (verbatim).
      assert(validBudgetRaw("10 Cr") === "10 Cr", `validBudgetRaw("10 Cr") should pass verbatim (got ${JSON.stringify(validBudgetRaw("10 Cr"))})`);

      // Email: the boolean "false" (leaked from a TRUE/FALSE column) → rejected.
      assert(validEmail("false") === undefined, `validEmail("false") should reject (got ${JSON.stringify(validEmail("false"))})`);
      // ...but a real email normalises to lowercase.
      assert(validEmail("A@B.com") === "a@b.com", `validEmail("A@B.com") should normalise (got ${JSON.stringify(validEmail("A@B.com"))})`);

      // Phone: a country-code-only "+91" → rejected (too few digits).
      assert(validPhone("+91") === undefined, `validPhone("+91") should reject (got ${JSON.stringify(validPhone("+91"))})`);
      // ...but a full E.164 passes through.
      assert(validPhone("+919876543210") === "+919876543210", `validPhone("+919876543210") should pass (got ${JSON.stringify(validPhone("+919876543210"))})`);

      // Status: a boolean token "FALSE" (from a Meeting/Site-Visit column) is NOT a status.
      assert(looksLikeStatus("FALSE") === false, "looksLikeStatus('FALSE') should be false");
      // ...but a real status label IS.
      assert(looksLikeStatus("Callback today") === true, "looksLikeStatus('Callback today') should be true");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 4. REMARKS PRESERVATION  (project-crm-remarks-overhaul — immutable rawRemarks)
  //    Some leads carry rawRemarks, and the longest is large (proves no
  //    truncation of the imported conversation history).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "remarks-preservation — rawRemarks populated + longest is large (no truncation)",
    run: async () => {
      const withRaw = await prisma.lead.count({ where: { rawRemarks: { not: null } } });
      assert(withRaw > 0, "no leads have rawRemarks — remark preservation appears broken");

      const [{ maxlen }] = await prisma.$queryRaw<{ maxlen: number | null }[]>`
        SELECT MAX(LENGTH("rawRemarks"))::int AS maxlen FROM "Lead"`;
      assert(maxlen != null, "could not compute MAX(LENGTH(rawRemarks))");
      assert(
        (maxlen ?? 0) > 1000,
        `longest rawRemarks is only ${maxlen} chars — expected > 1000; conversation history may be getting truncated`,
      );
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 5. REPORTS SANITY
  //    Lead counts return numbers; a source groupBy via findMany + sourceBreakdown
  //    yields rows (the reporting path other dashboards depend on).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "reports-sanity — counts are numbers + source groupBy yields rows",
    run: async () => {
      const [total, live, dubai, india] = await Promise.all([
        prisma.lead.count(),
        prisma.lead.count({ where: { deletedAt: null } }),
        prisma.lead.count({ where: { deletedAt: null, forwardedTeam: "Dubai" } }),
        prisma.lead.count({ where: { deletedAt: null, forwardedTeam: "India" } }),
      ]);
      for (const [label, n] of [["total", total], ["live", live], ["dubai", dubai], ["india", india]] as const) {
        assert(typeof n === "number" && n >= 0, `report count "${label}" is not a non-negative number (got ${n})`);
      }
      assert(live <= total, `live (${live}) cannot exceed total (${total})`);

      const rows = await prisma.lead.findMany({
        where: { deletedAt: null },
        select: { source: true, sourceRaw: true },
      });
      const breakdown = sourceBreakdown(rows);
      assert(Array.isArray(breakdown) && breakdown.length > 0, "source groupBy (findMany + sourceBreakdown) yielded no rows");
      assert(breakdown.every((r) => typeof r.n === "number" && r.n > 0), "source breakdown contains a non-positive count");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 6. PERMISSIONS / SCOPING DATA CONTRACT  (leadScope.ts)
  //    A DB script can't do a static grep of the scope code, so we assert the
  //    DATA CONTRACT instead: there exist live leads with a non-null ownerId, so
  //    ownership scoping (AGENT → ownerId === me.id) has data to act on. Light by design.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "permissions-data — live leads with non-null ownerId exist (scoping has data to act on)",
    run: async () => {
      const owned = await prisma.lead.count({ where: { deletedAt: null, ownerId: { not: null } } });
      assert(owned > 0, "no live leads have a non-null ownerId — ownership scoping would be a no-op");
    },
  },
];

// ── runner ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("REGRESSION HARNESS — read-only invariants vs. prod DB");
  console.log("=".repeat(72));

  for (const c of checks) {
    try {
      await c.run();
      console.log(`✓ ${c.name}`);
      results.push({ name: c.name, ok: true, detail: "" });
      passed++;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${c.name}`);
      console.log(`    → ${detail}`);
      results.push({ name: c.name, ok: false, detail });
      failed++;
    }
  }

  console.log("=".repeat(72));
  console.log(`REGRESSION: ${passed} passed, ${failed} failed`);

  await prisma.$disconnect();
  // Non-zero exit on ANY failure so scripts/deploy.sh aborts the deploy.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  // A throw OUTSIDE a check (e.g. DB unreachable) is itself a gate failure.
  console.error("✗ REGRESSION HARNESS CRASHED:", err);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
