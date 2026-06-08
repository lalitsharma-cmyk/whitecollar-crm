"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";

interface Agent { id: string; name: string; }
const CRM_FIELDS: [string, string][] = [
  ["name", "Candidate Name *"], ["phone", "Phone"], ["whatsappPhone", "WhatsApp"], ["email", "Email"],
  ["location", "Location"], ["city", "City"], ["currentCompany", "Current Company"], ["currentProfile", "Current Profile"],
  ["positionApplied", "Position Applied"], ["experience", "Total Experience"], ["realEstateExperience", "RE Experience"],
  ["currentSalary", "Current Salary"], ["expectedSalary", "Expected Salary"], ["noticePeriod", "Notice Period"],
  ["source", "Source"], ["status", "Status"], ["nextAction", "Next Action"], ["remarks", "Initial Notes"], ["resumeUrl", "Resume URL"],
];
const GUESS: Record<string, string[]> = {
  name: ["candidate name", "name", "full name"], phone: ["mobile", "phone", "contact", "number"],
  whatsappPhone: ["whatsapp", "wa"], email: ["email", "mail"], location: ["location", "current location"], city: ["city", "home city"],
  currentCompany: ["company", "current company"], currentProfile: ["designation", "profile", "current role", "title", "current profile"],
  positionApplied: ["position", "applied", "role applied"], experience: ["total experience", "experience", "exp"], realEstateExperience: ["real estate", "re exp"],
  currentSalary: ["current salary", "current ctc", "present salary"], expectedSalary: ["expected salary", "expected ctc"], noticePeriod: ["notice"],
  source: ["source"], status: ["status"], nextAction: ["next action"], remarks: ["remark", "notes", "initial notes", "comment"], resumeUrl: ["resume", "cv", "resume url", "resume link"],
};

function guessMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [field] of CRM_FIELDS) {
    const cands = GUESS[field] ?? [field];
    const hit = headers.find(h => cands.some(c => h.toLowerCase().trim() === c)) ?? headers.find(h => cands.some(c => h.toLowerCase().includes(c)));
    if (hit) m[field] = hit;
  }
  return m;
}

export default function HRImportClient({ agents, defaultOwnerId }: { agents: Agent[]; defaultOwnerId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "map" | "run" | "done">("upload");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [strategy, setStrategy] = useState<"skip" | "update" | "create">("skip");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, imported: 0, updated: 0, skipped: 0, failed: 0 });

  async function onFile(file: File) {
    setErr(null); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const parsed = json.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "").trim()])));
      if (parsed.length === 0) { setErr("That file has no data rows."); return; }
      const hdrs = Object.keys(parsed[0]);
      setRows(parsed); setHeaders(hdrs); setMapping(guessMapping(hdrs)); setStep("map");
    } catch {
      setErr("Could not read that file. Use .xlsx or .csv.");
    }
  }

  async function runImport() {
    if (!mapping.name) { setErr("Map a column to Candidate Name first."); return; }
    setErr(null); setStep("run");
    const mapped = rows.map(r => {
      const o: Record<string, string> = {};
      for (const [field, col] of Object.entries(mapping)) if (col) o[field] = r[col] ?? "";
      return o;
    }).filter(o => (o.name ?? "").trim());

    const BATCH = 100;
    const acc = { imported: 0, updated: 0, skipped: 0, failed: 0 };
    setProgress({ done: 0, total: mapped.length, ...acc });
    for (let i = 0; i < mapped.length; i += BATCH) {
      const chunk = mapped.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/hr/candidates/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: chunk, strategy, primaryOwnerId: ownerId }) });
        const j = await res.json();
        if (!res.ok) { setErr(j.error ?? "Import failed."); setStep("map"); return; }
        acc.imported += j.imported || 0; acc.updated += j.updated || 0; acc.skipped += j.skipped || 0; acc.failed += j.failed || 0;
      } catch { acc.failed += chunk.length; }
      setProgress({ done: Math.min(i + BATCH, mapped.length), total: mapped.length, ...acc });
    }
    try { await fetch("/api/hr/imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName, total: mapped.length, ...acc }) }); } catch { /* log best-effort */ }
    setStep("done"); router.refresh();
  }

  const inp = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-800 dark:border-slate-600";
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="card p-5 space-y-4">
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}

      {step === "upload" && (
        <label className="block border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-[#1a2e4a] transition">
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          <div className="text-3xl mb-2">📥</div>
          <div className="text-sm text-gray-600">Drop an <b>Excel (.xlsx)</b> or <b>CSV</b> file, or <b className="text-[#1a2e4a] dark:text-blue-400">click to browse</b></div>
          <div className="text-[11px] text-gray-400 mt-1">Export your Google Sheet as .xlsx or .csv and upload it here.</div>
        </label>
      )}

      {step === "map" && (
        <div className="space-y-4">
          <div className="text-sm text-gray-600">{rows.length} rows from <b>{fileName}</b> · map your columns to CRM fields:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CRM_FIELDS.map(([field, label]) => (
              <div key={field} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-32 shrink-0">{label}</span>
                <select className={inp} value={mapping[field] ?? ""} onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}>
                  <option value="">— ignore —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

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

          <div className="flex gap-2">
            <button type="button" onClick={runImport} className="btn btn-primary justify-center">Import {rows.length} candidates</button>
            <button type="button" onClick={() => setStep("upload")} className="btn justify-center px-4 border border-gray-300 text-gray-600 rounded-lg text-sm">Back</button>
          </div>
        </div>
      )}

      {step === "run" && (
        <div className="space-y-3 py-4">
          <div className="text-sm font-semibold text-gray-700">Importing… {progress.done} / {progress.total}</div>
          <div className="w-full h-3 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-[#1a2e4a] transition-all" style={{ width: `${pct}%` }} />
          </div>
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
            <button type="button" onClick={() => { setStep("upload"); setRows([]); setHeaders([]); setMapping({}); }} className="btn justify-center px-4 border border-gray-300 text-gray-600 rounded-lg text-sm">Import another</button>
          </div>
        </div>
      )}
    </div>
  );
}
