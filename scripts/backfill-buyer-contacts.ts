// ─────────────────────────────────────────────────────────────────────────────
// backfill-buyer-contacts.ts — repair EVERY buyer whose phones/emails are empty
// but whose verbatim rawImport DOES carry a phone/email column (the "Primary Mobile
// Number was never mapped" bug). Uses the SAME rescue helpers the fixed import
// route now uses, so existing rows match what a fresh import would produce.
//
// SAFE: only fills phones/emails when currently EMPTY (never overwrites); recomputes
// buyerKey when a phone is added (so dedup/repeat-buyer rollup stays correct); never
// touches remarks/history. rawImport is the source of truth (preserved). Reversible.
// Run backup-buyers.ts first.
//
//   npx tsx scripts/backfill-buyer-contacts.ts            # report
//   npx tsx scripts/backfill-buyer-contacts.ts --apply    # write to prod
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { rescuePhones, rescueEmails } from "../src/lib/buyerContactRescue";
import { normalizeBuyerKey, primaryPhone } from "../src/lib/buyerIntelligence";

const APPLY = process.argv.includes("--apply");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(readFileSync(new URL("../.env", import.meta.url), "utf8"))![1];
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const hasVals = (json: string | null): boolean => {
  try { const a = JSON.parse(json ?? "[]"); return Array.isArray(a) && a.filter((x) => String(x ?? "").trim()).length > 0; }
  catch { return false; }
};

async function main() {
  if (APPLY) {
    const ok = existsSync("backups") && readdirSync("backups").some((d) => d.startsWith("buyers-"));
    if (!ok) throw new Error("Run scripts/backup-buyers.ts first (no backups/buyers-* snapshot).");
  }
  const buyers = await prisma.buyerRecord.findMany({
    where: { deletedAt: null },
    select: { id: true, clientName: true, phones: true, emails: true, rawImport: true },
  });

  let phoneFills = 0, emailFills = 0, keyUpdates = 0;
  const samples: string[] = [];
  for (const b of buyers) {
    const raw = ((b.rawImport as Record<string, unknown>) ?? {});
    const data: { phones?: string; emails?: string; buyerKey?: string } = {};
    if (!hasVals(b.phones)) { const ph = rescuePhones(raw); if (ph.length) { data.phones = JSON.stringify(ph); phoneFills++; } }
    if (!hasVals(b.emails)) { const em = rescueEmails(raw); if (em.length) { data.emails = JSON.stringify(em); emailFills++; } }
    if (data.phones) { data.buyerKey = normalizeBuyerKey(b.clientName, primaryPhone(data.phones, null)) ?? undefined; keyUpdates++; }
    if (Object.keys(data).length) {
      if (samples.length < 8) samples.push(`  ${b.clientName.slice(0, 26).padEnd(26)} phones=${data.phones ?? "(keep)"} emails=${data.emails ?? "(keep)"}`);
      if (APPLY) await prisma.buyerRecord.update({ where: { id: b.id }, data });
    }
  }

  console.log(`Mode: ${APPLY ? "APPLY" : "REPORT"} · live buyers scanned: ${buyers.length}`);
  console.log(`phone fills: ${phoneFills} · email fills: ${emailFills} · buyerKey recomputed: ${keyUpdates}`);
  if (samples.length) { console.log("Samples:"); console.log(samples.join("\n")); }

  // Post-count (JS, since phones is a JSON string column).
  const after = await prisma.buyerRecord.findMany({ where: { deletedAt: null }, select: { phones: true, emails: true } });
  console.log(`\n${APPLY ? "POST-APPLY" : "CURRENT"}: live ${after.length} · withPhone ${after.filter((b) => hasVals(b.phones)).length} · withEmail ${after.filter((b) => hasVals(b.emails)).length} · missingPhone ${after.filter((b) => !hasVals(b.phones)).length} · missingEmail ${after.filter((b) => !hasVals(b.emails)).length}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
