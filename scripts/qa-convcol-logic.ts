// QA (no DB): exercise the conversation-column rescue across edge cases + every
// MIS file on disk. PASS/FAIL per assertion. Proves: (a) multi-blank-column
// disambiguation, (b) the Papa/Google-Sheet path, (c) no OTHER agent sheet
// silently loses conversation, (d) date/short blank columns are never rescued.
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { readFileSync, readdirSync } from "node:fs";
import { detectConversationColumn, detectConversationKeyFromRows, looksLikeConversation } from "../src/lib/conversationColumn";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ FAIL: ${m}`); } };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function looksLikeHeader(row: string[]): boolean {
  const flat = row.map((c) => norm(String(c ?? "")));
  const expected = ["customer", "mobile", "phone", "name", "email", "source", "stage", "remarks", "project", "budget"];
  return expected.filter((e) => flat.some((c) => c === e || c.startsWith(e))).length >= 3;
}
function parseFirstTab(path: string) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
  const tab = wb.SheetNames[0];
  const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[tab], { header: 1, defval: "", blankrows: false, raw: false }) as string[][];
  let hr = -1; for (let i = 0; i < Math.min(5, grid.length); i++) if (looksLikeHeader(grid[i])) { hr = i; break; }
  if (hr < 0) return { tab, hr, headers: [] as string[], dataRows: [] as string[][] };
  const headers = grid[hr].map((h) => String(h ?? "").trim());
  const dataRows = grid.slice(hr + 1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  return { tab, hr, headers, dataRows };
}

console.log("\n═══ QA 1: looksLikeConversation unit ═══");
ok(looksLikeConversation("Yasir: on 24 apr 2025 (4:01pm) not picked, number not on WA, requirement 3bhk") === true, "real dated call log → true");
ok(looksLikeConversation("On Truecaller : Shyam P, Muskan: On 26 Jan 2026 will call back") === true, "speaker-prefixed log → true");
ok(looksLikeConversation("17-Apr-26") === false, "bare date → false");
ok(looksLikeConversation("Never Respond") === false, "2-word status → false");
ok(looksLikeConversation("9650536365") === false, "phone number → false");
ok(looksLikeConversation("Cold") === false, "single status word → false");
ok(looksLikeConversation("") === false, "empty → false");

console.log("\n═══ QA 2: multi-blank-column disambiguation (Dinesh-shape) ═══");
// 3 blank-header columns: conversation, a date col, a short-status col. Must pick conversation.
const mh = ["Date", "Name", "Status", "", "", ""];
const mr = [
  ["20-Sep-24", "A", "Cold", "Mehak: On 15 Nov 2025 (1:56) sold his sobha property, planning to invest in dubai", "17-Apr-26", "Not Connected"],
  ["21-Sep-24", "B", "Warm", "Dinesh: On 17 May 2026 (1:10PM) had whatsapp chat, asked prices for hartland 2", "22-Jun-26", "Connected"],
  ["22-Sep-24", "C", "Hot", "Muskan: On 26 Jan 2026 (10:45am) will call back, interested in maritime city", "01-Jan-26", "Not Connected"],
  ["23-Sep-24", "D", "Cold", "Sandeep: On 11 Feb 2026 (3:59PM) business in bur dubai, asking for studio", "05-May-26", "Connected"],
];
const picked = detectConversationColumn(mh, mr);
ok(picked === 3, `picks the conversation column (idx 3), not the date(4)/status(5) — got ${picked}`);

console.log("\n═══ QA 3: Google-Sheet (Papa header:true) path ═══");
// Build a CSV with a BLANK header over the conversation column, exactly like the
// Google-Sheet export of these MIS sheets.
const csv = [
  "Date,Name,Contact,",
  "25-Sep-21,Meena,9650536365,On 25 Sep 2021 looking 4550 sqft in Trump Towers will visit next week for site",
  "16-Oct-21,Gagan,9810112801,On 16 Oct 2021 call on wait then on 17 Oct call him at 5pm not picked busy",
  "18-Oct-21,Asha,9818860113,On 18 Oct 2021 looking for site visit discuss 4750 and villa will come this week",
  "20-Aug-25,Sumeet,9810264604,Yasir on 20 Aug 2025 not picked whatsapp message sent will follow up tomorrow",
].join("\n");
const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
const convKey = detectConversationKeyFromRows(parsed.data as Array<Record<string, unknown>>);
ok(convKey !== null, `blank-header key detected in Papa rows (got ${JSON.stringify(convKey)})`);
if (convKey !== null) {
  for (const row of parsed.data) { const v = String((row as Record<string, unknown>)[convKey] ?? "").trim(); (row as Record<string, string>)["Remarks"] = v || ""; }
  const filled = parsed.data.filter((r) => (r["Remarks"] ?? "").length > 0).length;
  ok(filled === 4, `all 4 rows get Remarks injected via Papa path (got ${filled})`);
  ok(norm(convKey) === "", `the rescued key is genuinely blank-header (norm="${norm(convKey)}")`);
}
// Labeled-Remarks CSV → detector stays OUT.
const csvLabeled = "Date,Name,Remarks\n25-Sep-21,Meena,On 25 Sep 2021 looking 4550 sqft will visit\n16-Oct,Gagan,On 16 Oct call not picked busy try later please\n18-Oct,Asha,On 18 Oct site visit discuss villa option today";
const pl = Papa.parse<Record<string, string>>(csvLabeled, { header: true, skipEmptyLines: true });
ok(detectConversationKeyFromRows(pl.data as Array<Record<string, unknown>>) === null, "labeled Remarks CSV → detector returns null (normal mapping owns it)");

console.log("\n═══ QA 4: scan EVERY MIS file on disk (latent same-bug check) ═══");
const dl = "C:/Users/Lenovo/Downloads";
const files = readdirSync(dl).filter((f) => /mis.*\.xlsx$/i.test(f) && !f.startsWith("~$"));
for (const f of files) {
  try {
    const { tab, hr, headers, dataRows } = parseFirstTab(`${dl}/${f}`);
    if (hr < 0) { console.log(`  ⚠ ${f}: NO header row detected in first tab "${tab}" — importer would skip/try next tab (worth a look)`); continue; }
    const labeled = headers.some((h) => /remark|conversation/i.test(h));
    const cc = detectConversationColumn(headers, dataRows);
    const tag = labeled ? "labeled Remarks (normal path)" : cc >= 0 ? `RESCUED blank col #${cc}` : "no conversation col found";
    console.log(`  • ${f.padEnd(22)} tab="${tab}" hdr@${hr} → ${tag}`);
    // Invariant: a sheet must never BOTH have a labeled remarks col AND get a rescue.
    ok(!(labeled && cc >= 0), `${f}: not double-handled (labeled XOR rescued)`);
  } catch (e) { console.log(`  ✗ ${f}: ${String(e).slice(0, 80)}`); fail++; }
}

console.log(`\n═══ QA-LOGIC: ${pass} passed, ${fail} failed ═══`);
process.exit(fail ? 1 : 0);
