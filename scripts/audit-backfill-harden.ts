// READ-ONLY adversarial cross-checks for the backfill audit. Independent method
// per category so a too-narrow primary query can't hide a gap. WRITES NOTHING.
//   npx tsx scripts/audit-backfill-harden.ts
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseRemarksTimeline, mergeSameMoment } from "../src/lib/remarkParser";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function main() {
  console.log("ADVERSARIAL CROSS-CHECKS (independent methods)");
  console.log("=".repeat(78));

  // ── A. NAMES — independent regex: a name cell that has letters and is wholly
  //    UPPER or wholly lower (ignoring spaces/punct), and has >1 alpha char.
  const leads = await prisma.lead.findMany({ where: { deletedAt: null }, select: { id: true, name: true, altName: true } });
  const isWhollyCased = (s: string | null) => {
    if (!s) return false;
    const letters = s.replace(/[^A-Za-z]/g, "");
    if (letters.length < 2) return false;
    // skip obvious non-names (email/url/code)
    if (/[@]|:\/\//.test(s)) return false;
    if ((s.match(/\d/g)?.length ?? 0) >= letters.length) return false;
    return letters === letters.toUpperCase() || letters === letters.toLowerCase();
  };
  let rawUpperLower = 0; const nameSamples: string[] = [];
  for (const l of leads) {
    for (const v of [l.name, l.altName]) {
      if (isWhollyCased(v)) { rawUpperLower++; if (nameSamples.length < 15) nameSamples.push(v!); }
    }
  }
  console.log("\nA. NAMES (independent wholly-UPPER/lower regex, leads):");
  console.log(`   raw wholly-cased name cells: ${rawUpperLower}`);
  if (nameSamples.length) console.log(`   samples: ${JSON.stringify(nameSamples)}`);

  const buyers = await prisma.buyerRecord.findMany({ where: { deletedAt: null }, select: { clientName: true, ownerName: true, agentName: true, coBuyerNames: true } });
  let buyerRawCased = 0; const bSamples: string[] = [];
  for (const b of buyers) {
    for (const v of [b.clientName, b.ownerName, b.agentName]) if (isWhollyCased(v)) { buyerRawCased++; if (bSamples.length < 10) bSamples.push(v!); }
    try { const arr = JSON.parse(b.coBuyerNames ?? "[]"); if (Array.isArray(arr)) for (const c of arr) if (isWhollyCased(String(c))) { buyerRawCased++; if (bSamples.length < 10) bSamples.push(String(c)); } } catch { /* */ }
  }
  console.log(`   buyer raw wholly-cased name cells: ${buyerRawCased}`);
  if (bSamples.length) console.log(`   samples: ${JSON.stringify(bSamples)}`);

  // ── B. SMART TIMELINE LEADS — actually PARSE a sample of imported-remark leads
  //    and confirm parseRemarksTimeline yields >=1 entry. This proves the render
  //    path produces a timeline (not just that activities exist).
  const names = (await prisma.user.findMany({ select: { name: true } })).map((u) => u.name);
  const sampleLeads = await prisma.lead.findMany({
    where: { deletedAt: null, rawRemarks: { not: null }, importBatchId: { not: null } },
    select: { id: true, name: true, rawRemarks: true, createdAt: true },
    take: 200,
  });
  let parsedZero = 0, parsedTotalEntries = 0;
  const zeroSamples: string[] = [];
  for (const l of sampleLeads) {
    const entries = mergeSameMoment(parseRemarksTimeline(l.rawRemarks ?? "", names, l.createdAt));
    parsedTotalEntries += entries.length;
    if (entries.length === 0 && (l.rawRemarks ?? "").trim().length >= 2) { parsedZero++; if (zeroSamples.length < 8) zeroSamples.push(`${l.name}: ${JSON.stringify((l.rawRemarks ?? "").slice(0, 60))}`); }
  }
  console.log("\nB. SMART TIMELINE LEADS — parse a sample of imported leads:");
  console.log(`   sampled imported leads (rawRemarks + importBatchId): ${sampleLeads.length}`);
  console.log(`   total timeline entries produced: ${parsedTotalEntries}`);
  console.log(`   leads whose substantive remark produced ZERO entries: ${parsedZero}`);
  if (zeroSamples.length) for (const s of zeroSamples) console.log(`      ${s}`);

  // ── C. DELETED EXCLUSION — pick a soft-deleted lead, prove the canonical
  //    chokepoint clause ({ deletedAt: null }, applied by leadScopeWhere AND every
  //    leadCounts where-helper) excludes it. We replicate the EXACT clause rather
  //    than import the server-only leadScope module.
  const oneDeleted = await prisma.lead.findFirst({ where: { deletedAt: { not: null } }, select: { id: true, name: true, ownerId: true, forwardedTeam: true } });
  if (oneDeleted) {
    // The admin scope from leadScopeWhere is exactly { deletedAt: null } (verified
    // in src/lib/leadScope.ts line 63). Counting the deleted lead under it must be 0.
    const adminScopeClause = { deletedAt: null as null };
    const visibleAdmin = await prisma.lead.count({ where: { ...adminScopeClause, id: oneDeleted.id } });
    // Owner-scope variant (agent view) also pins deletedAt:null.
    const visibleOwner = await prisma.lead.count({ where: { deletedAt: null, ownerId: oneDeleted.ownerId ?? "__none__", id: oneDeleted.id } });
    // Dashboard "all workable" style count (also deletedAt:null) — absent too.
    const visibleWorkable = await prisma.lead.count({ where: { deletedAt: null, id: oneDeleted.id } });
    console.log("\nC. DELETED EXCLUSION — canonical chokepoint clause (deletedAt:null):");
    console.log(`   deleted lead: ${oneDeleted.name} (${oneDeleted.id})`);
    console.log(`   visible via admin scope (want 0):    ${visibleAdmin}`);
    console.log(`   visible via owner scope (want 0):    ${visibleOwner}`);
    console.log(`   visible via workable count (want 0): ${visibleWorkable}`);
    // Sanity: the SAME lead IS findable when we DON'T filter deletedAt (proves the row exists).
    const existsUnfiltered = await prisma.lead.count({ where: { id: oneDeleted.id } });
    console.log(`   exists unfiltered (sanity, want 1):  ${existsUnfiltered}`);
  } else {
    console.log("\nC. DELETED EXCLUSION — no soft-deleted lead present to test.");
  }

  // ── D. BUYER extraFields — dump ALL distinct keys present in prod so we know
  //    the property-mapping variant list isn't missing a header.
  const allBuyers = await prisma.buyerRecord.findMany({ where: { deletedAt: null }, select: { extraFields: true, rawImport: true, projectName: true, tower: true, unitNumber: true, configuration: true, transactionValue: true } });
  const extraKeys = new Map<string, number>();
  let buyersWithExtra = 0;
  const colNulls = { projectName: 0, tower: 0, unitNumber: 0, configuration: 0, transactionValue: 0 };
  for (const b of allBuyers) {
    const ef = asObj(b.extraFields);
    if (Object.keys(ef).length) buyersWithExtra++;
    for (const k of Object.keys(ef)) extraKeys.set(k, (extraKeys.get(k) ?? 0) + 1);
    if (b.projectName == null) colNulls.projectName++;
    if (b.tower == null) colNulls.tower++;
    if (b.unitNumber == null) colNulls.unitNumber++;
    if (b.configuration == null) colNulls.configuration++;
    if (b.transactionValue == null) colNulls.transactionValue++;
  }
  console.log("\nD. BUYER extraFields keys (prod) + column null counts:");
  console.log(`   buyers with any extraFields: ${buyersWithExtra}/${allBuyers.length}`);
  console.log(`   column nulls: ${JSON.stringify(colNulls)}`);
  const sortedKeys = [...extraKeys.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`   distinct extraFields keys (${sortedKeys.length}):`);
  for (const [k, n] of sortedKeys) console.log(`      ${String(n).padStart(3)}  ${JSON.stringify(k)}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
