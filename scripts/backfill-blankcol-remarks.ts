// ─────────────────────────────────────────────────────────────────────────────
// Backfill conversation history for leads imported from a sheet that kept its
// conversation in a BLANK-HEADER column (Yasir, Dinesh). That column was dropped
// at import time, so it isn't in rawImport either — we MUST re-read the source
// xlsx. We match each source row to its imported lead BY PHONE (within the
// matching import batch) and set rawRemarks exactly as a fresh import would have.
//
// Raw History shows rawRemarks; Smart Timeline derives from it — both light up
// automatically once rawRemarks is set. We only ever fill a lead whose
// conversation is currently EMPTY, and back up every touched row first.
//
//   npx tsx scripts/backfill-blankcol-remarks.ts "<xlsx path>"          # dry-run
//   npx tsx scripts/backfill-blankcol-remarks.ts "<xlsx path>" --apply  # write
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { detectConversationColumn } from "../src/lib/conversationColumn";

const path = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!path) { console.error("Usage: tsx scripts/backfill-blankcol-remarks.ts <xlsx> [--apply]"); process.exit(1); }

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function looksLikeHeader(row: string[]): boolean {
  const flat = row.map((c) => norm(String(c ?? "")));
  const expected = ["customer", "mobile", "phone", "name", "email", "source", "stage", "remarks", "project", "budget"];
  return expected.filter((e) => flat.some((c) => c === e || c.startsWith(e))).length >= 3;
}
// Stable phone key = last 10 digits of each comma/slash-separated chunk.
function phoneKeys(s: string): string[] {
  const out = new Set<string>();
  for (const chunk of String(s ?? "").split(/[,/;\n|]+/)) {
    const d = chunk.replace(/\D/g, "");
    if (d.length >= 10) out.add(d.slice(-10));
  }
  return [...out];
}
const nameKey = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 22);

async function main() {
  // 1 ── Parse source sheet (first tab) exactly as the importer does.
  const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
  const tab = wb.SheetNames[0];
  const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[tab], { header: 1, defval: "", blankrows: false, raw: false }) as string[][];
  let hr = -1; for (let i = 0; i < Math.min(5, grid.length); i++) if (looksLikeHeader(grid[i])) { hr = i; break; }
  if (hr < 0) throw new Error("No header row detected in source sheet");
  const headers = grid[hr].map((h) => String(h ?? "").trim());
  const dataRows = grid.slice(hr + 1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const convCol = detectConversationColumn(headers, dataRows);
  if (convCol < 0) throw new Error("No unlabeled conversation column detected in source");
  const nameCol = headers.findIndex((h) => { const n = norm(h); return n === "name" || n.includes("customer") || n === "fullname"; });
  const phoneCol = headers.findIndex((h) => /mobile|contact|phone|whatsapp/i.test(h));
  console.log(`Source "${tab}" · header row ${hr} · name col ${nameCol} ("${headers[nameCol] ?? "?"}") · phone col ${phoneCol} ("${headers[phoneCol] ?? "?"}") · conv col ${convCol} («${headers[convCol] || "BLANK"}»)`);

  // 2 ── Index source rows by phone (primary) and name (fallback).
  type Src = { name: string; conv: string; phones: string[] };
  const byPhone = new Map<string, Src>();
  const byName = new Map<string, Src>();
  let withConv = 0;
  for (const r of dataRows) {
    const conv = String(r[convCol] ?? "").trim();
    if (!conv) continue;
    withConv++;
    const rec: Src = { name: String(r[nameCol] ?? "").trim(), conv, phones: phoneKeys(String(r[phoneCol] ?? "")) };
    for (const p of rec.phones) if (!byPhone.has(p)) byPhone.set(p, rec);
    const nk = nameKey(rec.name); if (nk && !byName.has(nk)) byName.set(nk, rec);
  }
  console.log(`Source rows with conversation: ${withConv} (unique phones ${byPhone.size}, names ${byName.size})`);

  // 3 ── Scope to the import batch(es) for this file (match by first word of name).
  const fileBase = path.split(/[\\/]/).pop()!.replace(/\.xlsx$/i, "");
  const keyword = fileBase.split(/\s+/)[0];
  const batches = await prisma.importBatch.findMany({ where: { fileName: { contains: keyword, mode: "insensitive" } }, select: { id: true, fileName: true } });
  console.log(`Matched batches for "${keyword}": ${batches.map((b) => b.fileName).join(", ") || "(none — falling back to phone match across all imported leads)"}`);
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, ...(batches.length ? { importBatchId: { in: batches.map((b) => b.id) } } : { importBatchId: { not: null } }) },
    select: { id: true, name: true, phone: true, altPhone: true, rawRemarks: true, remarks: true },
  });
  console.log(`Candidate leads in scope: ${leads.length}`);

  // 4 ── Match + plan (only leads whose conversation is currently EMPTY).
  const plan: { id: string; name: string; conv: string; remarksEmpty: boolean; via: string }[] = [];
  let already = 0, noMatch = 0;
  for (const l of leads) {
    let src: Src | undefined, via = "";
    for (const p of [...phoneKeys(l.phone ?? ""), ...phoneKeys(l.altPhone ?? "")]) { const s = byPhone.get(p); if (s) { src = s; via = `phone ${p}`; break; } }
    if (!src) { const s = byName.get(nameKey(l.name ?? "")); if (s) { src = s; via = "name"; } }
    if (!src) { noMatch++; continue; }
    if ((l.rawRemarks ?? "").trim().length > 0) { already++; continue; }   // never overwrite existing conversation
    plan.push({ id: l.id, name: l.name ?? "—", conv: src.conv, remarksEmpty: (l.remarks ?? "").trim().length === 0, via });
  }
  console.log(`\nPLAN: backfill ${plan.length} leads · ${already} already have conversation (skipped) · ${noMatch} no source match`);
  plan.slice(0, 6).forEach((p) => console.log(`   ▸ ${p.name}  (${p.via})  ← ${JSON.stringify(p.conv.slice(0, 72))}`));

  if (!APPLY) { console.log(`\nDRY-RUN — re-run with --apply to write.`); await prisma.$disconnect(); return; }

  // 5 ── Backup current values, then write rawRemarks (verbatim, as a fresh import would).
  const backup = await prisma.lead.findMany({ where: { id: { in: plan.map((p) => p.id) } }, select: { id: true, name: true, rawRemarks: true, remarks: true } });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupUrl = new URL(`../backups/backfill-blankcol-${fileBase.replace(/\s+/g, "_")}-${stamp}.json`, import.meta.url);
  writeFileSync(backupUrl, JSON.stringify(backup, null, 2));
  console.log(`Backup: ${decodeURIComponent(backupUrl.pathname)}`);
  let n = 0;
  for (const p of plan) {
    await prisma.lead.update({
      where: { id: p.id },
      // rawRemarks is the source of truth for Raw History + Smart Timeline. Fill
      // the display `remarks` too, but only when it's empty (don't clobber edits).
      data: { rawRemarks: p.conv, ...(p.remarksEmpty ? { remarks: p.conv } : {}) },
    });
    n++;
  }
  console.log(`✅ Backfilled ${n} leads from "${fileBase}".`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
