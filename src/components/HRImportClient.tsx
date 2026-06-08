"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";

interface Agent { id: string; name: string; }
const CRM_FIELDS: [string, string][] = [
  ["name", "Candidate Name"], ["phone", "Phone"], ["whatsappPhone", "WhatsApp"], ["email", "Email"],
  ["location", "Location"], ["city", "City"], ["currentCompany", "Current Company"], ["currentProfile", "Current Profile"],
  ["positionApplied", "Position Applied"], ["experience", "Total Experience"], ["realEstateExperience", "RE Experience"],
  ["currentSalary", "Current Salary"], ["expectedSalary", "Expected Salary"], ["noticePeriod", "Notice Period"],
  ["source", "Source"], ["status", "Status"], ["nextAction", "Next Action"], ["remarks", "Initial Notes"], ["resumeUrl", "Resume URL"],
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
  remarks: ["hr remarks", "remarks", "comments", "notes", "comment", "remark"],
  resumeUrl: ["resume url", "cv link", "resume link", "resume", "cv"],
};
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
// Drop SheetJS junk (blank headers become __EMPTY, __EMPTY_1, …) so they never clutter the picker.
const cleanHeaders = (hdrs: string[]) => hdrs.filter(h => h && h.trim() && !/^__empty/i.test(h.trim()));
const sigOf = (headers: string[]) => "hrmap:" + headers.slice().sort().join("|");

export default function HRImportClient({ agents, defaultOwnerId }: { agents: Agent[]; defaultOwnerId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "map" | "run" | "done">("upload");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [remembered, setRemembered] = useState(false);
  const [strategy, setStrategy] = useState<"skip" | "update" | "create">("skip");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, imported: 0, updated: 0, skipped: 0, failed: 0 });

  async function onFile(file: File) {
    setErr(null); setNote(null); setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const parsed = json.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "").trim()])));
      if (parsed.length === 0) { setErr("That file has no data rows."); return; }
      const hdrs = cleanHeaders(Object.keys(parsed[0]));
      if (hdrs.length === 0) { setErr("No usable column headers found in the first row."); return; }
      let m: Record<string, string> = {}, fromSaved = false;
      try { const saved = localStorage.getItem(sigOf(hdrs)); if (saved) { m = JSON.parse(saved); fromSaved = true; } } catch { /* ignore */ }
      if (Object.keys(m).length === 0) m = guessMapping(hdrs);
      // Drop any saved mapping that points at a column no longer present.
      for (const k of Object.keys(m)) if (m[k] && !hdrs.includes(m[k])) delete m[k];
      setRows(parsed); setHeaders(hdrs); setMapping(m); setRemembered(fromSaved); setStep("map");
    } catch {
      setErr("Could not read that file. Use .xlsx or .csv.");
    }
  }

  const usedCols = new Set(Object.values(mapping).filter(Boolean));
  const unmapped = headers.filter(h => !usedCols.has(h));
  const canImport = !!mapping.name || !!mapping.phone;
  const mappedCount = Object.values(mapping).filter(Boolean).length;

  async function runImport() {
    if (!canImport) { setErr("Cannot import — map a column to Candidate Name or Phone."); return; }
    setErr(null); setNote("⏳ Import started…");
    try { localStorage.setItem(sigOf(headers), JSON.stringify(mapping)); } catch { /* ignore */ }
    setStep("run");
    const mapped = rows.map(r => {
      const o: Record<string, string> = {};
      for (const [field, col] of Object.entries(mapping)) if (col) o[field] = r[col] ?? "";
      return o;
    }).filter(o => (o.name ?? "").trim() || (o.phone ?? "").trim());

    if (mapped.length === 0) { setErr("No rows have a Name or Phone value — nothing to import."); setNote("❌ Import failed: every row is missing both Name and Phone."); setStep("map"); return; }

    const BATCH = 100;
    const acc = { imported: 0, updated: 0, skipped: 0, failed: 0 };
    setProgress({ done: 0, total: mapped.length, ...acc });
    for (let i = 0; i < mapped.length; i += BATCH) {
      const chunk = mapped.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/hr/candidates/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: chunk, strategy, primaryOwnerId: ownerId }) });
        const j = await res.json();
        if (!res.ok) { setNote(`❌ Import failed: ${j.error ?? "server error"}`); setErr(j.error ?? "Import failed."); setStep("map"); return; }
        acc.imported += j.imported || 0; acc.updated += j.updated || 0; acc.skipped += j.skipped || 0; acc.failed += j.failed || 0;
      } catch { acc.failed += chunk.length; }
      setProgress({ done: Math.min(i + BATCH, mapped.length), total: mapped.length, ...acc });
    }
    try { await fetch("/api/hr/imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName, total: mapped.length, ...acc }) }); } catch { /* best-effort */ }
    setNote(`✅ Imported ${acc.imported} candidate${acc.imported !== 1 ? "s" : ""} successfully${acc.updated ? `, ${acc.updated} updated` : ""}${acc.skipped ? `, ${acc.skipped} skipped` : ""}${acc.failed ? `, ${acc.failed} failed` : ""}.`);
    setStep("done"); router.refresh();
  }

  const inp = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-800 dark:border-slate-600";
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="card p-5 space-y-4">
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
      {note && <div className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded p-2 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-200">{note}</div>}

      {step === "upload" && (
        <label className="block border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-[#1a2e4a] transition">
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          <div className="text-3xl mb-2">📥</div>
          <div className="text-sm text-gray-600">Drop an <b>Excel (.xlsx)</b> or <b>CSV</b> file, or <b className="text-[#1a2e4a] dark:text-blue-400">click to browse</b></div>
          <div className="text-[11px] text-gray-400 mt-1">Columns are mapped automatically — you just review &amp; confirm.</div>
        </label>
      )}

      {step === "map" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-gray-600">
              {rows.length} rows from <b>{fileName}</b> · {remembered ? "✨ remembered this format" : `✨ auto-mapped ${mappedCount} columns`} — review &amp; correct if needed.
            </div>
            <button type="button" onClick={() => { setMapping(guessMapping(headers)); setRemembered(false); }} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">↻ Auto Map Fields</button>
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

          <div className="border-t border-gray-100 dark:border-slate-700 pt-3 space-y-2">
            <div className="text-xs font-semibold text-gray-600">On duplicate (same phone / email):</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {([["skip", "Skip"], ["update", "Update existing"], ["create", "Create anyway"]] as const).map(([v, l]) => (
                <label key={v} className="flex items-center gap-1.5"><input type="radio" name="strat" checked={strategy === v} onChange={() => setStrategy(v)} /> {l}</label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-32 shrink-0">Assign owner</span>
              <select className={inp} value={ownerId} onChange={e => setOwnerId(e.target.value)}>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </div>
          </div>

          {/* Validation status — always shows whether import can run, and why not. */}
          {!canImport ? (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">
              <b>Cannot import because:</b>
              <div className="mt-0.5">• Candidate Name <b>or</b> Phone must be mapped above.</div>
            </div>
          ) : (
            <div className="text-[11px] text-green-700">✓ Ready — rows with no name will be saved as “Candidate - &lt;phone&gt;”.</div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={runImport} disabled={!canImport}
              className={`btn justify-center ${canImport ? "btn-primary" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
              title={canImport ? "" : "Map Candidate Name or Phone first"}>
              Confirm &amp; Import {rows.length}
            </button>
            <button type="button" onClick={() => setStep("upload")} className="btn justify-center px-4 border border-gray-300 text-gray-600 rounded-lg text-sm">Back</button>
          </div>
        </div>
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
          <div className="flex gap-2 justify-center">
            <Link href="/hr/candidates" className="btn btn-primary justify-center">View candidates</Link>
            <button type="button" onClick={() => { setStep("upload"); setRows([]); setHeaders([]); setMapping({}); setNote(null); }} className="btn justify-center px-4 border border-gray-300 text-gray-600 rounded-lg text-sm">Import another</button>
          </div>
        </div>
      )}
    </div>
  );
}
