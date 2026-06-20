// ─────────────────────────────────────────────────────────────────────────────
// scripts/backfill-property-type.ts — set Lead.propertyType for existing leads.
//   npx tsx scripts/backfill-property-type.ts            (DRY-RUN — counts + samples)
//   npx tsx scripts/backfill-property-type.ts --apply     (writes; conservative)
//
// Uses the SAME inferPropertyType() the live intake uses → old == new.
// CONSERVATIVE: only sets where propertyType is currently null AND inference is
// confident (Residential/Commercial). Leaves it blank where unclear; never
// overwrites an existing value.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { inferPropertyType, type PropertyType } from "../src/lib/propertyType";

const APPLY = process.argv.includes("--apply");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

function norm(s: string) { return s.toLowerCase().replace(/\s+/g, " ").trim(); }

async function main() {
  // Project name → category map (authoritative source for "project is commercial").
  const projects = await prisma.project.findMany({ select: { name: true, category: true } });
  const catByName = new Map<string, string | null>();
  for (const p of projects) catByName.set(norm(p.name), p.category);

  // Every lead (incl. historical/imported/deleted) — the rule applies to all.
  const leads = await prisma.lead.findMany({
    select: { id: true, name: true, propertyType: true, configuration: true, sourceDetail: true, notesShort: true },
  });

  const toSet: { id: string; name: string; type: PropertyType; via: string }[] = [];
  for (const l of leads) {
    if (l.propertyType) continue; // never overwrite an existing value
    const projName = l.sourceDetail ?? null;
    const projectCategory = projName ? (catByName.get(norm(projName)) ?? null) : null;
    const type = inferPropertyType({ projectCategory, configuration: l.configuration, projectName: projName, notes: l.notesShort });
    if (type) {
      const via = projectCategory ? `project:${projName}` : `config/keywords`;
      toSet.push({ id: l.id, name: l.name, type, via });
    }
  }

  const resi = toSet.filter((x) => x.type === "Residential").length;
  const comm = toSet.filter((x) => x.type === "Commercial").length;
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — ${leads.length} leads scanned`);
  console.log(`  → would set ${toSet.length}:  Residential ${resi} · Commercial ${comm}`);
  console.log(`  → left blank (unclear): ${leads.length - toSet.length}\n`);
  console.log("Sample (first 15):");
  for (const x of toSet.slice(0, 15)) console.log(`   ${x.type.padEnd(12)} ${x.name.slice(0, 28).padEnd(30)} via ${x.via}`);

  if (APPLY && toSet.length) {
    mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
    writeFileSync(new URL("../backups/propertyType-backfill.json", import.meta.url), JSON.stringify(toSet, null, 2));
    console.log(`\n🔒 Saved set-list → backups/propertyType-backfill.json`);
    // Group by type for two bulk updates (fast).
    for (const type of ["Residential", "Commercial", "Mixed Use"] as const) {
      const ids = toSet.filter((x) => x.type === type).map((x) => x.id);
      if (ids.length) await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { propertyType: type } });
    }
    console.log(`✅ APPLIED — ${toSet.length} leads set.`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
