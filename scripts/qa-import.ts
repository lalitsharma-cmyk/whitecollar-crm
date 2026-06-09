// QA: run the import header-detection + mapping pipeline against the generated
// messy test file (section titles on row 1, real headers on row 2). Mirrors the
// exact logic in HRImportClient.
import * as XLSX from "xlsx";

const GUESS: Record<string, string[]> = {
  name: ["candidate name", "full name", "name"],
  phone: ["mobile number", "mobile no", "contact number", "mobile", "phone", "contact"],
  whatsappPhone: ["whatsapp number", "wa number", "whatsapp", "wa"],
  email: ["email id", "email address", "email", "mail"],
  location: ["current location", "location", "city"], city: ["home city", "city"],
  currentCompany: ["current company", "company"],
  currentProfile: ["current role", "current profile", "designation", "profile", "current designation", "title"],
  positionApplied: ["position applied", "position", "applied for", "role applied"],
  experience: ["total experience", "experience", "exp"], realEstateExperience: ["real estate experience", "re experience", "re exp"],
  currentSalary: ["current salary", "current ctc", "present salary", "salary"], expectedSalary: ["expected salary", "expected ctc", "expected"],
  noticePeriod: ["notice period", "notice", "np"], source: ["job portal", "source", "portal"],
  status: ["current status", "status"], nextAction: ["next action"],
  remarks: ["hr remarks", "remarks", "comments", "notes", "comment", "remark"], resumeUrl: ["resume url", "cv link", "resume link", "resume", "cv"],
};
const CRM_FIELDS = Object.keys(GUESS);
const SECTION_WORDS = ["basic information", "f2f interview", "hr evaluation", "sales assessment", "hr decision", "final", "interview", "evaluation", "assessment", "decision"];
const ALL_SYN = (() => { const s = new Set<string>(); for (const f in GUESS) GUESS[f].forEach(x => s.add(x)); return [...s]; })();
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isJunkHeader = (h: string) => !h || !h.trim() || /^__empty/i.test(h.trim()) || SECTION_WORDS.includes(norm(h));
const fieldMatchCount = (cells: string[]) => cells.reduce((n, c) => { const x = norm(c); return n + (x && ALL_SYN.some(s => x === s || x.includes(s) || s.includes(x)) ? 1 : 0); }, 0);
function detectHeaderRow(grid: string[][]) { let best = 0, bs = -1; for (let i = 0; i < Math.min(20, grid.length); i++) { const s = fieldMatchCount(grid[i] ?? []); if (s > bs) { bs = s; best = i; } } return best; }
function guessMapping(headers: string[]) { const m: Record<string, string> = {}; const taken = new Set<string>(); for (const field of CRM_FIELDS) { const cands = (GUESS[field] ?? [field]).map(norm); const exact = headers.find(h => !taken.has(h) && cands.includes(norm(h))); const loose = exact ?? headers.find(h => !taken.has(h) && cands.some(c => norm(h).includes(c))); if (loose) { m[field] = loose; taken.add(loose); } } return m; }
function parseSheet(grid: string[][], hr: number) {
  const raw = (grid[hr] ?? []).map(c => String(c ?? "").trim());
  const headers = raw.filter(h => !isJunkHeader(h));
  const rows = grid.slice(hr + 1).map(row => { const o: Record<string, string> = {}; raw.forEach((h, j) => { if (!isJunkHeader(h)) o[h] = String(row[j] ?? "").trim(); }); return o; }).filter(o => Object.values(o).some(v => v !== ""));
  return { headers, rows };
}

const wb = XLSX.readFile("C:/Users/Lenovo/whitecollar-crm/qa-test-candidates.xlsx");
const grid = (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: false }) as unknown[][]).map(r => r.map(c => String(c ?? "").trim()));
const hr = detectHeaderRow(grid);
const { headers, rows } = parseSheet(grid, hr);
const mapping = guessMapping(headers);
const mapped = rows.map(r => { const o: Record<string, string> = {}; for (const [f, c] of Object.entries(mapping)) if (c) o[f] = r[c] ?? ""; return o; });

console.log("Row 1 (section titles):", grid[0].filter(Boolean).join(" | "));
console.log("Detected header row index:", hr, "(expected 1)");
console.log("Detected headers:", headers.join(", "));
console.log("Auto-mapping:");
for (const [f, c] of Object.entries(mapping)) console.log(`  ${f.padEnd(18)} <- "${c}"`);
console.log("Parsed data rows:", rows.length, "(expected 3)");
mapped.forEach((m, i) => console.log(`  row ${i + 1}: name="${m.name ?? ""}" phone="${m.phone ?? ""}" salary=${m.currentSalary ?? ""}/${m.expectedSalary ?? ""} status="${m.status ?? ""}"`));
const ok = hr === 1 && rows.length === 3 && mapping.name === "Candidate Name" && mapping.phone === "Mobile Number" && mapping.currentSalary === "Current CTC" && mapping.expectedSalary === "Expected CTC";
console.log(ok ? "\n✅ PASS — header row detected, section titles skipped, fuzzy mapping correct." : "\n❌ FAIL — check output above.");
