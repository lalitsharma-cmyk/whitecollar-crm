// ─────────────────────────────────────────────────────────────────────────────
// backfill-phone-canonical.ts — populate Lead.phoneCanonical for EXISTING rows
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY
//   Item #2 (Lalit canonical-phone rule 2026-07-15) added Lead.phoneCanonical — the
//   DIGITS-ONLY country_code+national_number form ("9999999999" / "+919999999999" /
//   "919999999999" → "919999999999"). New/edited leads get it on write via
//   phoneCanonicalDigits(); this script fills it for every PRE-EXISTING lead so the
//   canonical-tail dedup (leadDedupOR) has a clean value on old rows too.
//
//   It NEVER changes Lead.phone (that's backfill-phone-normalize.ts's job) and NEVER
//   changes the fingerprint — it only DERIVES the new phoneCanonical column from the
//   phone already stored. Purely additive; safe to run repeatedly (idempotent — a
//   row already holding the correct canonical is skipped).
//
// SAFETY
//   • DEFAULT = DRY-RUN: reads only, prints a report (incl. counts by country
//     prefix), writes NOTHING.
//   • --apply: writes a JSON backup to backups/ FIRST, then updates only the rows
//     whose phoneCanonical actually changes. Each row's write is try/caught so one
//     bad row logs + is skipped; the run never aborts midway.
//   • NEVER blanks anything: a phone that can't be canonicalized is left as-is
//     (phoneCanonical stays whatever it was, usually null).
//
//   npx tsx scripts/backfill-phone-canonical.ts           # dry-run (safe on prod)
//   npx tsx scripts/backfill-phone-canonical.ts --apply   # write
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { phoneCanonicalDigits, nationalityFromPhone } from "../src/lib/phoneCountry";

const APPLY = process.argv.includes("--apply");
const env = readFileSync("C:/Users/Lenovo/whitecollar-crm/.env", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

type Row = { id: string; name: string; phone: string | null; phoneCanonical: string | null };

// Country label for the by-prefix report (falls back to the CC digits, then a bucket
// for numbers we couldn't attach a country code to).
function prefixLabel(canonical: string): string {
  if (!canonical) return "(empty)";
  const nat = nationalityFromPhone(canonical);
  if (nat) return nat;
  // No recognized CC — group by leading 2 digits so the report still shows shape.
  return `(no CC · starts ${canonical.slice(0, 2)}…)`;
}

async function main() {
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — Lead.phoneCanonical backfill\n`);

  const leads: Row[] = await prisma.lead.findMany({
    select: { id: true, name: true, phone: true, phoneCanonical: true },
  });

  const plans = leads
    .filter((l) => l.phone && l.phone.trim() !== "")
    .map((l) => {
      const canon = phoneCanonicalDigits(l.phone) || null;
      return { lead: l, canon, changed: canon !== l.phoneCanonical && !!canon };
    });

  const changes = plans.filter((p) => p.changed);

  // ── Counts by country prefix (of the NEW canonical value) ──
  const byPrefix = new Map<string, number>();
  for (const p of plans) {
    if (!p.canon) continue;
    const label = prefixLabel(p.canon);
    byPrefix.set(label, (byPrefix.get(label) ?? 0) + 1);
  }

  console.log(`Total leads:                 ${leads.length}`);
  console.log(`With a phone:                ${plans.length}`);
  console.log(`phoneCanonical would change: ${changes.length}`);
  console.log(`Already correct / unchanged: ${plans.length - changes.length}`);

  console.log(`\n--- Counts by country prefix (canonical, all phoned rows) ---`);
  for (const [label, n] of [...byPrefix.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label.padEnd(28)} ${n}`);
  }

  const samples = changes.slice(0, 25);
  if (samples.length) {
    console.log(`\n--- Sample of changes (${samples.length} of ${changes.length}) ---`);
    for (const p of samples) {
      console.log(`  ${p.lead.name}:  phone="${p.lead.phone}"  canonical ${p.lead.phoneCanonical ?? "(none)"} → ${p.canon}`);
    }
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — nothing written. Re-run with --apply to write.`);
    await prisma.$disconnect();
    return;
  }
  if (changes.length === 0) {
    console.log(`\n✅ Nothing to do (idempotent).`);
    await prisma.$disconnect();
    return;
  }

  // ── Backup (rollback artifact): id → prior phone + phoneCanonical ──
  mkdirSync("C:/Users/Lenovo/whitecollar-crm/backups", { recursive: true });
  const TS = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `backups/backfill-phone-canonical-${TS}.json`;
  writeFileSync(
    `C:/Users/Lenovo/whitecollar-crm/${file}`,
    JSON.stringify(changes.map((p) => ({ id: p.lead.id, phone: p.lead.phone, oldCanonical: p.lead.phoneCanonical, newCanonical: p.canon })), null, 2),
  );
  console.log(`\n🔒 Backup → ${file}`);

  let updated = 0;
  const errors: { id: string; name: string; message: string }[] = [];
  for (const p of changes) {
    try {
      await prisma.lead.update({ where: { id: p.lead.id }, data: { phoneCanonical: p.canon } });
      updated++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ id: p.lead.id, name: p.lead.name, message });
      console.log(`   ✗ skipped ${p.lead.name} (${p.lead.id}): ${message}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Rows updated: ${updated}`);
  console.log(`Errors:       ${errors.length}`);
  console.log(`\nDone.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
