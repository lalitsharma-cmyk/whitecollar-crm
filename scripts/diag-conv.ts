// READ-ONLY. Compare a working old imported lead (has Raw History) vs a newly
// imported lead with NO conversation, to find the regression. ZERO writes.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

async function main() {
  const broken = await prisma.lead.findMany({
    where: { AND: [{ rawImport: { not: { equals: null } as never } }, { OR: [{ rawRemarks: null }, { rawRemarks: "" }] }, { OR: [{ remarks: null }, { remarks: "" }] }] },
    orderBy: { createdAt: "desc" }, take: 4,
    select: { name: true, createdAt: true, rawImport: true, customFields: true, owner: { select: { name: true } } },
  });
  console.log(`\nBROKEN (imported, no Raw History) — newest ${broken.length}:`);
  for (const l of broken) {
    const ri = l.rawImport as Record<string, unknown>;
    const keys = Object.keys(ri);
    console.log(`\n  ▸ ${l.name}  (${l.owner?.name ?? "—"})  ${l.createdAt.toISOString().slice(0, 16)}`);
    console.log(`     headers (norm): ${JSON.stringify(keys.map((k) => `${k}→${norm(k)}`))}`);
    const rk = keys.filter((k) => /remark|conversation|histor|note|comment|call|status/i.test(k));
    if (rk.length) console.log(`     conversation-ish cols: ${JSON.stringify(rk.map((k) => [k, String(ri[k]).slice(0, 45)]))}`);
    const blank = keys.filter((k) => norm(k) === "");
    if (blank.length) console.log(`     ⚠ BLANK-normalized headers: ${JSON.stringify(blank.map((k) => [JSON.stringify(k), String(ri[k]).slice(0, 45)]))}`);
    const cf = l.customFields as Record<string, unknown> | null;
    console.log(`     customFields keys: ${cf ? JSON.stringify(Object.keys(cf)) : "∅"}`);
  }

  const work = await prisma.lead.findFirst({
    where: { AND: [{ rawRemarks: { not: null } }, { rawRemarks: { not: "" } }, { rawImport: { not: { equals: null } as never } }] },
    orderBy: { createdAt: "asc" }, select: { name: true, rawImport: true, rawRemarks: true },
  });
  if (work) {
    const ri = work.rawImport as Record<string, unknown>;
    console.log(`\n\nWORKING (has Raw History): ${work.name}`);
    console.log(`   rawRemarks: ${JSON.stringify(String(work.rawRemarks).slice(0, 80))}`);
    console.log(`   FULL rawImport:`);
    for (const [k, v] of Object.entries(ri)) console.log(`      ${JSON.stringify(k)} = ${JSON.stringify(String(v).slice(0, 70))}`);
  }
  if (broken[0]) {
    const ri = broken[0].rawImport as Record<string, unknown>;
    console.log(`\n\nBROKEN full row (${broken[0].name}):`);
    for (const [k, v] of Object.entries(ri)) console.log(`      ${JSON.stringify(k)} = ${JSON.stringify(String(v).slice(0, 70))}`);
  }
  // Batch-level proof: does the most recent import batch's sheet contain ANY
  // conversation column, and did ANY lead in it get rawRemarks?
  const batch = await prisma.importBatch.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, fileName: true, createdCount: true } });
  if (batch) {
    const leads = await prisma.lead.findMany({ where: { importBatchId: batch.id }, select: { rawImport: true, rawRemarks: true } });
    const headerUnion = new Set<string>();
    let withConv = 0;
    for (const l of leads) {
      const ri = l.rawImport as Record<string, unknown> | null;
      if (ri) Object.keys(ri).forEach((k) => headerUnion.add(k));
      if (l.rawRemarks && l.rawRemarks.trim()) withConv++;
    }
    console.log(`\n\n══ LATEST BATCH: ${batch.fileName} ══`);
    console.log(`   leads: ${leads.length}  ·  with Raw History (rawRemarks): ${withConv}`);
    console.log(`   ALL columns seen across the batch: ${JSON.stringify([...headerUnion])}`);
    const conv = [...headerUnion].filter((k) => /remark|conversation|histor|comment|discuss/i.test(k));
    console.log(`   conversation columns present: ${conv.length ? JSON.stringify(conv) : "NONE"}`);

    // Per-column LONGEST value — reveals where free-text conversation actually lives.
    const longest: Record<string, { len: number; sample: string }> = {};
    for (const l of leads) {
      const ri = l.rawImport as Record<string, unknown> | null; if (!ri) continue;
      for (const [k, v] of Object.entries(ri)) { const s = String(v); if (!longest[k] || s.length > longest[k].len) longest[k] = { len: s.length, sample: s }; }
    }
    console.log(`\n   Longest value per column (where free-text conversation would show):`);
    for (const [k, info] of Object.entries(longest).sort((a, b) => b[1].len - a[1].len))
      console.log(`      ${String(info.len).padStart(4)}  ${k.padEnd(20)} ${JSON.stringify(info.sample.slice(0, 90))}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
