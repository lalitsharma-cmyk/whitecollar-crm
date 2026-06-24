// READ-ONLY spot-check of REAL old records: prove name cased, source/medium split,
// Smart Timeline present (render-time parse), property mapped. WRITES NOTHING.
//   npx tsx scripts/audit-spotcheck.ts
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseRemarksTimeline, mergeSameMoment } from "../src/lib/remarkParser";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const istFmt = (d: Date | null) => d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d) : "∅";

async function main() {
  const names = (await prisma.user.findMany({ select: { name: true } })).map((u) => u.name);

  console.log("REAL OLD-RECORD SPOT-CHECKS");
  console.log("=".repeat(78));

  // ── 1) A June-import lead with imported remarks (Smart Timeline render path) ──
  const importLead = await prisma.lead.findFirst({
    where: { deletedAt: null, importBatchId: { not: null }, rawRemarks: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, source: true, medium: true, sourceRaw: true, sourceDetail: true, createdAt: true, rawRemarks: true, _count: { select: { activities: true, callLogs: true } } },
  });
  if (importLead) {
    const entries = mergeSameMoment(parseRemarksTimeline(importLead.rawRemarks ?? "", names, importLead.createdAt));
    console.log(`\n[1] IMPORT LEAD — ${importLead.name}  (id ${importLead.id})`);
    console.log(`    name cased: "${importLead.name}"  (proper-case ✓ if not ALL-CAPS)`);
    console.log(`    source=${importLead.source} · medium=${importLead.medium ?? "—"} · sourceRaw=${JSON.stringify(importLead.sourceRaw)} · propertyEnquired=${JSON.stringify(importLead.sourceDetail)}`);
    console.log(`    createdAt (IST): ${istFmt(importLead.createdAt)}`);
    console.log(`    Smart Timeline entries parsed from rawRemarks: ${entries.length}`);
    for (const e of entries.slice(0, 4)) console.log(`       • ${istFmt(e.date)} ${e.agentName ? `[${e.agentName}] ` : ""}${e.eventType}  ${JSON.stringify(e.text.slice(0, 56))}`);
    console.log(`    stored Activity rows: ${importLead._count.activities} · callLogs: ${importLead._count.callLogs}`);
  }

  // ── 2) A website lead (medium/source path + message-as-conversation) ─────────
  const webLead = await prisma.lead.findFirst({
    where: { deletedAt: null, source: "WEBSITE", medium: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, source: true, medium: true, sourceRaw: true, createdAt: true, rawRemarks: true },
  });
  if (webLead) {
    const entries = mergeSameMoment(parseRemarksTimeline(webLead.rawRemarks ?? "", names, webLead.createdAt));
    console.log(`\n[2] WEBSITE LEAD — ${webLead.name}  (id ${webLead.id})`);
    console.log(`    source=${webLead.source} · medium=${webLead.medium} · sourceRaw=${JSON.stringify(webLead.sourceRaw)}`);
    console.log(`    createdAt (IST): ${istFmt(webLead.createdAt)} · timeline entries: ${entries.length}`);
  }

  // ── 3) A previously-WhatsApp/Call lead (now WEBSITE + medium) if any has medium set ──
  const medLead = await prisma.lead.findFirst({
    where: { deletedAt: null, medium: { in: ["WhatsApp", "Call"] } },
    select: { id: true, name: true, source: true, medium: true, sourceRaw: true },
  });
  console.log(`\n[3] MEDIUM-SPLIT LEAD — ${medLead?.name ?? "(none with WhatsApp/Call medium)"}`);
  if (medLead) console.log(`    source=${medLead.source} (want WEBSITE) · medium=${medLead.medium} · sourceRaw=${JSON.stringify(medLead.sourceRaw)}`);

  // ── 4) A buyer just backfilled (configuration + size now populated) ──────────
  const buyer = await prisma.buyerRecord.findFirst({
    where: { deletedAt: null, market: "Dubai", configuration: { not: null }, size: { not: null } },
    select: { id: true, clientName: true, market: true, projectName: true, configuration: true, size: true, actualSize: true, propertyType: true, _count: { select: { activities: true } } },
  });
  if (buyer) {
    console.log(`\n[4] BUYER (backfilled) — ${buyer.clientName}  (id ${buyer.id})`);
    console.log(`    market=${buyer.market} · project=${JSON.stringify(buyer.projectName)} · propertyType=${JSON.stringify(buyer.propertyType)}`);
    console.log(`    configuration="${buyer.configuration}" · size="${buyer.size}" · actualSize=${JSON.stringify(buyer.actualSize)}`);
    console.log(`    name cased: "${buyer.clientName}" · BuyerActivity rows: ${buyer._count.activities}`);
  }

  // ── 5) A buyer with imported Smart Timeline (BuyerActivity imported rows) ─────
  const buyer2 = await prisma.buyerRecord.findFirst({
    where: { deletedAt: null, activities: { some: { description: { contains: "(imported)" } } } },
    select: { id: true, clientName: true, remarks: true, activities: { where: { description: { contains: "(imported)" } }, select: { type: true, description: true, createdAt: true }, take: 4, orderBy: { createdAt: "asc" } } },
  });
  if (buyer2) {
    console.log(`\n[5] BUYER (Smart Timeline) — ${buyer2.clientName}  (id ${buyer2.id})`);
    console.log(`    remarks: ${JSON.stringify((buyer2.remarks ?? "").slice(0, 70))}`);
    for (const a of buyer2.activities) console.log(`       • ${istFmt(a.createdAt)} ${a.type}  ${JSON.stringify((a.description ?? "").slice(0, 56))}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
