// ─────────────────────────────────────────────────────────────────────────────
// scripts/diag-import.ts — READ-ONLY diagnostic for the import regression.
//   npx tsx scripts/diag-import.ts
// Dumps the broken "Arjun" lead + a healthy older imported lead so we can see
// exactly which fields hold what, plus the verbatim rawImport row + activities.
// ZERO writes.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Load DATABASE_URL explicitly so this runs as a bare tsx script.
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

function show(label: string, lead: any) {
  console.log("\n\n══════════════════════════════════════════════════════════");
  console.log(`  ${label}`);
  console.log("══════════════════════════════════════════════════════════");
  const scalarKeys = [
    "id", "name", "altName", "phone", "altPhone", "email",
    "city", "country", "address", "company", "configuration",
    "budgetRaw", "budgetMin", "budgetMax", "budgetCurrency",
    "source", "sourceRaw", "sourceDetail",
    "status", "currentStatus", "originalSheetStatus",
    "potential", "fundReadiness", "moodStatus", "whenCanInvest",
    "categorization", "clientType", "whoIsClient",
    "forwardedTeam", "routingMethod", "routingSource", "routingReason",
    "tags", "leadOrigin", "isColdCall",
    "createdAt", "lastTouchedAt", "followupDate", "importBatchId",
    "notesShort",
  ];
  for (const k of scalarKeys) {
    const v = (lead as any)[k];
    if (v !== null && v !== undefined && v !== "") {
      const s = v instanceof Date ? v.toISOString() : String(v);
      console.log(`   ${k.padEnd(20)} = ${s.length > 200 ? s.slice(0, 200) + "…" : s}`);
    }
  }
  console.log("   ── remarks (display) ──");
  console.log("     " + String(lead.remarks ?? "∅").slice(0, 400).replace(/\n/g, "\n     "));
  console.log("   ── rawRemarks (immutable) ──");
  console.log("     " + String(lead.rawRemarks ?? "∅").slice(0, 400).replace(/\n/g, "\n     "));
  console.log("   ── customFields (→ Imported Fields card) ──");
  console.log("     " + JSON.stringify(lead.customFields ?? null, null, 2).replace(/\n/g, "\n     "));
  console.log("   ── rawImport (verbatim original row) ──");
  console.log("     " + JSON.stringify(lead.rawImport ?? null, null, 2).replace(/\n/g, "\n     "));
  console.log(`   ── activities (${lead.activities?.length ?? 0}) ──`);
  for (const a of lead.activities ?? []) {
    console.log(`     [${a.type}/${a.status}] ${a.title}  @${a.createdAt.toISOString()}`);
    if (a.description) console.log(`         desc: ${String(a.description).slice(0, 160)}`);
  }
}

async function main() {
  // The broken lead — most recent match on Arjun / Sach.
  const broken = await prisma.lead.findFirst({
    where: { OR: [{ name: { contains: "Arjun", mode: "insensitive" } }, { name: { contains: "Sach", mode: "insensitive" } }] },
    orderBy: { createdAt: "desc" },
    include: { activities: { orderBy: { createdAt: "asc" } } },
  });
  if (broken) show("BROKEN (newest Arjun/Sach lead)", broken);
  else console.log("No Arjun/Sach lead found.");

  // The batch this lead came in on — what else was in it, and its metadata.
  if (broken?.importBatchId) {
    const batch = await prisma.importBatch.findUnique({ where: { id: broken.importBatchId } });
    console.log("\n\n── IMPORT BATCH for broken lead ──");
    console.log(JSON.stringify(batch, null, 2));
  } else {
    console.log("\n\n── broken lead has NO importBatchId (not from CSV/Excel importer?) ──");
  }

  // A healthy older imported lead with a populated rawImport, for comparison.
  const healthy = await prisma.lead.findFirst({
    where: {
      rawImport: { not: { equals: null } as any },
      importBatchId: { not: null },
      id: { not: broken?.id ?? "" },
    },
    orderBy: { createdAt: "asc" },
    include: { activities: { orderBy: { createdAt: "asc" }, take: 8 } },
  });
  if (healthy) show("HEALTHY (older imported lead, for comparison)", healthy);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
