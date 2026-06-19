// ─────────────────────────────────────────────────────────────────────────────
// scripts/repair-import-leak.ts — repair leads corrupted by the blank-header leak.
//   npx tsx scripts/repair-import-leak.ts            (DRY-RUN: prints before/after)
//   npx tsx scripts/repair-import-leak.ts --apply     (writes, after backing up)
//
// SAFETY:
//   • Backs up every affected lead's FULL row to backups/ before any write.
//   • Surgical: only touches a field whose current value is the leaked blank-column
//     value (literal date) or a parse of it. Real values (e.g. İsmail's "Istanbul")
//     are left untouched.
//   • Restores the real Remarks into remarks + rawRemarks (→ Conversation History /
//     Raw History / Smart Timeline) and fixes the LEAD_CREATED activity description.
//   • Produces exactly what the FIXED importer would have written (order-independent
//     pick over the verbatim row).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

type Row = Record<string, string>;
function norm(s: string): string { return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }

// FIXED pick (order-independent for single-column fields) with consume tracking,
// mirroring the route's consume rule (exact match OR header is a prefix of candidate).
function pick(row: Row, consumed: Set<string> | null, ...candidates: string[]): string | undefined {
  const wanted = candidates.map(norm).filter(Boolean);
  for (const k of Object.keys(row)) {
    const nk = norm(k);
    if (!nk) continue;
    for (const t of wanted) {
      if (nk === t || nk.startsWith(t) || t.startsWith(nk)) {
        if (consumed && (nk === t || t.startsWith(nk))) consumed.add(k);
        const v = row[k]?.toString().trim();
        if (v) return v;
      }
    }
  }
}

// Replicated gsheet-route parsers — only used to recognise an enum that was derived
// from the leaked date (so we can null it). Verbatim from the route.
function parsePotential(s?: string) { if (!s) return; const n = norm(s); if (n.startsWith("h")) return "HIGH"; if (n.startsWith("m")) return "MEDIUM"; if (n.startsWith("l")) return "LOW"; }
function parseFund(s?: string) { if (!s) return; const n = norm(s); if (n.includes("cash")) return "CASH_READY"; if (n.includes("approved") || n.includes("bank")) return "BANK_APPROVED"; if (n.includes("financ") || n.includes("loan")) return "FINANCING_NEEDED"; return "NOT_DISCUSSED"; }
function parseMood(s?: string) { if (!s) return; const n = norm(s); if (n.includes("excit")) return "EXCITED"; if (n.includes("interest")) return "INTERESTED"; if (n.includes("neutral")) return "NEUTRAL"; if (n.includes("hesit")) return "HESITANT"; if (n.includes("cold")) return "COLD"; if (n.includes("confus")) return "CONFUSED"; if (n.includes("angry")) return "ANGRY"; }
function parseTimeline(s?: string) { if (!s) return; const n = norm(s); if (n.includes("immed") || n.includes("week") || n.includes("now")) return "IMMEDIATE"; if (n.includes("30day") || n.includes("month")) return "THIRTY_DAYS"; if (n.includes("3month") || n.includes("quarter")) return "THREE_MONTHS"; if (n.includes("6") || n.includes("year")) return "SIX_PLUS_MONTHS"; if (n.includes("brows") || n.includes("explor")) return "WINDOW_SHOPPING"; }

// All sheet columns the gsheet importer consumes, in route order — to rebuild customFields.
function computeConsumed(row: Row): Set<string> {
  const c = new Set<string>();
  pick(row, c, "customer", "name", "fullname", "leadname");
  pick(row, c, "mobile", "phone", "contact", "whatsapp");
  pick(row, c, "email", "emailid");
  pick(row, c, "city", "location");
  pick(row, c, "configuration", "config", "bhk", "type");
  pick(row, c, "budgetaed", "budgetinr", "budget", "budgetmin");
  pick(row, c, "budgetmax");
  pick(row, c, "remarks", "message", "requirement");
  pick(row, c, "tags");
  pick(row, c, "source");
  pick(row, c, "company");
  pick(row, c, "address");
  pick(row, c, "whoisclient", "client", "clientinfo");
  pick(row, c, "categorization", "category");
  pick(row, c, "remarks", "remark");
  pick(row, c, "stage");
  pick(row, c, "status");
  pick(row, c, "followupdate", "followup");
  pick(row, c, "meeting", "meetingdate");
  pick(row, c, "sitevisit");
  pick(row, c, "todo", "todonext", "nextaction");
  pick(row, c, "detailshared");
  pick(row, c, "potential");
  pick(row, c, "fundreadiness", "fund");
  pick(row, c, "moodstatus", "mood");
  pick(row, c, "whencaninvest", "timeline");
  pick(row, c, "forwardedteam", "team");
  pick(row, c, "project");
  pick(row, c, "currency");
  pick(row, c, "country");
  return c;
}

async function main() {
  const all = await prisma.lead.findMany({
    where: { rawImport: { not: { equals: null } as any } },
    include: { activities: { where: { type: "LEAD_CREATED" }, take: 1 } },
  });
  const affected = all.filter((l) => {
    const ri = l.rawImport as Record<string, unknown> | null;
    return ri && Object.keys(ri).some((k) => norm(k) === "");
  });

  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — ${affected.length} affected lead(s)\n`);
  if (affected.length === 0) { await prisma.$disconnect(); return; }

  // Backup full rows BEFORE any change.
  if (APPLY) {
    mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
    const stamp = "import-leak-repair";
    const path = new URL(`../backups/${stamp}.json`, import.meta.url);
    writeFileSync(path, JSON.stringify(affected, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    console.log(`🔒 Backed up ${affected.length} full rows → backups/${stamp}.json\n`);
  }

  let fixedCount = 0;
  for (const l of affected) {
    const row = l.rawImport as Row;
    const blankVals = Object.keys(row).filter((k) => norm(k) === "").map((k) => row[k]);
    const leakSet = new Set(blankVals.map((v) => String(v).trim()));
    const isLeak = (v: unknown) => v != null && leakSet.has(String(v).trim());

    const change: Record<string, unknown> = {};
    // ── String fields: fix only if the current value IS the leaked blank value ──
    const strFields: [string, string[]][] = [
      ["city", ["city", "location"]],
      ["address", ["address"]],
      ["company", ["company"]],
      ["configuration", ["configuration", "config", "bhk", "type"]],
      ["categorization", ["categorization", "category"]],
      ["whoIsClient", ["whoisclient", "client", "clientinfo"]],
      ["tags", ["tags"]],
      ["notesShort", ["remarks", "message", "requirement"]],
    ];
    for (const [f, cands] of strFields) {
      if (isLeak((l as any)[f])) change[f] = pick(row, null, ...cands) ?? null;
    }
    // ── Remarks / Raw History: restore the real remark when corrupted ──
    const realRemark = pick(row, null, "remarks", "remark") ?? null;
    if (isLeak(l.remarks)) change.remarks = realRemark;
    if (isLeak(l.rawRemarks)) change.rawRemarks = realRemark;
    // ── Budget: a leaked date parses to budgetRaw=date, budgetMin=number ──
    if (isLeak(l.budgetRaw)) {
      const realBudget = pick(row, null, "budgetaed", "budgetinr", "budget", "budgetmin");
      if (!realBudget) { change.budgetRaw = null; change.budgetMin = null; change.budgetMax = null; }
    }
    // ── Derived enums with NO real column that match a parse of the leak → null ──
    const leakStr = blankVals[0];
    if (l.potential && !pick(row, null, "potential") && l.potential === parsePotential(leakStr)) change.potential = null;
    if (l.fundReadiness && !pick(row, null, "fundreadiness", "fund") && l.fundReadiness === parseFund(leakStr)) change.fundReadiness = null;
    if (l.moodStatus && !pick(row, null, "moodstatus", "mood") && l.moodStatus === parseMood(leakStr)) change.moodStatus = null;
    if (l.whenCanInvest && !pick(row, null, "whencaninvest", "timeline") && l.whenCanInvest === parseTimeline(leakStr)) change.whenCanInvest = null;

    // ── Rebuild customFields = unmapped real columns (drop blank + now-mapped) ──
    const consumed = computeConsumed(row);
    const cleanCf: Record<string, string> = {};
    for (const k of Object.keys(row)) {
      if (norm(k) === "") continue;
      if (consumed.has(k)) continue;
      const v = row[k]?.toString().trim();
      if (v) cleanCf[k] = v;
    }
    const curCf = JSON.stringify(l.customFields ?? {});
    if (JSON.stringify(cleanCf) !== curCf) change.customFields = cleanCf;

    // ── LEAD_CREATED activity description leaked → real remark/notesShort ──
    const act = l.activities[0];
    const fixActivity = act && isLeak(act.description);
    const actDesc = (change.notesShort as string) ?? realRemark ?? null;

    if (Object.keys(change).length === 0 && !fixActivity) {
      console.log(`✓  ${l.name} — already clean, no change`);
      continue;
    }
    fixedCount++;
    console.log(`\n■ ${l.name}  (${l.id})   leaked value(s): ${JSON.stringify([...leakSet])}`);
    for (const [k, v] of Object.entries(change)) {
      const before = k === "customFields" ? curCf : JSON.stringify((l as any)[k]);
      const after = JSON.stringify(v);
      console.log(`    ${k.padEnd(15)} ${String(before).slice(0, 40).padEnd(42)} →  ${String(after).slice(0, 60)}`);
    }
    if (fixActivity) console.log(`    activity.desc   ${JSON.stringify(act.description).slice(0, 40).padEnd(42)} →  ${JSON.stringify(actDesc).slice(0, 60)}`);

    if (APPLY) {
      await prisma.lead.update({ where: { id: l.id }, data: change as any });
      if (fixActivity) await prisma.activity.update({ where: { id: act.id }, data: { description: actDesc } });
    }
  }

  console.log(`\n${APPLY ? "✅ APPLIED" : "DRY-RUN"} — ${fixedCount} lead(s) ${APPLY ? "repaired" : "would be repaired"}.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
