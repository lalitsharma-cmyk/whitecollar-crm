const XLSX = require("xlsx");
const wb = XLSX.readFile(process.argv[2]);
console.log("=== SHEETS ===");
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws["!ref"];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  console.log(`\n## "${name}"  range=${ref}  rows=${rows.length}`);
  if (rows.length === 0) continue;
  const headers = rows[0];
  console.log(`  Headers (${headers.length} cols):`);
  headers.forEach((h, i) => console.log(`    [${i}] ${JSON.stringify(h)}`));
  console.log(`  Sample rows:`);
  rows.slice(1, 5).forEach((r, i) => {
    console.log(`    Row ${i + 2}:`, JSON.stringify(r).slice(0, 500));
  });
}
