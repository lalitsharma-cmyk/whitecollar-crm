import { prisma } from "../src/lib/prisma";
import { writeFileSync, mkdirSync } from "node:fs";

// HEAL — legacy junk phoneCanonical (Audit 2026-07-23). A handful of leads carry a
// phoneCanonical that is only a bare country code ("91", "9185" — < 7 digits), left
// by an older normaliser. The dedup MATCH path is already safe (tail requires ≥7),
// and phoneCanonicalDigits is now guarded so this can't recur — this nulls the
// existing junk canonicals so the column is clean. Reversible. Never touches `phone`.
const APPLY = process.argv.includes("--apply");
const STAMP = "2026-07-23";

(async () => {
  const rows = await prisma.lead.findMany({
    where: { phoneCanonical: { not: null }, deletedAt: null },
    select: { id: true, name: true, phone: true, phoneCanonical: true },
  });
  const junk = rows.filter((l) => (l.phoneCanonical ?? "").replace(/\D/g, "").length < 7);
  console.log(`Leads with a junk (<7-digit) phoneCanonical: ${junk.length}`);
  const byVal: Record<string, number> = {};
  for (const l of junk) { const k = l.phoneCanonical ?? "(null)"; byVal[k] = (byVal[k] || 0) + 1; }
  console.log("  by value:", byVal);
  console.log("  sample:", junk.slice(0, 5).map((l) => ({ id: l.id, name: l.name, phone: l.phone, canon: l.phoneCanonical })));

  if (junk.length === 0) { console.log("Nothing to heal."); await prisma.$disconnect(); return; }

  mkdirSync("backups/phonecanonical-heal", { recursive: true });
  writeFileSync(`backups/phonecanonical-heal/before-${STAMP}.json`, JSON.stringify(junk.map((l) => ({ id: l.id, phoneCanonical: l.phoneCanonical })), null, 2));
  writeFileSync(`backups/phonecanonical-heal/REVERSAL-${STAMP}.sql`,
    junk.map((l) => `UPDATE "Lead" SET "phoneCanonical"='${l.phoneCanonical}' WHERE id='${l.id}';`).join("\n") + "\n");
  console.log(`snapshot + reversal → backups/phonecanonical-heal/`);

  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply."); await prisma.$disconnect(); return; }

  const r = await prisma.lead.updateMany({ where: { id: { in: junk.map((l) => l.id) } }, data: { phoneCanonical: null } });
  console.log(`NULLED phoneCanonical on ${r.count} leads.`);
  await prisma.operationLog.create({ data: {
    operation: "lead.edit", entityType: "Lead", module: "Leads", field: "phoneCanonical",
    summary: `Null ${r.count} junk (<7-digit / bare-country-code) phoneCanonical values`,
    status: "EXECUTED", affectedCount: r.count, affectedIds: junk.map((l) => l.id),
    beforeState: junk.map((l) => ({ id: l.id, phoneCanonical: l.phoneCanonical })),
    afterState: { phoneCanonical: null }, createdById: "cmplo0t6v0000vpxslasvbwuq",
  } }).catch((e) => console.error("OperationLog failed:", e.message));

  const remaining = (await prisma.lead.findMany({ where: { phoneCanonical: { not: null }, deletedAt: null }, select: { phoneCanonical: true } }))
    .filter((l) => (l.phoneCanonical ?? "").replace(/\D/g, "").length < 7).length;
  console.log(`\nVERIFY: junk phoneCanonical remaining = ${remaining} (expect 0)`);
  await prisma.$disconnect();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
