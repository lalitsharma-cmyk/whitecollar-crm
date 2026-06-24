// ────────────────────────────────────────────────────────────────────────────
// scripts/cleanup-duplicate-here.ts
//
// One-time, reversible cleanup of LEGACY duplicate "I Am Here" check-ins.
//
// BACKGROUND
//   The HERE field-status check-in was made once-per-IST-day on 2026-06-24
//   (commit f4b4009): a 2nd HERE today is now a no-op that keeps the first row.
//   But a few users tapped "I Am Here" more than once that day BEFORE the fix
//   landed, leaving >1 HERE AgentStatusEvent in the same (userId, IST-day)
//   bucket. They are harmless (the button locks; the `dashboard-field-status`
//   regression treats them as a NON-FATAL legacy note) — but ideally each user
//   keeps only their FIRST HERE of the day so movement history is clean.
//
// WHAT THIS DOES
//   • Groups every status="HERE" row by (userId, IST-day) using the SAME
//     istDateKey() the regression uses, so a clean run makes the legacy note
//     disappear and the suite stay green.
//   • For each bucket with >1 HERE: KEEPS the EARLIEST (min startedAt) and
//     removes ONLY the later duplicate HERE rows. The kept row is never
//     touched — its timestamp is preserved verbatim.
//
// SAFE BY DESIGN
//   • DRY-RUN by default. Prints a full before/after plan and writes nothing.
//     Pass --apply to execute (Lalit-approved + fresh backup first).
//   • Touches ONLY status="HERE" rows. Never a meeting / site-visit / leaving
//     event. The DELETE is double-guarded with status:"HERE" in its WHERE.
//   • Refuses to run if any to-delete row is referenced by another event's
//     pairedEventId (HERE is standalone and never paired — this is defensive).
//   • AgentStatusEvent has NO deletedAt column (no recycle bin), so reversibility
//     comes from a FULL-ROW JSON backup written before the delete. Restore =
//     prisma.agentStatusEvent.createMany({ data: <rows from the backup file> })
//     — every field (id, startedAt, endedAt, durationMin, pairedEventId, note,
//     createdAt) is preserved so a restore is byte-identical.
//   • Wraps delete + AuditLog in one transaction. Verifies 0 dup buckets remain.
//
// USAGE
//   npx tsx scripts/cleanup-duplicate-here.ts            # dry-run (safe)
//   npx tsx scripts/cleanup-duplicate-here.ts --apply    # execute (after approval)
// ────────────────────────────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";
import { istDateKey, fmtIST } from "../src/lib/datetime";
import { writeFileSync, mkdirSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

type HereRow = {
  id: string;
  userId: string;
  status: "HERE";
  startedAt: Date;
  endedAt: Date | null;
  durationMin: number | null;
  pairedEventId: string | null;
  note: string | null;
  createdAt: Date;
};

async function main() {
  console.log(
    `\n🔍 HERE-dedup  (mode: ${APPLY ? "APPLY — will delete extra HERE rows" : "DRY-RUN — no changes; pass --apply to execute"})\n`,
  );

  // ── Load every HERE row (full row, so the backup is restore-complete) ───────
  // Ordered earliest-first so the FIRST row in each bucket is the keeper.
  const heres = (await prisma.agentStatusEvent.findMany({
    where: { status: "HERE" },
    orderBy: { startedAt: "asc" },
    take: 100_000, // field-status launched 2026-06-24; this is a tiny table
  })) as HereRow[];

  console.log(`  Loaded ${heres.length} HERE event(s) total.`);

  // ── Group by (userId, IST-day) — identical keying to the regression ─────────
  const buckets = new Map<string, HereRow[]>();
  for (const h of heres) {
    const key = `${h.userId}|${istDateKey(h.startedAt)}`;
    const arr = buckets.get(key);
    if (arr) arr.push(h);
    else buckets.set(key, [h]);
  }

  const dupeBuckets = [...buckets.entries()].filter(([, rows]) => rows.length > 1);

  if (dupeBuckets.length === 0) {
    console.log("\n  ✅ No (user, IST-day) bucket has >1 HERE. Nothing to clean — history is already tidy.\n");
    return;
  }

  // ── Decide keepers vs extras (keep earliest; never touch the keeper) ────────
  const toDelete: HereRow[] = [];
  console.log(`\n  Buckets with >1 HERE (need cleanup): ${dupeBuckets.length}`);
  for (const [key, rows] of dupeBuckets) {
    const [userId, day] = key.split("|");
    const sorted = [...rows].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const keep = sorted[0];
    const extras = sorted.slice(1);
    toDelete.push(...extras);
    console.log(`\n    • user ${userId}  IST-day ${day}  →  ${rows.length} HERE`);
    console.log(`        KEEP   ${keep.id}  ${fmtIST(keep.startedAt)} IST  (earliest — preserved untouched)`);
    for (const e of extras) {
      console.log(`        DELETE ${e.id}  ${fmtIST(e.startedAt)} IST`);
    }
  }

  const deleteIds = toDelete.map((r) => r.id);

  // ── Guard 1: we only ever target status="HERE" rows ─────────────────────────
  const nonHere = toDelete.filter((r) => r.status !== "HERE");
  if (nonHere.length > 0) {
    console.error(`\n  ✗ ABORT: ${nonHere.length} non-HERE row(s) ended up in the delete set. No change made.`);
    process.exit(1);
  }

  // ── Guard 2: none of the to-delete rows may be referenced as a pair opener ──
  // (HERE is a standalone point event and is never a pairedEventId target —
  //  this verifies that invariant before we remove anything.)
  const referenced = await prisma.agentStatusEvent.count({
    where: { pairedEventId: { in: deleteIds } },
  });
  if (referenced > 0) {
    console.error(`\n  ✗ ABORT: ${referenced} event(s) reference a to-delete HERE row via pairedEventId. No change made.`);
    process.exit(1);
  }

  console.log(`\n  Plan: delete ${deleteIds.length} extra HERE row(s); keep ${dupeBuckets.length} (one per bucket).`);
  console.log(`  Safety: non-HERE rows in delete set = 0 ✓   ·   to-delete rows referenced by a pair = 0 ✓`);

  if (!APPLY) {
    console.log(`\n  DRY-RUN — nothing written. After Lalit's approval + a fresh backup, re-run with --apply.`);
    console.log(`  Expected after apply: ${heres.length} → ${heres.length - deleteIds.length} HERE rows; 0 dup buckets.\n`);
    return;
  }

  // ── APPLY: backup the FULL rows first (reversibility), then delete + audit ───
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = "backups";
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/here-dedup-${stamp}.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        _meta: {
          stamp,
          script: "cleanup-duplicate-here.ts",
          reason:
            "Legacy duplicate HERE check-ins from before the once-per-IST-day fix (f4b4009). Kept earliest per (user, IST-day); removed later duplicates.",
          restore:
            "prisma.agentStatusEvent.createMany({ data: deletedRows }) — every field preserved (id/startedAt/endedAt/durationMin/pairedEventId/note/createdAt), so a restore is byte-identical.",
          keptIds: dupeBuckets.map(([key, rows]) => ({
            bucket: key,
            keptId: [...rows].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0].id,
          })),
        },
        deletedRows: toDelete,
      },
      null,
      2,
    ),
  );
  console.log(`\n  💾 Backup → ${file}  (${toDelete.length} full row(s); restore via agentStatusEvent.createMany)`);

  // Admin for the audit trail (Lalit / super-admin), best-effort.
  const admin = await prisma.user.findFirst({
    where: { OR: [{ isSuperAdmin: true }, { email: { contains: "lalit", mode: "insensitive" } }] },
    select: { id: true, name: true },
  });

  const result = await prisma.$transaction(async (tx) => {
    // Double-guard: status:"HERE" in the WHERE makes it impossible to remove a
    // non-HERE row even if deleteIds were somehow wrong.
    const del = await tx.agentStatusEvent.deleteMany({
      where: { id: { in: deleteIds }, status: "HERE" },
    });
    await tx.auditLog.create({
      data: {
        userId: admin?.id ?? null,
        action: "agent_status.here.dedup",
        entity: "AgentStatusEvent",
        entityId: null, // batch op — full id list lives in meta
        meta: JSON.stringify({
          removedIds: deleteIds,
          removedCount: del.count,
          buckets: dupeBuckets.map(([key, rows]) => ({ bucket: key, before: rows.length })),
          backupFile: file,
          reason:
            "Removed legacy duplicate HERE check-ins (pre-f4b4009). Kept the earliest HERE per (user, IST-day); deleted later duplicates only. Reversible from backupFile.",
        }),
      },
    });
    return del.count;
  });

  console.log(`  ✓ deleted ${result} extra HERE row(s) in a transaction (status="HERE" guard enforced)`);
  console.log(`  ✓ audit row written (action=agent_status.here.dedup, by ${admin?.name ?? "system"})`);

  // ── Verify: re-group and assert no bucket has >1 HERE ───────────────────────
  const after = (await prisma.agentStatusEvent.findMany({
    where: { status: "HERE" },
    select: { userId: true, startedAt: true },
    take: 100_000,
  })) as { userId: string; startedAt: Date }[];
  const afterCounts = new Map<string, number>();
  for (const h of after) {
    const key = `${h.userId}|${istDateKey(h.startedAt)}`;
    afterCounts.set(key, (afterCounts.get(key) ?? 0) + 1);
  }
  const stillDup = [...afterCounts.entries()].filter(([, n]) => n > 1);

  console.log(`\n  Before/after HERE total: ${heres.length} → ${after.length}`);
  console.log(`  Dup (user, IST-day) buckets remaining: ${stillDup.length}  ${stillDup.length === 0 ? "✓ (regression legacy-note will clear)" : "✗"}`);
  if (stillDup.length > 0) {
    console.error("  ✗ WARNING: duplicate buckets still present — investigate before deploying.");
    process.exit(1);
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error("✗ FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
