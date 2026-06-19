// ─────────────────────────────────────────────────────────────────────────────
// scripts/diag-pick.ts — READ-ONLY. Proves the blank-header fix + measures blast radius.
//   npx tsx scripts/diag-pick.ts
// (1) Blast radius: how many active leads have a blank-normalized header key in
//     rawImport (the leak signature), grouped by import batch + importer origin.
// (2) For each affected lead: simulate ORIGINAL pick (should reproduce the current
//     corrupted DB value → proves replication is faithful) vs FIXED pick (the repair
//     target). ZERO writes.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

type Row = Record<string, string>;
function norm(s: string): string { return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }

// ORIGINAL pick (buggy) — no blank-header guard.
function pickOrig(row: Row, ...candidates: string[]): string | undefined {
  const wanted = candidates.map(norm);
  for (const k of Object.keys(row)) {
    const nk = norm(k);
    for (const t of wanted) {
      if (nk === t || nk.startsWith(t) || t.startsWith(nk)) {
        const v = row[k]?.toString().trim();
        if (v) return v;
      }
    }
  }
}
// FIXED pick — skips blank-normalized headers + empty candidates.
function pickFix(row: Row, ...candidates: string[]): string | undefined {
  const wanted = candidates.map(norm).filter(Boolean);
  for (const k of Object.keys(row)) {
    const nk = norm(k);
    if (!nk) continue;
    for (const t of wanted) {
      if (nk === t || nk.startsWith(t) || t.startsWith(nk)) {
        const v = row[k]?.toString().trim();
        if (v) return v;
      }
    }
  }
}

// The fields the importer reads via pick(), with their candidate lists (gsheet route).
const FIELDS: [string, string[]][] = [
  ["name", ["customer", "name", "fullname", "leadname"]],
  ["phone", ["mobile", "phone", "contact", "whatsapp"]],
  ["email", ["email", "emailid"]],
  ["city", ["city", "location"]],
  ["configuration", ["configuration", "config", "bhk", "type"]],
  ["budget", ["budgetaed", "budgetinr", "budget", "budgetmin"]],
  ["notesShort", ["remarks", "message", "requirement"]],
  ["tags", ["tags"]],
  ["source", ["source"]],
  ["company", ["company"]],
  ["address", ["address"]],
  ["whoIsClient", ["whoisclient", "client", "clientinfo"]],
  ["categorization", ["categorization", "category"]],
  ["remarks", ["remarks", "remark"]],
  ["status", ["status"]],
  ["potential", ["potential"]],
  ["fundReadiness", ["fundreadiness", "fund"]],
  ["moodStatus", ["moodstatus", "mood"]],
  ["whenCanInvest", ["whencaninvest", "timeline"]],
];

async function main() {
  const all = await prisma.lead.findMany({
    where: { rawImport: { not: { equals: null } as any } },
    select: { id: true, name: true, deletedAt: true, importBatchId: true, rawImport: true,
      city: true, budgetRaw: true, remarks: true },
  });

  const affected = all.filter((l) => {
    const ri = l.rawImport as Record<string, unknown> | null;
    return ri && Object.keys(ri).some((k) => norm(k) === "");
  });

  console.log(`\nTotal leads with rawImport: ${all.length}`);
  console.log(`AFFECTED (rawImport has ≥1 blank-normalized header): ${affected.length}`);
  console.log(`  …of which soft-deleted: ${affected.filter((l) => l.deletedAt).length}`);

  // Group by batch.
  const byBatch = new Map<string, number>();
  for (const l of affected) byBatch.set(l.importBatchId ?? "(none)", (byBatch.get(l.importBatchId ?? "(none)") ?? 0) + 1);
  console.log(`\nAffected by import batch:`);
  for (const [b, n] of byBatch) {
    const batch = b !== "(none)" ? await prisma.importBatch.findUnique({ where: { id: b }, select: { fileName: true, createdAt: true } }) : null;
    console.log(`  ${n.toString().padStart(4)}  ${b}  ${batch?.fileName ?? ""}  ${batch?.createdAt?.toISOString() ?? ""}`);
  }

  // Per-lead simulation (cap at 6 for readability).
  for (const l of affected.slice(0, 6)) {
    const row = l.rawImport as Row;
    const blankKeys = Object.keys(row).filter((k) => norm(k) === "");
    console.log(`\n\n── ${l.name}  (${l.id})${l.deletedAt ? "  [DELETED]" : ""} ──`);
    console.log(`   blank-header keys: ${JSON.stringify(blankKeys)} = ${JSON.stringify(blankKeys.map((k) => row[k]))}`);
    console.log(`   ${"field".padEnd(15)} ${"ORIGINAL(buggy)".padEnd(24)} ${"FIXED".padEnd(24)}`);
    for (const [f, cands] of FIELDS) {
      const o = pickOrig(row, ...cands);
      const x = pickFix(row, ...cands);
      const flag = o !== x ? "  ← CHANGES" : "";
      console.log(`   ${f.padEnd(15)} ${String(o ?? "∅").slice(0, 22).padEnd(24)} ${String(x ?? "∅").slice(0, 22).padEnd(24)}${flag}`);
    }
    console.log(`   DB now:  city=${JSON.stringify(l.city)}  budgetRaw=${JSON.stringify(l.budgetRaw)}  remarks=${JSON.stringify(String(l.remarks ?? "").slice(0, 30))}`);
  }
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
