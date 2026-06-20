// READ-ONLY: inspect an Excel file exactly as the importer's parseExcel() sees it.
//   npx tsx scripts/inspect-xlsx.ts "<path-to-xlsx>"
import * as XLSX from "xlsx";

const path = process.argv[2];
if (!path) { console.error("Usage: tsx scripts/inspect-xlsx.ts <file.xlsx>"); process.exit(1); }

// Mirror the importer's looksLikeHeader().
function looksLikeHeader(row: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const flat = row.map((c) => norm(String(c ?? "")));
  const expected = ["customer", "mobile", "phone", "name", "email", "source", "stage", "remarks", "project", "budget"];
  return expected.filter((e) => flat.some((c) => c === e || c.startsWith(e))).length >= 3;
}

const wb = XLSX.read(require("node:fs").readFileSync(path), { type: "buffer", cellDates: true });
console.log(`\nFILE: ${path}`);
console.log(`SHEETS (tabs): ${JSON.stringify(wb.SheetNames)}`);

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", blankrows: false, raw: false }) as string[][];
  console.log(`\n── tab "${sheetName}" — ${grid.length} rows ──`);
  // Header detection (first 5 rows).
  let headerRow = -1;
  for (let i = 0; i < Math.min(5, grid.length); i++) if (looksLikeHeader(grid[i])) { headerRow = i; break; }
  console.log(`   detected header row: ${headerRow}`);
  if (headerRow >= 0) {
    const headers = grid[headerRow].map((h) => String(h ?? "").trim());
    console.log(`   headers (${headers.length}): ${JSON.stringify(headers)}`);
    // Find a Remarks/conversation column + count non-empty data cells under it.
    const ri = headers.findIndex((h) => /remark|conversation|histor|comment|discuss/i.test(h));
    if (ri >= 0) {
      const dataRows = grid.slice(headerRow + 1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
      const nonEmpty = dataRows.filter((r) => String(r[ri] ?? "").trim() !== "");
      console.log(`   ✅ "${headers[ri]}" is column #${ri}. ${nonEmpty.length}/${dataRows.length} data rows have text.`);
      if (nonEmpty[0]) console.log(`      sample: ${JSON.stringify(String(nonEmpty[0][ri]).slice(0, 90))}`);
    } else {
      console.log(`   ❌ no remark/conversation column in the detected header row.`);
      // Show the FULL first two raw rows so we can see if Remarks is mis-detected.
      console.log(`   raw row0: ${JSON.stringify(grid[0]?.map((c) => String(c).slice(0, 18)))}`);
      console.log(`   raw row1: ${JSON.stringify(grid[1]?.map((c) => String(c).slice(0, 18)))}`);
    }
  } else {
    console.log(`   raw row0: ${JSON.stringify(grid[0]?.map((c) => String(c).slice(0, 18)))}`);
    console.log(`   raw row1: ${JSON.stringify(grid[1]?.map((c) => String(c).slice(0, 18)))}`);
  }
}
