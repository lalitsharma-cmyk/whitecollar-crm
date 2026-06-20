// READ-ONLY proof: run the NEW importer path (header-detect → detectConversationColumn
// → inject "Remarks") against a real file and report how many rows now get conversation.
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { detectConversationColumn } from "../src/lib/conversationColumn";
function looksLikeHeader(row: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const flat = row.map((c) => norm(String(c ?? "")));
  const expected = ["customer","mobile","phone","name","email","source","stage","remarks","project","budget"];
  return expected.filter((e) => flat.some((c) => c === e || c.startsWith(e))).length >= 3;
}
const path = process.argv[2];
const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
const tab = wb.SheetNames[0];
const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[tab], { header: 1, defval: "", blankrows: false, raw: false }) as string[][];
let hr = -1; for (let i=0;i<Math.min(5,grid.length);i++) if (looksLikeHeader(grid[i])) { hr=i; break; }
const headers = grid[hr].map((h)=>String(h??"").trim());
const dataRows = grid.slice(hr+1).filter((r)=>r.some((c)=>String(c??"").trim()!==""));
const convCol = detectConversationColumn(headers, dataRows);
console.log(`\n${path.split(/[\/]/).pop()}  · tab "${tab}" · header row ${hr} · ${dataRows.length} data rows`);
console.log(`detectConversationColumn → index ${convCol}${convCol>=0?` (header was "${headers[convCol]||"«BLANK»"}")`:""}`);
if (convCol < 0) { console.log("  ⚠ NO conversation column detected"); process.exit(0); }
let filled = 0;
const samples: string[] = [];
for (const r of dataRows) {
  const v = String(r[convCol] ?? "").trim();
  if (v) { filled++; if (samples.length < 3) samples.push(v.slice(0, 95)); }
}
console.log(`  ✅ Remarks would be injected for ${filled}/${dataRows.length} rows`);
samples.forEach((s, i) => console.log(`     sample ${i+1}: ${JSON.stringify(s)}`));
