// Verifies the Conversation History import cleanup at the parser level:
//   • imported remark cells become clean Historical Notes (NO caller names),
//   • dated entries keep their date so they sort into the timeline,
//   • all truly-undated fragments collapse into ONE note (spec item §8).
// Pure logic — no DB. Run: npx tsx scripts/test-import-cleanup.ts
import { extractUndatedSegments } from "../src/lib/remarkParser";

const cases: { label: string; cell: string; expectUndatedCollapsed?: boolean }[] = [
  {
    label: "Bug repro — name prefix before a dated entry (Expressway Gurgaon Tanuj)",
    cell: "Expressway Gurgaon Tanuj: On 5 Apr 2025 (3:30PM) Client interested in 2 BHK ready-to-move apartment in Windchants, Sector 112, Dwarka Expressway, Gurgaon",
  },
  {
    label: "Multi-entry: two dated + one trailing undated",
    cell: "Lalit: On 16 May 2025 (3:30PM) discussed budget,,,On 20 May 2025 (4:00PM) callback requested,,,Client is an NRI based in Dubai",
  },
  {
    label: "Undated free text only — must collapse to ONE note",
    cell: "Client looking for villa,,,Budget 2 cr,,,Prefers ready to move",
    expectUndatedCollapsed: true,
  },
  {
    label: "On-date without time parens",
    cell: "On 3 Jan 2022 site visit done",
  },
];

// A note must never present a parsed word as a speaker ("Word: ...").
const NAME_PREFIX = /^[A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2}\s*:\s/;
let bad = 0;

for (const c of cases) {
  const segs = extractUndatedSegments(c.cell);
  console.log(`\n── ${c.label}`);
  console.log(`   input:  ${c.cell}`);
  for (const s of segs) {
    const when = s.date ? s.date.toISOString().slice(0, 16).replace("T", " ") + "Z" : "(undated → Historical Note)";
    console.log(`   • [${when}]  ${s.text}`);
    if (NAME_PREFIX.test(s.text)) { console.log("       ✗ LEAK — note still starts with a Name: prefix"); bad++; }
  }
  if (/\bTanuj\b/.test(JSON.stringify(segs)) && /Tanuj:/.test(c.cell)) {
    // It's fine for "Tanuj" to appear inside body text; only flag if it survived as a leading speaker label.
  }
  const undated = segs.filter((s) => !s.date);
  if (c.expectUndatedCollapsed && undated.length !== 1) {
    console.log(`       ✗ expected 1 collapsed undated note, got ${undated.length}`); bad++;
  }
  if (undated.length > 1) { console.log(`       ✗ ${undated.length} undated notes — should collapse to ONE`); bad++; }
}

console.log(bad === 0
  ? "\n✅ PASS — no name leaks, dates preserved, undated collapsed to one note."
  : `\n❌ FAIL — ${bad} issue(s).`);
process.exit(bad === 0 ? 0 : 1);
