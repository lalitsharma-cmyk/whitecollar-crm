// ────────────────────────────────────────────────────────────────────────────
// scripts/audit-duplicate-leads.ts   (READ-ONLY — zero writes)
//
//   npx tsx scripts/audit-duplicate-leads.ts
//
// 1) Deep-dive on the reported "Avriti Khanduri & Geeta Khanduri" duplicate.
// 2) CRM-wide duplicate scan: same name, same phone, same email, and same-minute
//    same-name creations — to tell genuine DB duplicates from UI rendering.
// Answers Step 1 definitively: if N rows come back from the DB, they ARE N
// records (not a UI re-render).
// ────────────────────────────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";

const last10 = (s?: string | null) => (s ?? "").replace(/\D/g, "").slice(-10);
const normName = (s?: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const ist = (d: Date | null) => d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d) : "—";

async function main() {
  // ── 1) The reported pair ───────────────────────────────────────────────────
  console.log("═══ 1) Avriti / Geeta Khanduri ═══");
  const reported = await prisma.lead.findMany({
    where: { OR: [{ name: { contains: "Avriti", mode: "insensitive" } }, { name: { contains: "Khanduri", mode: "insensitive" } }] },
    select: {
      id: true, name: true, phone: true, email: true, createdAt: true, source: true, sourceRaw: true,
      leadOrigin: true, currentStatus: true, deletedAt: true, forwardedTeam: true, importBatchId: true,
      owner: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  for (const l of reported) {
    console.log(`\n  • ${l.name}  [${l.id}]`);
    console.log(`    created=${ist(l.createdAt)}  owner=${l.owner?.name ?? "—"}  team=${l.forwardedTeam ?? "—"}  status=${l.currentStatus ?? "—"}`);
    console.log(`    phone=${l.phone ?? "—"}  email=${l.email ?? "—"}  origin=${l.leadOrigin}  deleted=${l.deletedAt ? ist(l.deletedAt) : "no"}`);
    console.log(`    source=${l.source ?? "—"}  sourceRaw=${(l.sourceRaw ?? "—").slice(0, 60)}  importBatch=${l.importBatchId ?? "none (not an import)"}`);
  }
  console.log(`\n  → ${reported.length} DB record(s) match. ${reported.length > 1 ? "These are SEPARATE database rows (not a UI re-render)." : "Single row — any doubling is UI-side."}`);

  // ── 2) CRM-wide duplicate scan (active = not deleted) ──────────────────────
  const all = await prisma.lead.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, phone: true, email: true, createdAt: true, importBatchId: true, owner: { select: { name: true } } },
  });
  console.log(`\n═══ 2) CRM-wide scan over ${all.length} active leads ═══`);

  const byName = new Map<string, typeof all>();
  const byPhone = new Map<string, typeof all>();
  const byEmail = new Map<string, typeof all>();
  const byMinuteName = new Map<string, typeof all>();
  for (const l of all) {
    const n = normName(l.name); if (n) (byName.get(n) ?? byName.set(n, []).get(n)!).push(l);
    const p = last10(l.phone); if (p.length >= 7) (byPhone.get(p) ?? byPhone.set(p, []).get(p)!).push(l);
    const e = (l.email ?? "").toLowerCase().trim(); if (e) (byEmail.get(e) ?? byEmail.set(e, []).get(e)!).push(l);
    const minuteKey = n + "|" + (l.createdAt ? l.createdAt.toISOString().slice(0, 16) : "");
    if (n) (byMinuteName.get(minuteKey) ?? byMinuteName.set(minuteKey, []).get(minuteKey)!).push(l);
  }
  const dups = (m: Map<string, typeof all>) => [...m.values()].filter((g) => g.length > 1);

  const nameDups = dups(byName), phoneDups = dups(byPhone), emailDups = dups(byEmail), minDups = dups(byMinuteName);
  console.log(`  Same normalized NAME (>1):  ${nameDups.length} group(s), ${nameDups.reduce((a, g) => a + g.length, 0)} rows`);
  console.log(`  Same PHONE (last-10, >1):   ${phoneDups.length} group(s), ${phoneDups.reduce((a, g) => a + g.length, 0)} rows`);
  console.log(`  Same EMAIL (>1):            ${emailDups.length} group(s), ${emailDups.reduce((a, g) => a + g.length, 0)} rows`);
  console.log(`  Same NAME + same MINUTE:    ${minDups.length} group(s)  ← strongest "double-create" signal`);

  console.log(`\n  ── Same-name + same-minute groups (most likely true duplicates) ──`);
  for (const g of minDups.slice(0, 25)) {
    console.log(`  • "${g[0].name}" ×${g.length}  @ ${ist(g[0].createdAt)}  owner=${g[0].owner?.name ?? "—"}`);
    for (const l of g) console.log(`      ${l.id}  phone=${l.phone ?? "∅"}  import=${l.importBatchId ?? "none"}`);
  }
  if (minDups.length > 25) console.log(`  …and ${minDups.length - 25} more.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
