// QA (READ-ONLY DB): round-trip verify the Yasir/Dinesh backfill.
//  1. Every lead in each batch now has rawRemarks (0 empty).
//  2. Stored rawRemarks EXACTLY equals the source-sheet row matched by phone
//     (proves correct row, no truncation, no cross-contamination).
//  3. Name consistency — the matched source row's name shares a token with the
//     lead name (independent guard against a wrong-phone collision).
//  4. Scope integrity — the backup lists ONLY leads that were previously empty,
//     all inside the correct batch (nothing else was touched).
//  5. Smart Timeline parses the restored text into dated events.
import { readFileSync, readdirSync } from "node:fs";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { detectConversationColumn } from "../src/lib/conversationColumn";
import { parseRemarksTimeline } from "../src/lib/remarkParser";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; } else { fail++; console.log(`  ✗ FAIL: ${m}`); } };
const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function looksLikeHeader(row: string[]): boolean {
  const flat = row.map((c) => norm(String(c ?? "")));
  const expected = ["customer", "mobile", "phone", "name", "email", "source", "stage", "remarks", "project", "budget"];
  return expected.filter((e) => flat.some((c) => c === e || c.startsWith(e))).length >= 3;
}
function phoneKeys(s: string): string[] {
  const out = new Set<string>();
  for (const chunk of String(s ?? "").split(/[,/;\n|]+/)) { const d = chunk.replace(/\D/g, ""); if (d.length >= 10) out.add(d.slice(-10)); }
  return [...out];
}
const nameKey = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 22);
const tokens = (s: string) => new Set(String(s ?? "").toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3));
const ROSTER = ["Lalit", "Yasir", "Tanuj", "Mehak", "Muskan", "Kiran", "Dinesh", "Nitisha", "Sandeep", "Komal", "Javed", "Nisha"];

async function verifyFile(path: string, keyword: string) {
  const fileBase = path.split(/[\\/]/).pop()!.replace(/\.xlsx$/i, "");
  console.log(`\n══════ ${fileBase} ══════`);
  // Parse source.
  const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
  const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: false, raw: false }) as string[][];
  let hr = -1; for (let i = 0; i < Math.min(5, grid.length); i++) if (looksLikeHeader(grid[i])) { hr = i; break; }
  const headers = grid[hr].map((h) => String(h ?? "").trim());
  const dataRows = grid.slice(hr + 1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const convCol = detectConversationColumn(headers, dataRows);
  const nameCol = headers.findIndex((h) => { const n = norm(h); return n === "name" || n.includes("customer") || n === "fullname"; });
  const phoneCol = headers.findIndex((h) => /mobile|contact|phone|whatsapp/i.test(h));
  type Src = { name: string; conv: string };
  const byPhone = new Map<string, Src>(), byName = new Map<string, Src>();
  for (const r of dataRows) {
    const conv = String(r[convCol] ?? "").trim(); if (!conv) continue;
    const rec: Src = { name: String(r[nameCol] ?? "").trim(), conv };
    for (const p of phoneKeys(String(r[phoneCol] ?? ""))) if (!byPhone.has(p)) byPhone.set(p, rec);
    const nk = nameKey(rec.name); if (nk && !byName.has(nk)) byName.set(nk, rec);
  }

  // Leads in the batch(es).
  const batches = await prisma.importBatch.findMany({ where: { fileName: { contains: keyword, mode: "insensitive" } }, select: { id: true } });
  const leads = await prisma.lead.findMany({ where: { deletedAt: null, importBatchId: { in: batches.map((b) => b.id) } },
    select: { id: true, name: true, phone: true, altPhone: true, rawRemarks: true } });

  // 1. No empty conversation left.
  const empty = leads.filter((l) => (l.rawRemarks ?? "").trim() === "").length;
  ok(empty === 0, `${empty} leads still have empty conversation (expected 0)`);

  // 2 + 3. Exact round-trip + name consistency.
  let exact = 0, nameOk = 0, matched = 0, nameChecked = 0, maxEvents = 0, timelineOk = 0;
  for (const l of leads) {
    let src: Src | undefined;
    for (const p of [...phoneKeys(l.phone ?? ""), ...phoneKeys(l.altPhone ?? "")]) { const s = byPhone.get(p); if (s) { src = s; break; } }
    if (!src) src = byName.get(nameKey(l.name ?? ""));
    if (!src) continue;
    matched++;
    if ((l.rawRemarks ?? "").trim() === src.conv.trim()) exact++;
    else console.log(`  ✗ MISMATCH ${l.name}: db=${(l.rawRemarks ?? "").length}ch vs src=${src.conv.length}ch`);
    // name consistency: shared token between lead name and source name (skip if source name blank)
    if (src.name) {
      nameChecked++;
      const lt = tokens(l.name ?? ""), st = tokens(src.name);
      if ([...lt].some((t) => st.has(t)) || [...st].some((t) => lt.has(t)) || nameKey(l.name ?? "").includes(nameKey(src.name)) || nameKey(src.name).includes(nameKey(l.name ?? ""))) nameOk++;
      else console.log(`  ⚠ name differs: lead="${l.name}" vs source="${src.name}" (phone-matched)`);
    }
    // 5. Smart Timeline parses ≥1 dated event.
    const ev = parseRemarksTimeline(l.rawRemarks ?? "", ROSTER).filter((e) => e.date);
    if (ev.length >= 1) timelineOk++;
    maxEvents = Math.max(maxEvents, ev.length);
  }
  ok(exact === matched, `exact round-trip: ${exact}/${matched} stored rawRemarks identical to source`);
  ok(nameOk === nameChecked, `name consistency: ${nameOk}/${nameChecked} phone-matches share a name token`);
  ok(timelineOk === leads.length, `Smart Timeline: ${timelineOk}/${leads.length} leads parse ≥1 dated event (richest = ${maxEvents} events)`);
  console.log(`  → ${leads.length} leads · matched ${matched} · exact ${exact} · timelines ok ${timelineOk} (max ${maxEvents} events)`);

  // 4. Scope integrity from the backup file: every backed-up lead was previously EMPTY + in batch.
  const backupFile = readdirSync(new URL("../backups/", import.meta.url)).filter((f) => f.startsWith(`backfill-blankcol-${fileBase.replace(/\s+/g, "_")}-`)).sort().pop();
  if (backupFile) {
    const backup = JSON.parse(readFileSync(new URL(`../backups/${backupFile}`, import.meta.url), "utf8")) as Array<{ id: string; rawRemarks: string | null }>;
    const allEmpty = backup.every((b) => (b.rawRemarks ?? "").trim() === "");
    ok(allEmpty, `backup proves only-empty-leads were touched (${backup.filter((b) => (b.rawRemarks ?? "").trim() !== "").length} non-empty in backup)`);
    const batchIds = new Set(leads.map((l) => l.id));
    const allInBatch = backup.every((b) => batchIds.has(b.id));
    ok(allInBatch, `backup IDs all within the batch (scope not exceeded)`);
    console.log(`  → backup ${backupFile}: ${backup.length} rows, all previously empty=${allEmpty}, all in-batch=${allInBatch}`);
  } else { console.log(`  ⚠ no backup file found for ${fileBase}`); }
}

async function main() {
  await verifyFile("C:/Users/Lenovo/Downloads/YASIR MIS.xlsx", "YASIR");
  await verifyFile("C:/Users/Lenovo/Downloads/Dinesh Gill MIS.xlsx", "Dinesh");
  console.log(`\n═══ QA-BACKFILL: ${pass} passed, ${fail} failed ═══`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
