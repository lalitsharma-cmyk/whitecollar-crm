// ────────────────────────────────────────────────────────────────────────────
// scripts/cleanup-avriti-duplicate.ts
//
// One-time, Lalit-approved cleanup of the double-imported duplicate:
//   KEEP   cmqm2qjxo000ql2040wgor7db  (has phone +919870227534, fuller history)
//   REMOVE cmqm2qqew000ml504r1230fd0  (no phone, re-import subset)
//
// SAFE BY DESIGN:
//   • Heavily guarded — aborts unless the keeper still has the phone and the
//     duplicate is phone-less, same name, both live. Touches nothing else.
//   • Backs up BOTH leads + the duplicate's children to a JSON file first.
//   • The duplicate has NO unique data (verified: phone-less, identical remarks,
//     duplicate activities) so there is nothing to merge up — we SOFT-delete it
//     (deletedAt), keeping it + its children fully recoverable in the recycle bin.
//   • Writes an AuditLog row. Reversible: clear deletedAt to restore.
// ────────────────────────────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";
import { writeFileSync, mkdirSync } from "node:fs";

const KEEP = "cmqm2qjxo000ql2040wgor7db";
const DUP = "cmqm2qqew000ml504r1230fd0";
const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

async function main() {
  const keep = await prisma.lead.findUnique({ where: { id: KEEP } });
  const dup = await prisma.lead.findUnique({ where: { id: DUP } });
  if (!keep || !dup) { console.error("✗ ABORT: one of the records is missing."); process.exit(1); }

  // ── Guards — refuse if anything doesn't match the audited state ────────────
  const keepPhone = (keep.phone ?? "").replace(/\D/g, "");
  const dupPhone = (dup.phone ?? "").replace(/\D/g, "");
  const checks: [string, boolean][] = [
    ["keeper still live", keep.deletedAt === null],
    ["duplicate still live", dup.deletedAt === null],
    ["keeper has the phone 9870227534", keepPhone.includes("9870227534")],
    ["duplicate is phone-less", dupPhone === ""],
    ["same client name", norm(keep.name) === norm(dup.name)],
    ["not the same row", String(KEEP) !== String(DUP)],
  ];
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) { console.error(`✗ ABORT: guard failed (${label}). No change made.`); process.exit(1); }
  }

  // ── Backup BOTH leads + the duplicate's children ──────────────────────────
  const [acts, calls, notes, assigns, fh] = await Promise.all([
    prisma.activity.findMany({ where: { leadId: DUP } }),
    prisma.callLog.findMany({ where: { leadId: DUP } }),
    prisma.note.findMany({ where: { leadId: DUP } }),
    prisma.assignment.findMany({ where: { leadId: DUP } }),
    prisma.leadFieldHistory.findMany({ where: { leadId: DUP } }),
  ]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = "backups";
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/avriti-dedup-${stamp}.json`;
  writeFileSync(file, JSON.stringify({ keep, dup, dupChildren: { acts, calls, notes, assigns, fh } }, null, 2));
  console.log(`\n  💾 Backup → ${file}`);
  console.log(`     duplicate children preserved: activities=${acts.length} calls=${calls.length} notes=${notes.length} assigns=${assigns.length} history=${fh.length}`);

  // ── Find an admin user for the audit trail ────────────────────────────────
  const admin = await prisma.user.findFirst({
    where: { OR: [{ isSuperAdmin: true }, { email: { contains: "lalit", mode: "insensitive" } }] },
    select: { id: true, name: true },
  });

  // ── Soft-delete the duplicate (reversible) + audit ────────────────────────
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: DUP }, data: { deletedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        userId: admin?.id ?? null,
        action: "lead.duplicate.soft_removed",
        entity: "Lead",
        entityId: DUP,
        meta: JSON.stringify({
          keptId: KEEP, removedId: DUP, name: keep.name,
          reason: "Double-import of the same Townscript event list (two batches @ 20-Jun 13:36); phone-based de-dup missed the second copy because it had no phone. Removed the phone-less subset; kept the record with phone +919870227534. Reversible: clear deletedAt.",
          backupFile: file,
        }),
      },
    });
  });

  // ── Verify ────────────────────────────────────────────────────────────────
  const after = await prisma.lead.findUnique({ where: { id: DUP }, select: { deletedAt: true } });
  const keepAfter = await prisma.lead.findUnique({ where: { id: KEEP }, select: { deletedAt: true, phone: true } });
  const stillActive = await prisma.lead.count({ where: { deletedAt: null, name: { contains: "Khanduri", mode: "insensitive" } } });
  console.log(`\n  ✓ duplicate soft-deleted at ${after?.deletedAt?.toISOString()}`);
  console.log(`  ✓ keeper intact (deletedAt=${keepAfter?.deletedAt}, phone=${keepAfter?.phone})`);
  console.log(`  ✓ active "Khanduri" leads now: ${stillActive}  (expected 1)`);
  console.log(`  audit by: ${admin?.name ?? "system"}`);
}

main().catch((e) => { console.error("✗ FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());
