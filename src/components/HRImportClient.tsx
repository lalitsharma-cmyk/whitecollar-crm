"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Eye, Loader2, UserPlus, RefreshCw, SkipForward, AlertTriangle, CheckCircle2, ArrowLeft } from "lucide-react";

interface Agent { id: string; name: string; }

// Dry-run preview payload returned by POST /api/hr/candidates/import?dryRun=1.
type PreviewAction = "new" | "update" | "skip" | "error";
interface PreviewRow {
  rowIndex: number;
  action: PreviewAction;
  candidateName: string;
  reason: string;
  status: string;
  workflowCount: { followUps: number; interviews: number; activities: number };
}
interface PreviewData {
  summary: { total: number; new: number; update: number; skip: number; error: number; totalFollowUps: number; totalInterviews: number };
  rows: PreviewRow[];
}
const CRM_FIELDS: [string, string][] = [
  ["name", "Candidate Name"], ["phone", "Phone"], ["whatsappPhone", "WhatsApp"], ["email", "Email"],
  ["location", "Location"], ["city", "City"], ["currentCompany", "Current Company"], ["currentProfile", "Current Profile"],
  ["positionApplied", "Position Applied"], ["experience", "Total Experience"], ["realEstateExperience", "RE Experience"],
  ["currentSalary", "Current Salary"], ["expectedSalary", "Expected Salary"], ["noticePeriod", "Notice Period"],
  ["source", "Source"], ["status", "Status"], ["nextAction", "Next Action"],
  ["followUpDate", "Follow-Up Date"], ["interviewDate", "Interview Date"], ["joiningDate", "Joining Date"],
  ["remarks", "Initial Notes"], ["resumeUrl", "Resume URL"],
];
const GUESS: Record<string, string[]> = {
  name: ["candidate name", "full name", "name"],
  phone: ["mobile number", "mobile no", "contact number", "mobile", "phone", "contact"],
  whatsappPhone: ["whatsapp number", "wa number", "whatsapp", "wa"],
  email: ["email id", "email address", "email", "mail"],
  location: ["current location", "location", "city"],
  city: ["home city", "city"],
  currentCompany: ["current company", "company"],
  currentProfile: ["current role", "current profile", "designation", "profile", "current designation", "title"],
  positionApplied: ["position applied", "position", "applied for", "role applied"],
  experience: ["total experience", "experience", "exp"],
  realEstateExperience: ["real estate experience", "re experience", "re exp"],
  currentSalary: ["current salary", "current ctc", "present salary", "salary"],
  expectedSalary: ["expected salary", "expected ctc", "expected"],
  noticePeriod: ["notice period", "notice", "np"],
  source: ["job portal", "source", "portal"],
  status: ["current status", "status"],
  nextAction: ["next action"],
  followUpDate: ["follow up date", "followup date", "next follow up", "next follow-up", "call back date", "callback date", "next call date", "fu date"],
  interviewDate: ["interview date", "f2f date", "virtual date", "schedule date", "scheduled date", "interview schedule", "date of interview", "f2f interview date", "virtual interview date"],
  joiningDate: ["joining date", "date of joining", "doj", "expected joining date", "tentative joining", "expected doj"],
  remarks: ["hr remarks", "remarks", "comments", "notes", "comment", "remark"],
  resumeUrl: ["resume url", "cv link", "resume link", "resume", "cv"],
};
// Section titles to ignore even if they land on the header row.
const SECTION_WORDS = ["basic information", "f2f interview", "hr evaluation", "sales assessment", "hr decision", "final", "interview", "evaluation", "assessment", "decision"];
const ALL_SYN = (() => { const s = new Set<string>(); for (const f in GUESS) GUESS[f].forEach(x => s.add(x)); return [...s]; })();

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isJunkHeader = (h: string) => !h || !h.trim() || /^__empty/i.test(h.trim()) || SECTION_WORDS.includes(norm(h));
function fieldMatchCount(cells: string[]): number {
  let score = 0;
  for (const c of cells) { const n = norm(c); if (!n) continue; if (ALL_SYN.some(s => n === s || n.includes(s) || s.includes(n))) score++; }
  return score;
}
// Header row = the row in the first 20 with the most field-name matches (section-title rows score low).
function detectHeaderRow(grid: string[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(20, grid.length); i++) {
    const s = fieldMatchCount(grid[i] ?? []);
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return best;
}
function guessMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  const taken = new Set<string>();
  for (const [field] of CRM_FIELDS) {
    const cands = (GUESS[field] ?? [field]).map(norm);
    const exact = headers.find(h => !taken.has(h) && cands.includes(norm(h)));
    const loose = exact ?? headers.find(h => !taken.has(h) && cands.some(c => norm(h).includes(c)));
    if (loose) { m[field] = loose; taken.add(loose); }
  }
  return m;
}
const sigOf = (headers: string[]) => "hrmap:" + headers.slice().sort().join("|");

export default function HRImportClient({ agents, defaultOwnerId }: { agents: Agent[]; defaultOwnerId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "map" | "run" | "done">("upload");
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [remembered, setRemembered] = useState(false);
  const [strategy, setStrategy] = useState<"skip" | "update" | "create">("skip");
  const [ownerId, setOwnerId] = useState(agents.find(a => a.id === defaultOwnerId)?.id ?? agents[0]?.id ?? defaultOwnerId);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, imported: 0, updated: 0, skipped: 0, failed: 0 });
  const [details, setDetails] = useState<{ followUpsCreated: number; interviewsCreated: number; noShowRecoveriesCreated: number; timelineEntriesCreated: number; missingStatus: number; errorCount: number; batchId: string | null } | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Re-derive headers, data rows and mapping for a chosen header row.
  function applyHeaderRow(g: string[][], hr: number) {
    const raw = (g[hr] ?? []).map(c => String(c ?? "").trim());
    const clean = raw.filter(h => !isJunkHeader(h));
    const data = g.slice(hr + 1).map(row => {
      const o: Record<string, string> = {};
      raw.forEach((h, j) => { if (!isJunkHeader(h)) o[h] = String(row[j] ?? "").trim(); });
      return o;
    }).filter(o => Object.values(o).some(v => v !== ""));
    let m: Record<string, string> = {}, fromSaved = false;
    try { const saved = localStorage.getItem(sigOf(clean)); if (saved) { m = JSON.parse(saved); fromSaved = true; } } catch { /* ignore */ }
    if (Object.keys(m).length === 0) m = guessMapping(clean);
    for (const k of Object.keys(m)) if (m[k] && !clean.includes(m[k])) delete m[k];
    setHeaders(clean); setRows(data); setMapping(m); setRemembered(fromSaved); setHeaderRow(hr);
  }

  async function onFile(file: File) {
    setErr(null); setNote(null); setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const g = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false }) as unknown[][])
        .map(r => r.map(c => String(c ?? "").trim()));
      if (g.length < 2) { setErr("That file has no data rows."); return; }
      setGrid(g);
      applyHeaderRow(g, detectHeaderRow(g));
      setStep("map");
    } catch {
      setErr("Could not read that file. Use .xlsx or .csv.");
    }
  }

  const usedCols = new Set(Object.values(mapping).filter(Boolean));
  const unmapped = headers.filter(h => !usedCols.has(h));
  const canImport = !!mapping.name || !!mapping.phone;
  const valOf = (r: Record<string, string>, col?: string) => (col ? (r[col] ?? "").trim() : "");
  const missingName = rows.filter(r => !valOf(r, mapping.name)).length;
  const missingPhone = rows.filter(r => !valOf(r, mapping.phone)).length;
  const validRows = rows.filter(r => valOf(r, mapping.name) || valOf(r, mapping.phone)).length;
  const previewFields = CRM_FIELDS.filter(([f]) => mapping[f]);

  // Map the spreadsheet rows to CRM fields exactly as the import expects. Shared
  // by both the dry-run preview and the real commit so they classify identically.
  function buildMappedRows() {
    return rows.map(r => {
      const o: Record<string, string> = {};
      for (const [field, col] of Object.entries(mapping)) if (col) o[field] = r[col] ?? "";
      return o;
    }).filter(o => (o.name ?? "").trim() || (o.phone ?? "").trim());
  }

  // Non-committing preview: sends the rows with ?dryRun=1 (no DB writes) and
  // shows the classification (new / update / skip / error) before anything runs.
  async function previewImport() {
    if (!canImport) { setErr("Cannot preview — map a column to Candidate Name or Phone."); return; }
    setErr(null); setNote(null);
    const mapped = buildMappedRows();
    if (mapped.length === 0) { setErr("No rows have a Name or Phone value — nothing to preview."); return; }

    setPreviewing(true);
    const BATCH = 100;
    const acc: PreviewData = { summary: { total: 0, new: 0, update: 0, skip: 0, error: 0, totalFollowUps: 0, totalInterviews: 0 }, rows: [] };
    try {
      for (let i = 0; i < mapped.length; i += BATCH) {
        const chunk = mapped.slice(i, i + BATCH);
        const res = await fetch("/api/hr/candidates/import?dryRun=1", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: chunk, strategy, primaryOwnerId: ownerId, importBatchId: null }),
        });
        const j = await res.json();
        if (!res.ok) { setErr(j.error ?? "Preview failed."); setPreviewing(false); return; }
        acc.summary.total += j.summary?.total || 0;
        acc.summary.new += j.summary?.new || 0;
        acc.summary.update += j.summary?.update || 0;
        acc.summary.skip += j.summary?.skip || 0;
        acc.summary.error += j.summary?.error || 0;
        acc.summary.totalFollowUps += j.summary?.totalFollowUps || 0;
        acc.summary.totalInterviews += j.summary?.totalInterviews || 0;
        // rowIndex from the server is chunk-relative — offset it back to the full set.
        if (Array.isArray(j.rows)) for (const pr of j.rows as PreviewRow[]) acc.rows.push({ ...pr, rowIndex: pr.rowIndex + i });
      }
      setPreviewData(acc); setShowPreview(true);
    } catch {
      setErr("Could not generate preview — check your connection and try again.");
    } finally {
      setPreviewing(false);
    }
  }

  async function runImport() {
    if (!canImport) { setErr("Cannot import — map a column to Candidate Name or Phone."); return; }
    setErr(null); setNote("⏳ Import started…");
    setShowPreview(false);
    try { localStorage.setItem(sigOf(headers), JSON.stringify(mapping)); } catch { /* ignore */ }
    setStep("run");
    const mapped = buildMappedRows();
    if (mapped.length === 0) { setErr("No rows have a Name or Phone value — nothing to import."); setNote("❌ Import failed: every row is missing both Name and Phone."); setStep("map"); return; }

    const BATCH = 100;
    const acc = { imported: 0, updated: 0, skipped: 0, failed: 0 };
    const extra = { followUpsCreated: 0, interviewsCreated: 0, noShowRecoveriesCreated: 0, timelineEntriesCreated: 0, missingStatus: 0 };
    const errorRows: { row: string; reason: string }[] = [];

    // Create the import batch up-front so every candidate is stamped with its
    // id — that's what lets an admin delete the whole batch later.
    let batchId: string | null = null;
    try {
      const r0 = await fetch("/api/hr/imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName, total: mapped.length }) });
      const j0 = await r0.json(); batchId = j0.id ?? null;
    } catch { /* best-effort — import still works unstamped */ }

    setProgress({ done: 0, total: mapped.length, ...acc });
    for (let i = 0; i < mapped.length; i += BATCH) {
      const chunk = mapped.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/hr/candidates/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: chunk, strategy, primaryOwnerId: ownerId, importBatchId: batchId }) });
        const j = await res.json();
        if (!res.ok) { setNote(`❌ Import failed: ${j.error ?? "server error"}`); setErr(j.error ?? "Import failed."); setStep("map"); return; }
        acc.imported += j.imported || 0; acc.updated += j.updated || 0; acc.skipped += j.skipped || 0; acc.failed += j.failed || 0;
        extra.followUpsCreated += j.followUpsCreated || 0; extra.interviewsCreated += j.interviewsCreated || 0;
        extra.noShowRecoveriesCreated += j.noShowRecoveriesCreated || 0; extra.timelineEntriesCreated += j.timelineEntriesCreated || 0;
        extra.missingStatus += j.missingStatus || 0;
        if (Array.isArray(j.errorRows)) errorRows.push(...j.errorRows);
      } catch { acc.failed += chunk.length; }
      setProgress({ done: Math.min(i + BATCH, mapped.length), total: mapped.length, ...acc });
    }
    setDetails({ ...extra, errorCount: errorRows.length, batchId });
    // Finalize the batch row with the real counts + error report.
    if (batchId) {
      try { await fetch(`/api/hr/imports/${batchId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total: mapped.length, imported: acc.imported, updated: acc.updated, skipped: acc.skipped, failed: acc.failed, errors: JSON.stringify(errorRows.slice(0, 2000)) }) }); } catch { /* best-effort */ }
    }
    setNote(`✅ Imported ${acc.imported} candidate${acc.imported !== 1 ? "s" : ""} successfully${acc.updated ? `, ${acc.updated} updated` : ""}${acc.skipped ? `, ${acc.skipped} skipped` : ""}${acc.failed ? `, ${acc.failed} failed` : ""}.`);
    setStep("done"); router.refresh();
  }

  const inp = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-800 dark:border-slate-600";
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const rowPreview = (cells: string[]) => cells.filter(c => c && c.trim()).slice(0, 6).join("  ·  ") || "(blank row)";

  return (
    <div className="card p-5 space-y-4">
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
      {note && <div className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded p-2 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-200">{note}</div>}

      {step === "upload" && (
        <label className="block border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-[#1a2e4a] transition">
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          <div className="text-3xl mb-2">📥</div>
          <div className="text-sm text-gray-600">Drop an <b>Excel (.xlsx)</b> or <b>CSV</b> file, or <b className="text-[#1a2e4a] dark:text-blue-400">click to browse</b></div>
          <div className="text-[11px] text-gray-400 mt-1">The header row is detected automatically — even with merged section titles.</div>
        </label>
      )}

      {step === "map" && (
        <div className="space-y-4">
          {/* Header row selector */}
          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 space-y-1.5">
            <div className="text-xs font-semibold text-gray-600">Header row <span className="font-normal text-gray-400">— which row holds the column names? (auto-detected)</span></div>
            {grid.slice(0, Math.min(8, grid.length)).map((r, i) => (
              <label key={i} className={`flex items-start gap-2 text-xs cursor-pointer rounded px-1.5 py-1 ${headerRow === i ? "bg-white dark:bg-slate-700 ring-1 ring-[#1a2e4a]/30" : ""}`}>
                <input type="radio" name="hr" checked={headerRow === i} onChange={() => applyHeaderRow(grid, i)} className="mt-0.5" />
                <span className="text-gray-400 shrink-0">Row {i + 1}:</span>
                <span className="text-gray-700 dark:text-slate-200 truncate">{rowPreview(r)}</span>
              </label>
            ))}
          </div>

          {/* Detected columns + counts */}
          <div className="text-sm text-gray-600">
            <b>{rows.length}</b> data rows · detected <b>{headers.length}</b> columns from <b>{fileName}</b>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[["Rows Found", rows.length, "text-gray-700"], ["Valid", validRows, "text-green-700"], ["Missing Name", missingName, "text-amber-700"], ["Missing Phone", missingPhone, "text-amber-700"]].map(([l, n, c]) => (
              <div key={l as string} className="rounded-lg border border-gray-200 dark:border-slate-700 p-2">
                <div className={`text-lg font-bold ${c}`}>{n as number}</div>
                <div className="text-[10px] text-gray-500">{l as string}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-gray-500">{remembered ? "✨ remembered this format" : "✨ auto-mapped"} — review &amp; correct if needed.</div>
            <button type="button" onClick={() => setMapping(guessMapping(headers))} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">↻ Auto Map Fields</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CRM_FIELDS.map(([field, label]) => {
              const mapped = !!mapping[field];
              const key = field === "name" || field === "phone";
              return (
                <div key={field} className="flex items-center gap-2">
                  <span className={`text-xs w-32 shrink-0 ${mapped ? "text-gray-700 dark:text-slate-200 font-medium" : "text-gray-400"}`}>{label}{key && <span className="text-amber-500"> ◦</span>}</span>
                  <select className={`${inp} ${mapped ? "border-green-300" : ""}`} value={mapping[field] ?? ""} onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}>
                    <option value="">— ignore —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              );
            })}
          </div>

          {unmapped.length > 0 && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2.5 dark:bg-amber-900/20 dark:border-amber-700">
              <span className="font-semibold text-amber-800 dark:text-amber-300">Unmapped columns ({unmapped.length}):</span>
              <span className="text-amber-700 dark:text-amber-200"> {unmapped.join(", ")}</span>
              <span className="text-amber-600"> — ignored automatically.</span>
            </div>
          )}

          {/* Preview of first 5 rows */}
          {previewFields.length > 0 && rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="text-[11px] w-full">
                <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-gray-500">{previewFields.map(([f, l]) => <th key={f} className="px-2 py-1 whitespace-nowrap">{l}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {rows.slice(0, 5).map((r, i) => <tr key={i}>{previewFields.map(([f]) => <td key={f} className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-slate-300 max-w-[140px] truncate">{r[mapping[f]] ?? ""}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-gray-100 dark:border-slate-700 pt-3 space-y-2">
            <div className="flex flex-wrap gap-3 text-sm">
              {([["skip", "Skip duplicates"], ["update", "Update existing"], ["create", "Create anyway"]] as const).map(([v, l]) => (
                <label key={v} className="flex items-center gap-1.5"><input type="radio" name="strat" checked={strategy === v} onChange={() => setStrategy(v)} /> {l}</label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-32 shrink-0">Assign owner</span>
              <select className={inp} value={ownerId} onChange={e => setOwnerId(e.target.value)}>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </div>
          </div>

          {!canImport ? (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5"><b>Cannot import because:</b><div className="mt-0.5">• Candidate Name <b>or</b> Phone must be mapped above.</div></div>
          ) : (
            <div className="text-[11px] text-green-700">✓ Ready — {validRows} valid rows. Rows with no name save as “Candidate - &lt;phone&gt;”.</div>
          )}

          {canImport && !mapping.status && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200">
              ⚠ <b>Status column not mapped.</b> All candidates will be imported as <b>New</b>. Map a “Status” column above to preserve each candidate’s real recruitment stage.
            </div>
          )}
          {canImport && (mapping.followUpDate || mapping.interviewDate) && (
            <div className="text-[11px] text-gray-500">📅 Follow-up / interview dates will create dashboard tasks (Calls Due, Interviews Today, No-Show Recovery) and a timeline entry per candidate.</div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={previewImport} disabled={!canImport || previewing}
              className={`btn justify-center inline-flex items-center gap-1.5 ${canImport && !previewing ? "btn-primary" : "bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500"}`}
              title={canImport ? "See what will happen before anything is saved" : "Map Candidate Name or Phone first"}>
              {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
              {previewing ? "Building preview…" : `Preview Import (${validRows || rows.length})`}
            </button>
            <button type="button" onClick={runImport} disabled={!canImport}
              className={`btn justify-center px-4 border rounded-lg text-sm ${canImport ? "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800" : "border-gray-200 text-gray-300 cursor-not-allowed dark:border-slate-700 dark:text-slate-600"}`}
              title={canImport ? "Skip the preview and import now" : "Map Candidate Name or Phone first"}>
              Import now
            </button>
            <button type="button" onClick={() => setStep("upload")} className="btn justify-center px-4 border border-gray-300 text-gray-600 rounded-lg text-sm dark:border-slate-600 dark:text-slate-300">Back</button>
          </div>
        </div>
      )}

      {showPreview && previewData && (
        <ImportPreview data={previewData} onConfirm={runImport} onBack={() => setShowPreview(false)} />
      )}

      {step === "run" && (
        <div className="space-y-3 py-4">
          <div className="text-sm font-semibold text-gray-700">Importing… {progress.done} / {progress.total}</div>
          <div className="w-full h-3 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-[#1a2e4a] transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="text-[11px] text-gray-500">✅ {progress.imported} new · 🔄 {progress.updated} updated · ⏭ {progress.skipped} skipped · ⚠ {progress.failed} failed — keep this tab open.</div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3 text-center py-4">
          <div className="text-4xl">🎉</div>
          <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">Import complete</div>
          <div className="text-sm text-gray-600">✅ {progress.imported} new · 🔄 {progress.updated} updated · ⏭ {progress.skipped} skipped · ⚠ {progress.failed} failed</div>
          {details && (
            <div className="mx-auto max-w-md text-left text-xs bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3 space-y-1">
              <div className="font-semibold text-gray-700 dark:text-slate-200 mb-1">Workflow created</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-600 dark:text-slate-300">
                <span>📞 Follow-ups created</span><span className="text-right tabular-nums">{details.followUpsCreated}</span>
                <span>🗓 Interviews created</span><span className="text-right tabular-nums">{details.interviewsCreated}</span>
                <span>🔁 No-show recoveries</span><span className="text-right tabular-nums">{details.noShowRecoveriesCreated}</span>
                <span>📝 Timeline entries</span><span className="text-right tabular-nums">{details.timelineEntriesCreated}</span>
                {details.missingStatus > 0 && (<><span>⚠ Rows with no status (→ New)</span><span className="text-right tabular-nums">{details.missingStatus}</span></>)}
                {details.errorCount > 0 && (<><span className="text-red-600">⚠ Failed rows</span><span className="text-right tabular-nums text-red-600">{details.errorCount}</span></>)}
              </div>
              <div className="pt-1 text-gray-500">Every other status was preserved exactly as in Excel and mapped to a CRM category.</div>
              {details.errorCount > 0 && details.batchId && (
                <a href={`/api/hr/imports/${details.batchId}`} className="inline-block pt-1 text-blue-600 hover:underline">⬇ Download error report (CSV)</a>
              )}
            </div>
          )}
          <div className="flex gap-2 justify-center">
            <Link href="/hr/candidates" className="btn btn-primary justify-center">View candidates</Link>
            <button type="button" onClick={() => { setStep("upload"); setGrid([]); setHeaders([]); setRows([]); setMapping({}); setNote(null); setPreviewData(null); setShowPreview(false); }} className="btn justify-center px-4 border border-gray-300 text-gray-600 rounded-lg text-sm">Import another</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dry-run preview modal ──────────────────────────────────────────────────
// Shows the server's non-committing classification (new / update / skip / error)
// before anything is written. Confirm runs the real import; Back returns to map.
const ACTION_META: Record<PreviewAction, { label: string; cls: string; Icon: typeof UserPlus }> = {
  new: { label: "New", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300", Icon: UserPlus },
  update: { label: "Update", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", Icon: RefreshCw },
  skip: { label: "Skip", cls: "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300", Icon: SkipForward },
  error: { label: "Error", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300", Icon: AlertTriangle },
};

function ImportPreview({ data, onConfirm, onBack }: { data: PreviewData; onConfirm: () => void; onBack: () => void }) {
  const { summary, rows } = data;
  const willWrite = summary.new + summary.update;
  const cards: { key: PreviewAction; n: number }[] = [
    { key: "new", n: summary.new }, { key: "update", n: summary.update },
    { key: "skip", n: summary.skip }, { key: "error", n: summary.error },
  ];
  const sample = rows.slice(0, 20);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 dark:bg-black/60" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-xl">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
          <Eye className="w-5 h-5 text-blue-600 dark:text-blue-300" />
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Import Preview</h2>
            <p className="text-xs text-gray-500 dark:text-slate-400">Nothing has been saved yet. Review the {summary.total} rows below, then confirm.</p>
          </div>
        </div>

        <div className="px-5 py-3 space-y-3 overflow-y-auto">
          {/* Summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {cards.map(({ key, n }) => {
              const m = ACTION_META[key];
              return (
                <div key={key} className="rounded-lg border border-gray-200 dark:border-slate-700 p-2">
                  <div className="flex items-center justify-center gap-1.5">
                    <m.Icon className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                    <span className="text-lg font-bold text-gray-800 dark:text-slate-100 tabular-nums">{n}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-slate-400">{m.label}</div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-slate-400">
            <span>📞 {summary.totalFollowUps} follow-ups will be created</span>
            <span>🗓 {summary.totalInterviews} interviews will be created</span>
          </div>

          {/* Per-row classification (first 20) */}
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
            <table className="text-[11px] w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800 text-left text-gray-500 dark:text-slate-400">
                  <th className="px-2 py-1.5 whitespace-nowrap">#</th>
                  <th className="px-2 py-1.5 whitespace-nowrap">Candidate</th>
                  <th className="px-2 py-1.5 whitespace-nowrap">Action</th>
                  <th className="px-2 py-1.5 whitespace-nowrap">Status</th>
                  <th className="px-2 py-1.5 whitespace-nowrap text-right">F/U</th>
                  <th className="px-2 py-1.5 whitespace-nowrap text-right">Intv</th>
                  <th className="px-2 py-1.5 whitespace-nowrap">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {sample.map(r => {
                  const m = ACTION_META[r.action];
                  return (
                    <tr key={r.rowIndex} className="text-gray-700 dark:text-slate-300">
                      <td className="px-2 py-1 tabular-nums text-gray-400">{r.rowIndex + 1}</td>
                      <td className="px-2 py-1 whitespace-nowrap max-w-[160px] truncate font-medium">{r.candidateName}</td>
                      <td className="px-2 py-1">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${m.cls}`}>
                          <m.Icon className="w-3 h-3" />{m.label}
                        </span>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.status || "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.workflowCount.followUps || ""}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.workflowCount.interviews || ""}</td>
                      <td className="px-2 py-1 max-w-[220px] truncate text-gray-500 dark:text-slate-400" title={r.reason}>{r.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > sample.length && (
            <div className="text-[11px] text-gray-400 dark:text-slate-500">Showing first {sample.length} of {rows.length} rows.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onBack} className="btn justify-center px-4 inline-flex items-center gap-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            <ArrowLeft className="w-4 h-4" /> Back to Edit
          </button>
          <button type="button" onClick={onConfirm} disabled={willWrite === 0}
            className={`btn justify-center inline-flex items-center gap-1.5 ${willWrite > 0 ? "btn-primary" : "bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500"}`}
            title={willWrite > 0 ? "Commit this import" : "No rows would be created or updated"}>
            <CheckCircle2 className="w-4 h-4" /> Confirm Import ({willWrite})
          </button>
        </div>
      </div>
    </div>
  );
}
