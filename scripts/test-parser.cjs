const XLSX = require("xlsx");
const wb = XLSX.readFile(process.argv[2]);
const ws = wb.Sheets["Master Sheet"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
const remarkCol = 23;
console.log("Sample multi-line remarks from Nitisha MIS:\n");
for (let i = 3; i < rows.length && i < 6; i++) {
  const cell = rows[i][remarkCol];
  if (!cell || String(cell).length < 30) continue;
  console.log(`========== Row ${i+1} · ${rows[i][1]} ==========`);
  console.log(String(cell).slice(0, 800));
  console.log();
}
