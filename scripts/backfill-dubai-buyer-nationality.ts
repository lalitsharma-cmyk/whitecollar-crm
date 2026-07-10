// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME backfill: infer Nationality from phone PREFIX for DUBAI Buyer Data only.
//   normalized phone starts 44 → "United Kingdom" · starts 65 → "Singapore".
// SCOPE (hard): market="Dubai", deletedAt=null, and nationality is EMPTY/NULL/"unknown"
//   ONLY. NEVER overwrites a real nationality. NOT leads/india/revival/master.
// SAFETY: dry-run by default; --apply writes + snapshots a JSON backup + logs ONE
//   OperationLog row PER country (buyer.edit, field=nationality) so the whole backfill
//   is revertable from Admin → Operations. Prefix-only match (never middle/end digits).
//
//   npx tsx scripts/backfill-dubai-buyer-nationality.ts          # dry-run (counts + samples)
//   npx tsx scripts/backfill-dubai-buyer-nationality.ts --apply  # write to prod
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const env = readFileSync("C:/Users/Lenovo/whitecollar-crm/.env", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("no DATABASE_URL");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

type Country = "United Kingdom" | "Singapore";

// Normalize a raw phone to country-code digits: keep digits, drop a leading "+" or
// "00" international prefix, and canonicalize the UK national trunk (07XXXXXXXXX, 11
// digits) to 447XXXXXXXXX. This is what makes +447…, 447…, and 07… all read as UK.
function normalizePhone(raw: string): string {
  let s = String(raw ?? "").replace(/[^\d+]/g, "");
  s = s.replace(/^\+/, "").replace(/^00/, "");
  if (/^07\d{9}$/.test(s)) s = "44" + s.slice(1); // UK 0-trunk mobile → 44…
  return s;
}
// Country by PREFIX ONLY (with a total-length sanity band so a stray "44"/"65" mid-noise
// can't false-match). UK = 44 + 9..11 digits; SG = 65 + 7..9 digits.
function countryFromPhone(norm: string): Country | null {
  if (norm.startsWith("44") && norm.length >= 11 && norm.length <= 13) return "United Kingdom";
  if (norm.startsWith("65") && norm.length >= 9 && norm.length <= 11) return "Singapore";
  return null;
}
function firstPhone(phones: string | null): string {
  if (!phones) return "";
  try { const a = JSON.parse(phones); if (Array.isArray(a)) return String(a.find((x) => String(x ?? "").trim()) ?? ""); } catch { /* not JSON */ }
  return String(phones).split(/[;,]/)[0]?.trim() ?? "";
}
const isBlankNat = (n: string | null) => {
  const s = (n ?? "").trim().toLowerCase();
  return s === "" || s === "unknown" || s === "n/a" || s === "na" || s === "-";
};

async function main() {
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — Dubai Buyer nationality backfill (phone prefix 44→UK, 65→SG)\n`);
  const rows = await prisma.buyerRecord.findMany({
    where: { deletedAt: null, market: "Dubai" },
    select: { id: true, clientName: true, nationality: true, phones: true },
  });

  const plan: Record<Country, { id: string; name: string; phone: string; norm: string; before: string | null }[]> = {
    "United Kingdom": [], "Singapore": [],
  };
  let scanned = 0, eligibleBlank = 0;
  for (const r of rows) {
    scanned++;
    if (!isBlankNat(r.nationality)) continue; // never overwrite a real nationality
    eligibleBlank++;
    const phone = firstPhone(r.phones);
    const norm = normalizePhone(phone);
    const country = countryFromPhone(norm);
    if (!country) continue;
    plan[country].push({ id: r.id, name: r.clientName, phone, norm, before: r.nationality ?? null });
  }

  console.log(`Scanned ${scanned} live Dubai buyers · ${eligibleBlank} have empty/null/unknown nationality.`);
  for (const c of ["United Kingdom", "Singapore"] as Country[]) {
    console.log(`\n▶ ${c}: ${plan[c].length} record(s) will be set`);
    for (const p of plan[c].slice(0, 8)) console.log(`   ${p.name}  phone="${p.phone}" → norm="${p.norm}"`);
    if (plan[c].length > 8) console.log(`   … and ${plan[c].length - 8} more`);
  }

  if (!APPLY) { console.log(`\nDRY-RUN — nothing written. Re-run with --apply.`); await prisma.$disconnect(); return; }

  const admin = await prisma.user.findFirst({ where: { OR: [{ isSuperAdmin: true }, { role: "ADMIN" }], active: true }, orderBy: { isSuperAdmin: "desc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("no admin user to attribute the OperationLog to");

  // Backup the full before-state of every touched buyer.
  mkdirSync("C:/Users/Lenovo/whitecollar-crm/backups", { recursive: true });
  const TS = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`C:/Users/Lenovo/whitecollar-crm/backups/backfill-dubai-nationality-${TS}.json`, JSON.stringify(plan, null, 2));
  console.log(`\n🔒 Backup → backups/backfill-dubai-nationality-${TS}.json`);

  const result: Record<Country, number> = { "United Kingdom": 0, "Singapore": 0 };
  for (const c of ["United Kingdom", "Singapore"] as Country[]) {
    const items = plan[c];
    if (items.length === 0) continue;
    const ids = items.map((p) => p.id);
    // OperationLog (revertable via Admin → Operations): buyer.edit on nationality.
    await prisma.operationLog.create({
      data: {
        operation: "buyer.edit", entityType: "BuyerRecord", module: "Dubai Buyer Data",
        field: "nationality", summary: `Backfill Nationality → ${c} (${ids.length} buyers, phone prefix ${c === "United Kingdom" ? "44" : "65"})`,
        status: "EXECUTED", affectedCount: ids.length,
        affectedIds: ids,
        beforeState: items.map((p) => ({ id: p.id, nationality: p.before })),
        afterState: { nationality: c },
        createdById: admin.id,
      },
    });
    const res = await prisma.buyerRecord.updateMany({
      where: { id: { in: ids }, deletedAt: null, market: "Dubai" },
      data: { nationality: c },
    });
    result[c] = res.count;
  }
  console.log(`\n✅ APPLIED — United Kingdom: ${result["United Kingdom"]} · Singapore: ${result["Singapore"]} updated.`);
  console.log(`   Revert either batch anytime from Admin → Operations (2 OperationLog rows written, attributed to ${admin.name}).`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
