// ─────────────────────────────────────────────────────────────────────────────
// backfill-buyer-status-followup.ts — retroactively populate the NEW additive
// BuyerRecord columns (businessStatus, followupDate) from each buyer's already-
// imported data, so existing buyers behave like freshly-imported ones.
//
// SOURCE: the imported Status / Follow-Up values already sit in extraFields (and,
// verbatim, in rawImport). This reads them and:
//   • businessStatus ← the imported Status value (verbatim, trimmed)
//   • followupDate   ← parseImportDate(imported Follow-Up)  [Excel serial incl.
//                       decimals / dd-mm-yyyy / ISO; unparseable values skipped]
//
// SAFETY (PRODUCTION SAFETY + DATA-CONSISTENCY rules):
//   • ADDITIVE — writes ONLY the two new columns; never touches remarks/history or
//     any existing column.
//   • FILL-ONLY — updates a column only when it is currently NULL, so a later manual
//     edit is never clobbered ("never overwrite good data with blank").
//   • IDEMPOTENT — re-running converges (already-filled rows are skipped).
//   • Run backup-buyers.ts FIRST (this script asserts a backup exists).
//
//   npx tsx scripts/backfill-buyer-status-followup.ts            # dry-run
//   npx tsx scripts/backfill-buyer-status-followup.ts --apply    # write to prod
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseFollowupDate } from "../src/lib/parseImportDate";

const APPLY = process.argv.includes("--apply");

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const STATUS_KEYS = ["status", "lead status", "buyer status", "current status", "status 2", "status2"];
const FOLLOWUP_KEYS = ["follow-up", "followup", "follow up", "next follow up", "follow up date", "followup date", "follow-up date", "next followup"];

function findVal(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  // Normalize then iterate KEYS in priority order (primary "status" beats "status 2"),
  // mirroring the import route's pickByKeys so backfill + import agree.
  const norm = new Map<string, string>();
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const s = String(v ?? "").trim();
    if (s) norm.set(k.trim().toLowerCase(), s);
  }
  for (const key of keys) {
    const v = norm.get(key);
    if (v) return v;
  }
  return null;
}

async function main() {
  // Guard: require a buyer backup to exist before any write.
  const hasBackup = existsSync("backups") && readdirSync("backups").some((d) => d.startsWith("buyers-"));
  if (APPLY && !hasBackup) throw new Error("No backups/buyers-* snapshot found — run scripts/backup-buyers.ts first.");

  const buyers = await prisma.buyerRecord.findMany({
    where: { deletedAt: null },
    select: { id: true, clientName: true, businessStatus: true, followupDate: true, extraFields: true, rawImport: true },
  });

  let statusFills = 0, followupFills = 0, followupUnparseable = 0, skippedAlreadySet = 0;
  const samples: string[] = [];

  for (const b of buyers) {
    const data: { businessStatus?: string; followupDate?: Date } = {};

    if (b.businessStatus == null) {
      const status = findVal(b.extraFields, STATUS_KEYS) ?? findVal(b.rawImport, STATUS_KEYS);
      if (status) { data.businessStatus = status.slice(0, 200); statusFills++; }
    } else skippedAlreadySet++;

    if (b.followupDate == null) {
      const fuRaw = findVal(b.extraFields, FOLLOWUP_KEYS) ?? findVal(b.rawImport, FOLLOWUP_KEYS);
      if (fuRaw) {
        const d = parseFollowupDate(fuRaw);
        if (d) { data.followupDate = d; followupFills++; }
        else followupUnparseable++;
      }
    }

    if (Object.keys(data).length && samples.length < 8) {
      samples.push(`  ${b.clientName.slice(0, 24).padEnd(24)} status=${data.businessStatus ?? "—"} followup=${data.followupDate ? data.followupDate.toISOString().slice(0, 10) : "—"}`);
    }
    if (APPLY && Object.keys(data).length) {
      await prisma.buyerRecord.update({ where: { id: b.id }, data });
    }
  }

  console.log(`Mode: ${APPLY ? "APPLY (writing to prod)" : "DRY-RUN (no writes)"}`);
  console.log(`Scanned live buyers: ${buyers.length}`);
  console.log(`  businessStatus to fill: ${statusFills}   (already-set, skipped: ${skippedAlreadySet})`);
  console.log(`  followupDate to fill:   ${followupFills}   (unparseable follow-up skipped: ${followupUnparseable})`);
  console.log("Samples:");
  console.log(samples.join("\n") || "  (none)");

  if (APPLY) {
    const withStatus = await prisma.buyerRecord.count({ where: { deletedAt: null, businessStatus: { not: null } } });
    const withFollowup = await prisma.buyerRecord.count({ where: { deletedAt: null, followupDate: { not: null } } });
    console.log(`\nPost-apply: buyers with businessStatus=${withStatus}, with followupDate=${withFollowup}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
