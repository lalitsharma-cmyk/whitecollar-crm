// READ-ONLY diagnostics for (a) bad altName values + (b) the Smart Timeline
// dated-remark boundary bug.   npx tsx scripts/diag-altname-parser.ts
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseRemarksTimeline } from "../src/lib/remarkParser";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  // (a) altName distribution + which look like internal names.
  const users = await prisma.user.findMany({ select: { name: true } });
  const rosterFirst = new Set(users.map((u) => u.name.toLowerCase().split(" ")[0]));
  const withAlt = await prisma.lead.findMany({ where: { altName: { not: null } }, select: { id: true, name: true, altName: true } });
  const HONORIFIC = /\b(sir|sahab|sahib|ji|madam|maam)\b/i;
  const TEAM = /^(dubai|india)$/i;
  const isInternal = (a: string) => {
    const t = a.trim();
    if (!t) return false;
    if (HONORIFIC.test(t)) return true;
    if (TEAM.test(t)) return true;
    if (/lalit/i.test(t)) return true;
    if (rosterFirst.has(t.toLowerCase().split(" ")[0])) return true;
    return false;
  };
  const internal = withAlt.filter((l) => isInternal(l.altName!));
  console.log(`\n[altName] ${withAlt.length} leads have an altName · ${internal.length} flagged INTERNAL`);
  console.log(`   ALL altName values:`);
  for (const l of withAlt) console.log(`      ${isInternal(l.altName!) ? "⚠ " : "  "}${l.name}  →  altName="${l.altName}"`);

  // (b) Parser boundary test — a NEW dated remark must become its OWN entry,
  // never fold into a previous-dated card.
  console.log(`\n[parser] dated-remark boundary test:`);
  const samples = [
    "Javed: On 17-May-26 Shared Raw District with him. Lalit: On 19-Jun-26 call not pick",
    "Javed: On 17 May 2026 Shared Raw District with him. Lalit: On 19 Jun 2026 call not pick",
    "Javed: On 17/05/2026 shared details. Lalit: On 19-Jun-2026 call not pick",
  ];
  for (const s of samples) {
    const entries = parseRemarksTimeline(s, users.map((u) => u.name));
    console.log(`\n  input: ${JSON.stringify(s.slice(0, 70))}…`);
    console.log(`  → ${entries.length} entr${entries.length === 1 ? "y" : "ies"}:`);
    for (const e of entries) {
      const d = e.date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(e.date) : "UNDATED";
      console.log(`      [${d}] ${e.agentName ?? "—"} · ${e.eventType} · ${JSON.stringify(e.text.slice(0, 45))}`);
    }
  }
}
main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
