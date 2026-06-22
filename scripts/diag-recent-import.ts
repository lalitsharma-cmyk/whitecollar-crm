// READ-ONLY: inspect the most recent import batches + whether remarks reached
// Conversation History (rawRemarks).  npx tsx scripts/diag-recent-import.ts
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  const batches = await prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 6,
    select: { id: true, fileName: true, createdAt: true, createdCount: true, updatedCount: true, importedById: true } });
  console.log(`\nMost recent import batches:`);
  for (const b of batches) console.log(`  ${b.createdAt.toISOString()}  created:${b.createdCount} updated:${b.updatedCount}  ${b.fileName}  [${b.id}]`);

  // Sample leads from the two most recent batches.
  for (const b of batches.slice(0, 2)) {
    const leads = await prisma.lead.findMany({ where: { importBatchId: b.id },
      select: { id: true, name: true, owner: { select: { name: true } }, rawRemarks: true, remarks: true, notesShort: true, customFields: true, rawImport: true }, take: 4 });
    console.log(`\n\n══ batch ${b.fileName} (${leads.length} sampled) ══`);
    for (const l of leads) {
      console.log(`\n  ▸ ${l.name}  (owner: ${l.owner?.name ?? "—"})`);
      console.log(`     rawRemarks: ${l.rawRemarks ? `${l.rawRemarks.length} chars → ${JSON.stringify(l.rawRemarks.slice(0, 80))}` : "∅ MISSING"}`);
      console.log(`     remarks:    ${l.remarks ? `${l.remarks.length} chars` : "∅"}   notesShort: ${l.notesShort ? `${l.notesShort.length} chars` : "∅"}`);
      const cf = l.customFields as Record<string, unknown> | null;
      console.log(`     customFields keys: ${cf ? JSON.stringify(Object.keys(cf)) : "∅"}`);
      const ri = l.rawImport as Record<string, unknown> | null;
      console.log(`     rawImport headers: ${ri ? JSON.stringify(Object.keys(ri)) : "∅ (no rawImport!)"}`);
      // Look for any header that smells like remarks/conversation but didn't map.
      if (ri) {
        const remarkish = Object.keys(ri).filter((k) => /remark|conversation|history|note|comment|follow|detail|status/i.test(k));
        if (remarkish.length) console.log(`     ⚠ remark-like columns in sheet: ${JSON.stringify(remarkish.map((k) => [k, String(ri[k]).slice(0, 40)]))}`);
      }
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
