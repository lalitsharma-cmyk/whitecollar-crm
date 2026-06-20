// READ-ONLY. For the FIRST tab of a file (the one the importer reads), show the
// header row INCLUDING blank-header columns, and the longest free-text value per
// column — reveals where conversation lives even when the header cell is empty.
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
const path = process.argv[2];
function looksLikeHeader(row: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const flat = row.map((c) => norm(String(c ?? "")));
  const expected = ["customer","mobile","phone","name","email","source","stage","remarks","project","budget"];
  return expected.filter((e) => flat.some((c) => c === e || c.startsWith(e))).length >= 3;
}
const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
const tab = wb.SheetNames[0];
const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[tab], { header: 1, defval: "", blankrows: false, raw: false }) as string[][];
let hr = -1; for (let i=0;i<Math.min(5,grid.length);i++) if (looksLikeHeader(grid[i])) { hr=i; break; }
console.log(`\nFILE: ${path}\nFIRST TAB (importer reads this): "${tab}"  · header row ${hr} · ${grid.length} rows`);
const headers = grid[hr].map((h)=>String(h??"").trim());
const data = grid.slice(hr+1).filter((r)=>r.some((c)=>String(c??"").trim()!==""));
console.log(`\nPER-COLUMN (idx · header · longest value · #non-empty):`);
for (let c=0;c<headers.length;c++){
  let longest="", n=0;
  for (const r of data){ const v=String(r[c]??"").trim(); if(v){n++; if(v.length>longest.length) longest=v;} }
  if (n===0) continue;
  const hdr = headers[c]==="" ? "«BLANK»" : headers[c];
  console.log(`  ${String(c).padStart(2)} · ${hdr.padEnd(22)} · n=${String(n).padStart(3)} · ${JSON.stringify(longest.slice(0,75))}`);
}
