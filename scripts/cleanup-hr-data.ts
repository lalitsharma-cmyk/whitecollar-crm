// HR DATA RESET — Lalit-authorized (2026-06-28), backup-first, fully reversible.
// Default = DRY RUN (counts only). Pass --apply to execute inside a transaction.
//
// Safety:
//  - Always writes a dedicated restore-ready HR archive BEFORE any delete.
//  - Full DB backup already exists (backups/FULL-2026-06-28T13-56-16-581Z + offsite).
//  - Resume PDFs live on the website (URLs), NOT deleted here.
//  - Deletes in one transaction → auto-rollback on any error.
//  - Integrity check + cleanup report at the end.
import { prisma } from "../src/lib/prisma";
import { gzipSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";

const APPLY = process.argv.includes("--apply");

async function counts() {
  return {
    candidates: await prisma.hRCandidate.count(),
    activities: await prisma.hRActivity.count(),
    interviews: await prisma.hRInterview.count(),
    followUps: await prisma.hRFollowUp.count(),
    resumes: await prisma.hRResume.count(),
    applications: await prisma.hRApplication.count(),
    intakeLogs: await prisma.hRIntakeLog.count(),
    imports: await prisma.hRImport.count(),
  };
}

async function archive() {
  const dump = {
    candidates: await prisma.hRCandidate.findMany(),
    activities: await prisma.hRActivity.findMany(),
    interviews: await prisma.hRInterview.findMany(),
    followUps: await prisma.hRFollowUp.findMany(),
    resumes: await prisma.hRResume.findMany(),
    applications: await prisma.hRApplication.findMany(),
    intakeLogs: await prisma.hRIntakeLog.findMany(),
    imports: await prisma.hRImport.findMany(),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const json = JSON.stringify(dump, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const gz = gzipSync(Buffer.from(json));
  for (const base of ["backups", "C:/Users/Lenovo/crm-lead-backups"]) {
    const dir = `${base}/HR-ARCHIVE-${stamp}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/hr-archive.json.gz`, gz);
    console.log(`  archive → ${dir}/hr-archive.json.gz (${(gz.length / 1024).toFixed(0)} KB)`);
  }
}

async function main() {
  console.log(`\n========== HR DATA RESET — ${APPLY ? "APPLY (DESTRUCTIVE)" : "DRY RUN"} ==========`);
  const before = await counts();
  console.log("\nWILL DELETE:");
  Object.entries(before).forEach(([k, v]) => console.log(`  ${k.padEnd(14)} ${v}`));

  console.log("\nWriting dedicated restore-ready HR archive…");
  await archive();

  if (!APPLY) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --apply to execute.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nDeleting (single transaction, children → parent)…");
  await prisma.$transaction([
    prisma.hRActivity.deleteMany({}),
    prisma.hRInterview.deleteMany({}),
    prisma.hRFollowUp.deleteMany({}),
    prisma.hRResume.deleteMany({}),
    prisma.hRApplication.deleteMany({}),
    prisma.hRIntakeLog.deleteMany({}),
    prisma.hRCandidate.deleteMany({}),
    prisma.hRImport.deleteMany({}),
  ]);

  const after = await counts();
  const clean = Object.values(after).every((n) => n === 0);
  console.log("\n=== INTEGRITY CHECK (all must be 0) ===");
  Object.entries(after).forEach(([k, v]) => console.log(`  ${k.padEnd(14)} ${v}  ${v === 0 ? "✅" : "❌"}`));
  // orphan checks
  const orphanResumes = await prisma.hRResume.count();
  const orphanApps = await prisma.hRApplication.count();
  console.log(`\n=== CLEANUP REPORT ===`);
  console.log(`  candidates deleted ... ${before.candidates}`);
  console.log(`  resumes deleted ...... ${before.resumes}`);
  console.log(`  applications deleted . ${before.applications}`);
  console.log(`  activities deleted ... ${before.activities}`);
  console.log(`  intake logs deleted .. ${before.intakeLogs}`);
  console.log(`  orphan resumes ....... ${orphanResumes}`);
  console.log(`  orphan applications .. ${orphanApps}`);
  console.log(`  remaining candidates . ${after.candidates}`);
  console.log(`  STATUS: ${clean ? "✅ CLEAN — production-ready empty HR module" : "❌ NOT CLEAN — investigate"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
