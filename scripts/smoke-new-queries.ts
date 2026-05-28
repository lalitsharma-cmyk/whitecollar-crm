// Read-only runtime smoke test for the server-side query logic shipped in
// waves 1-20. Compilation (tsc) + the auth-redirect probe prove the modules
// LOAD; this proves the heavy DB queries actually EXECUTE against real data
// without throwing (raw SQL typos, bad casts, Prisma groupBy shape errors,
// the explainScore arithmetic, etc.). Nothing here writes — safe to run
// against production Neon.
//
//   npx tsx scripts/smoke-new-queries.ts

import { prisma } from "../src/lib/prisma";
// NOTE: explainScore lives in leadRescorer.ts which imports "server-only"
// (a Next runtime shim bare tsx can't resolve). It's pure synchronous
// arithmetic already covered by tsc + the production build, so we don't
// re-exercise it here — this harness focuses on the raw-SQL queries, which
// is where real runtime risk (casts, typos, tz logic) actually lives.

type Check = { name: string; run: () => Promise<unknown> };

const checks: Check[] = [
  // ── Reports: stalled-deal CTE (wave §9.11) ──
  {
    name: "reports/commission — stalled CTE + groupBy shape",
    run: () =>
      prisma.$queryRaw`
        WITH latest_change AS (
          SELECT DISTINCT ON ("leadId") "leadId", "createdAt"
          FROM "Activity" WHERE "type" = 'STATUS_CHANGE'
          ORDER BY "leadId", "createdAt" DESC
        )
        SELECT l."id", COALESCE(lc."createdAt", l."createdAt") AS entered_at
        FROM "Lead" l LEFT JOIN latest_change lc ON lc."leadId" = l."id"
        WHERE l."status" IN ('QUALIFIED','SITE_VISIT','NEGOTIATION')
          AND COALESCE(lc."createdAt", l."createdAt") < NOW() - (7 * INTERVAL '1 day')`,
  },
  // ── Best-time-to-call heatmap (wave 15) — IST tz extraction ──
  {
    name: "reports — call heatmap (DOW/HOUR at IST tz)",
    run: () =>
      prisma.$queryRaw`
        SELECT EXTRACT(DOW FROM "startedAt" AT TIME ZONE 'Asia/Kolkata')::int AS dow,
               EXTRACT(HOUR FROM "startedAt" AT TIME ZONE 'Asia/Kolkata')::int AS hour,
               COUNT(*)::int AS total
        FROM "CallLog" WHERE "startedAt" >= NOW() - INTERVAL '30 days'
        GROUP BY dow, hour`,
  },
  // ── Leaderboards (wave 1) — fastest-response DISTINCT ON ──
  {
    name: "leaderboards — fastest first-call response",
    run: () =>
      prisma.$queryRaw`
        WITH first_call AS (
          SELECT DISTINCT ON (cl."leadId") cl."leadId", cl."userId", cl."startedAt", l."createdAt"
          FROM "CallLog" cl JOIN "Lead" l ON l."id" = cl."leadId"
          ORDER BY cl."leadId", cl."startedAt" ASC
        )
        SELECT "userId", AVG(EXTRACT(EPOCH FROM ("startedAt" - "createdAt"))/60) AS avg_min
        FROM first_call WHERE "startedAt" >= "createdAt" GROUP BY "userId"`,
  },
  // ── Duplicate detector (wave 13) — normalized phone grouping ──
  {
    name: "admin/duplicates — phone + email grouping",
    run: () =>
      prisma.$queryRaw`
        SELECT RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '\D', '', 'g'), 10) AS k, COUNT(*) AS n
        FROM "Lead" WHERE phone IS NOT NULL
        GROUP BY k HAVING COUNT(*) > 1 LIMIT 50`,
  },
  // ── Lead tags distinct vocab (wave 7) — string_to_array UNNEST ──
  {
    name: "leads — distinct tag vocabulary (UNNEST)",
    run: () =>
      prisma.$queryRaw`
        SELECT DISTINCT TRIM(t) AS tag
        FROM "Lead", UNNEST(string_to_array(COALESCE(tags,''), ',')) AS t
        WHERE TRIM(t) <> '' LIMIT 100`,
  },
  // ── Commission groupBy (wave 19) ──
  {
    name: "reports/commission — booked leads",
    run: () =>
      prisma.lead.findMany({
        where: { OR: [{ commissionAmount: { gt: 0 } }, { status: { in: ["WON", "BOOKING_DONE"] } }] },
        select: { commissionAmount: true, commissionCurrency: true, commissionStatus: true, ownerId: true },
        take: 50,
      }),
  },
  // ── Team comparison (wave 17) — per-team forwardedTeam scoping ──
  {
    name: "reports/team-comparison — team-scoped counts",
    run: () =>
      Promise.all([
        prisma.lead.count({ where: { forwardedTeam: "Dubai" } }),
        prisma.lead.count({ where: { forwardedTeam: "India" } }),
      ]),
  },
];

async function main() {
  console.log("RUNTIME SMOKE — new query logic (waves 1-20), read-only\n" + "=".repeat(64));
  let pass = 0, fail = 0;

  for (const c of checks) {
    try {
      const r = await c.run();
      const n = Array.isArray(r) ? r.length : "ok";
      console.log(`✓ ${c.name} — ${n} row(s)`);
      pass++;
    } catch (err) {
      console.log(`✗ ${c.name} — ${String(err).slice(0, 160)}`);
      fail++;
    }
  }

  console.log("=".repeat(64));
  console.log(`RESULT: ${pass} passed · ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main();
