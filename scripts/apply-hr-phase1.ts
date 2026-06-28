// Apply the HR ATS Phase 1 additive migration to Neon (idempotent). Runs each
// statement separately (ALTER TYPE ADD VALUE cannot run in a txn). Read-safe to
// re-run. Verifies the new tables/columns afterwards.
import { prisma } from "../src/lib/prisma";
import { readFileSync } from "fs";

const SQL_PATH = "prisma/migrations/20260628153000_hr_ats_phase1/migration.sql";

async function main() {
  const raw = readFileSync(SQL_PATH, "utf8");
  // Split into statements; drop comment-only lines.
  const statements = raw
    .split(/;\s*\n/)
    .map(s => s.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);

  console.log(`\n========== APPLY HR PHASE 1 — ${statements.length} statements ==========`);
  for (const [i, stmt] of statements.entries()) {
    const label = stmt.slice(0, 70).replace(/\s+/g, " ");
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`  [${i + 1}/${statements.length}] ✅ ${label}…`);
    } catch (e) {
      console.error(`  [${i + 1}/${statements.length}] ❌ ${label}…\n      ${String(e).split("\n")[0]}`);
      throw e;
    }
  }

  // ── Verify ──
  console.log("\n=== VERIFY ===");
  const cols: { column_name: string }[] = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='HRCandidate' AND column_name IN ('deletedAt','salaryCurrency')`
  );
  console.log(`  HRCandidate new cols: ${cols.map(c => c.column_name).sort().join(", ") || "MISSING"}`);
  const icol: { column_name: string }[] = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='HRInterview' AND column_name='recommendation'`
  );
  console.log(`  HRInterview.recommendation: ${icol.length ? "✅" : "MISSING"}`);
  const tbls: { table_name: string }[] = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_name IN ('HRVoiceMessage','HREscalation','HRVoiceMessageRead','HRSavedFilter') ORDER BY table_name`
  );
  console.log(`  new tables: ${tbls.map(t => t.table_name).join(", ")}`);
  const enums: { enumlabel: string }[] = await prisma.$queryRawUnsafe(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='HRActivityType' AND enumlabel IN ('VOICE_NOTE','VOICE_GUIDANCE','ESCALATION_RAISED','ESCALATION_REPLIED','ESCALATION_RESOLVED','RESUME_UPLOADED') ORDER BY enumlabel`
  );
  console.log(`  new activity enum values: ${enums.map(e => e.enumlabel).join(", ")}`);

  const okCols = cols.length === 2;
  const okTbls = tbls.length === 4;
  const okEnums = enums.length === 6;
  console.log(`\n  RESULT: ${okCols && okTbls && okEnums && icol.length ? "✅ ALL APPLIED" : "❌ INCOMPLETE — investigate"}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error("MIGRATION FAILED:", e); process.exit(1); });
