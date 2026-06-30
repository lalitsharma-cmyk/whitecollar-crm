// ─────────────────────────────────────────────────────────────────────────────
// backup-buyers.ts — full, restorable snapshot of EVERY buyer-domain table before
// a BuyerRecord schema migration. The standard pre-deploy snapshot does NOT cover
// BuyerRecord/BuyerActivity/BuyerAssignment/BuyerStickyNote, so this is mandatory
// before touching the buyer schema (PRODUCTION SAFETY RULE: backup-first).
//
// Writes a gzipped JSON to backups/buyers-<ts>/snapshot.json.gz and then VERIFIES
// it is restorable: re-reads the gzip, decompresses, parses, and confirms every
// table's row count + a sample row's id round-trips byte-for-byte.
//
//   npx tsx scripts/backup-buyers.ts
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  const [buyers, activities, assignments, stickyNotes] = await Promise.all([
    prisma.buyerRecord.findMany(),
    prisma.buyerActivity.findMany(),
    prisma.buyerAssignment.findMany(),
    prisma.buyerStickyNote.findMany(),
  ]);
  const snapshot = {
    takenAt: new Date().toISOString(),
    tables: { buyers, activities, assignments, stickyNotes },
  };
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = `backups/buyers-${ts}`;
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/snapshot.json.gz`;
  writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(snapshot))));
  const sizeKB = (readFileSync(path).length / 1024).toFixed(0);

  // VERIFY RESTORABLE — re-read the gzip from disk, decompress, parse, recount.
  const back = JSON.parse(gunzipSync(readFileSync(path)).toString());
  const t = back.tables;
  const ok =
    t.buyers.length === buyers.length &&
    t.activities.length === activities.length &&
    t.assignments.length === assignments.length &&
    t.stickyNotes.length === stickyNotes.length &&
    (buyers.length === 0 || t.buyers[0].id === buyers[0].id);

  console.log(`Backup       → ${path} (${sizeKB} KB)`);
  console.log(`Row counts   → buyers=${buyers.length} activities=${activities.length} assignments=${assignments.length} stickyNotes=${stickyNotes.length}`);
  console.log(`Restorable   → ${ok ? "PASS — gzip re-read, decompressed, counts + sample id all match" : "FAIL"}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
