// Consolidate the duplicate "Sameer" admin accounts (Lalit-approved 2026-06-21).
// Decision: keep sameer.wcr1@gmail.com (in active use); retire the never-used
// sameer@whitecollarrealty.com. SAFE method = deactivate (active=false), which
// removes it from the agent picker + blocks login but is fully REVERSIBLE
// (set active=true to restore). Backup-first per the production-safety rule.
// Loads .env exactly like scripts/prod-uat.ts.
//
// Run:  npx tsx scripts/consolidate-sameer.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = /^([A-Z_]+)="?([^"\n]*)"?/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const STRAY_ID    = "cmpidrr4x0000vphgg8ffxu9w";       // retire this one
const STRAY_EMAIL = "sameer@whitecollarrealty.com";
const KEEP_ID     = "cmqml9np30000vpw4wirlk6j3";       // keep this one (in use)
const KEEP_EMAIL  = "sameer.wcr1@gmail.com";

async function main() {
  // 1. Re-fetch + hard safety asserts — never act on the wrong row.
  const stray = await prisma.user.findUnique({ where: { id: STRAY_ID } });
  const keep  = await prisma.user.findUnique({ where: { id: KEEP_ID } });
  if (!stray) throw new Error(`ABORT: stray account ${STRAY_ID} not found.`);
  if (stray.email !== STRAY_EMAIL) throw new Error(`ABORT: email mismatch on stray (${stray.email} ≠ ${STRAY_EMAIL}).`);
  if (!keep || keep.email !== KEEP_EMAIL) throw new Error(`ABORT: keeper account ${KEEP_ID}/${KEEP_EMAIL} check failed.`);

  // 2. Dependency scan across core Sales/auth relations (informational —
  //    deactivation is safe regardless; this also tells us a future hard-delete
  //    would be clean). HR relations not scanned: account never logged in.
  const deps = {
    ownedLeads:            await prisma.lead.count({ where: { ownerId: STRAY_ID } }),
    assignments:           await prisma.assignment.count({ where: { userId: STRAY_ID } }),
    activities:            await prisma.activity.count({ where: { userId: STRAY_ID } }),
    callLogs:              await prisma.callLog.count({ where: { userId: STRAY_ID } }),
    notes:                 await prisma.note.count({ where: { userId: STRAY_ID } }),
    auditLogs:             await prisma.auditLog.count({ where: { userId: STRAY_ID } }),
    fieldHistoryChanges:   await prisma.leadFieldHistory.count({ where: { changedById: STRAY_ID } }),
    notifications:         await prisma.notification.count({ where: { userId: STRAY_ID } }),
    vaultEntries:          await prisma.vaultEntry.count({ where: { userId: STRAY_ID } }),
    stickyNotes:           await prisma.stickyNote.count({ where: { userId: STRAY_ID } }),
    ownDevices:            await prisma.device.count({ where: { userId: STRAY_ID } }),
    approvedOthersDevices: await prisma.device.count({ where: { approvedById: STRAY_ID } }),
    loginSessions:         await prisma.userSession.count({ where: { userId: STRAY_ID } }),
    importBatchesImported: await prisma.importBatch.count({ where: { importedById: STRAY_ID } }),
    importBatchesDeleted:  await prisma.importBatch.count({ where: { deletedById: STRAY_ID } }),
    assistantRuns:         await prisma.assistantRun.count({ where: { createdById: STRAY_ID } }),
    directReports:         await prisma.user.count({ where: { managerId: STRAY_ID } }),
  };
  const totalRefs = Object.values(deps).reduce((a, b) => a + b, 0);

  // 3. Backup snapshot (omit passwordHash — never write a secret to a repo file).
  const { passwordHash: _omit, ...safeRow } = stray as Record<string, unknown>;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(fileURLToPath(new URL(".", import.meta.url)), "_backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `sameer-deactivate-${ts}.json`);
  writeFileSync(backupPath, JSON.stringify({
    action: "deactivate (active → false)",
    reversible: "set active=true on this id to restore",
    reason: "Duplicate of sameer.wcr1@gmail.com — same person. Lalit-approved 2026-06-21.",
    keptAccount: { id: KEEP_ID, email: KEEP_EMAIL },
    dependencyCounts: deps,
    rowSnapshot_passwordHashOmitted: safeRow,
  }, null, 2));

  console.log(`Stray  : "${stray.name}" <${stray.email}> (${stray.id})  active=${stray.active}`);
  console.log(`Keeper : "${keep.name}" <${keep.email}> (${keep.id})  active=${keep.active}`);
  console.log(`\nDependency references on stray (core relations): ${totalRefs}`);
  console.log(JSON.stringify(deps, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  // 4. The change — reversible deactivation only. NO hard delete.
  if (!stray.active) {
    console.log("\nStray already inactive — no change applied.");
  } else {
    await prisma.user.update({ where: { id: STRAY_ID }, data: { active: false } });
    console.log(`\n✓ Deactivated <${stray.email}> (active → false). Reversible.`);
  }

  // 5. Verify against the EXACT agent-picker query from the report.
  const agentList = await prisma.user.findMany({
    where: { active: true, hrOnly: false, role: { in: ["ADMIN", "MANAGER", "AGENT"] } },
    select: { id: true, name: true, email: true },
  });
  const sameers = agentList.filter((u) => /sameer/i.test(u.name));
  console.log(`\nAgent picker now lists ${sameers.length} "Sameer": ${sameers.map((s) => `${s.name} <${s.email}>`).join(", ") || "—"}`);
  console.log(`(Total active agent-picker users: ${agentList.length})`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
