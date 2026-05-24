const XLSX = require("xlsx");
const tsx = require("child_process");
const wb = XLSX.readFile(process.argv[2]);
const ws = wb.Sheets["Master Sheet"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
const remarkCol = 23;
console.log("Extracting parseable date-segments from 3 sample remark cells:\n");
for (let i = 3; i < rows.length && i < 6; i++) {
  const cell = String(rows[i][remarkCol] ?? "");
  if (cell.length < 30) continue;
  console.log(`### Row ${i+1} · ${rows[i][1]} ###`);
  // Find "On <date> (<time>)" segments manually for quick verification
  const re = /(?:([A-Z][A-Za-z]{2,15})\s*:\s*)?[oO]n\s+([\dA-Za-z]+(?:\s+[\dA-Za-z]+){1,3})\s*\(([^)]+)\)/g;
  let m, count = 0;
  while ((m = re.exec(cell)) !== null) {
    count++;
    console.log(`  ✓ [${m[1] || "—"}] ${m[2]} (${m[3]})`);
  }
  console.log(`  Total entries: ${count}\n`);
}
