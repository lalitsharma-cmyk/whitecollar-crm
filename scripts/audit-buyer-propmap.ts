// READ-ONLY: precise buyer property-mapping gap analysis. For each candidate
// extraFields key, show how many buyers have a real value there WHILE the target
// column is null. Decide only CLEAR mappings. WRITES NOTHING.
//   npx tsx scripts/audit-buyer-propmap.ts
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
function asObj(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }
const JUNK = new Set(["", "na", "n/a", "none", "null", "-", "nil", "tbd"]);
const real = (v: unknown) => { const s = String(v ?? "").trim(); return s && !JUNK.has(s.toLowerCase()) ? s : null; };

async function main() {
  const buyers = await prisma.buyerRecord.findMany({
    where: { deletedAt: null },
    select: {
      id: true, clientName: true, projectName: true, tower: true, unitNumber: true,
      configuration: true, propertyType: true, size: true, actualSize: true,
      transactionValue: true, area: true, extraFields: true, rawImport: true,
    },
  });
  console.log(`Live buyers: ${buyers.length}\n`);

  // Candidate mappings: extraFields key (exact) → target column. Only CLEAR ones.
  const candidates: Array<{ key: string; col: keyof (typeof buyers)[number]; note: string }> = [
    { key: "Flat Typology", col: "configuration", note: "config like '2BR'/'3BR+M' — clear" },
    { key: "Property Type", col: "propertyType", note: "Residential/Commercial — clear" },
    { key: "Saleable Area", col: "size", note: "area as written — clear (size field)" },
    { key: "Size(MM)", col: "actualSize", note: "secondary size — clear (actualSize)" },
    { key: "Sub Project", col: "tower", note: "AMBIGUOUS — sub-project name, NOT a tower; report only" },
    { key: "Developer", col: "tower", note: "AMBIGUOUS — developer != tower; report only" },
  ];

  for (const c of candidates) {
    let colNull = 0, keyHasVal = 0, gap = 0;
    const samples: string[] = [];
    for (const b of buyers) {
      const blob = { ...asObj(b.rawImport), ...asObj(b.extraFields) };
      const cur = (b as Record<string, unknown>)[c.col as string];
      const curNull = cur == null || (typeof cur === "string" && cur.trim() === "");
      const val = real(blob[c.key]);
      if (curNull) colNull++;
      if (val) keyHasVal++;
      if (curNull && val) { gap++; if (samples.length < 6) samples.push(`${b.clientName}: ${String(c.col)} ← "${val}"`); }
    }
    console.log(`[${c.key}] → ${String(c.col)}  (${c.note})`);
    console.log(`   column null: ${colNull} · key has value: ${keyHasVal} · GAP (null col + value in key): ${gap}`);
    for (const s of samples) console.log(`      ${s}`);
    console.log("");
  }

  // Show the distinct VALUES present for the two clear-but-impactful keys so we
  // confirm they're sane before backfilling.
  const vals = (key: string) => {
    const m = new Map<string, number>();
    for (const b of buyers) { const v = real(asObj(b.extraFields)[key]); if (v) m.set(v, (m.get(v) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  console.log("Distinct 'Flat Typology' values:", JSON.stringify(vals("Flat Typology")));
  console.log("Distinct 'Property Type' values:", JSON.stringify(vals("Property Type")));
  console.log("Current propertyType column distribution:");
  const pt = await prisma.buyerRecord.groupBy({ by: ["propertyType"], where: { deletedAt: null }, _count: true });
  for (const r of pt) console.log(`   ${JSON.stringify(r.propertyType)}: ${r._count}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
