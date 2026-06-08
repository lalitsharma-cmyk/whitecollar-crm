"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Agent { id: string; name: string; team: string | null; }

interface PreviewResult {
  preview: true;
  totalRows: number;
  newRows: number;
  dupRows: number;
  missingName: number;
  missingPhone: number;
  missingProject: number;
  dupSamples: { name: string; phone: string; existingStatus: string }[];
  uniqueStatuses: string[];
  detectedColumns: string[];
  fileType: string;
  sheetName?: string;
  allSheets?: string[];
  automationNote: string;
}

interface ImportResult {
  fileType?: string; sheetName?: string; allSheets?: string[];
  rowsProcessed?: number; created: number; deduped: number; enriched: number;
  callLogsCreated?: number; autofilled?: number;
  detectedColumns?: string[]; errors?: string[];
}

export default function CsvUploader({ agents = [] }: { agents?: Agent[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [campaign, setCampaign] = useState("");
  const [leadOrigin, setLeadOrigin] = useState<"ACTIVE" | "COLD" | "PORTFOLIO">("COLD");
  const [forceTeam, setForceTeam] = useState<"ask" | "Dubai" | "India">("ask");
  const [assignToUserId, setAssignToUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<{ msg: string; hint?: string } | null>(null);

  function buildFormData() {
    const fd = new FormData();
    fd.append("file", file!);
    if (campaign) fd.append("campaign", campaign);
    fd.append("leadOrigin", leadOrigin);
    fd.append("forceTeam", forceTeam);
    if (assignToUserId) fd.append("assignToUserId", assignToUserId);
    return fd;
  }

  async function runPreview() {
    if (!file) return;
    if (forceTeam === "ask") { setErr({ msg: "Pick a team first (Dubai or India)." }); return; }
    setBusy(true); setErr(null); setPreview(null); setResult(null);
    try {
      const res = await fetch("/api/intake/csv?preview=1", { method: "POST", body: buildFormData() });
      const json = await res.json().catch(() => ({ error: "Server returned invalid response" }));
      if (!res.ok) { setErr({ msg: json.error ?? `Preview failed (HTTP ${res.status})`, hint: json.hint }); return; }
      setPreview(json as PreviewResult);
    } catch (e) {
      setErr({ msg: `Network error: ${String(e)}` });
    } finally { setBusy(false); }
  }

  async function confirmImport() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/intake/csv", { method: "POST", body: buildFormData() });
      const json = await res.json().catch(() => ({ error: "Server returned invalid response" }));
      if (!res.ok) { setErr({ msg: json.error ?? `Import failed (HTTP ${res.status})`, hint: json.hint }); return; }
      setResult(json as ImportResult);
      setPreview(null);
      router.refresh();
    } catch (e) {
      setErr({ msg: `Network error: ${String(e)}` });
    } finally { setBusy(false); }
  }

  function resetAll() { setFile(null); setPreview(null); setResult(null); setErr(null); }

  return (
    <div>
      {/* ── Import Safe Mode banner ── */}
      <div className="mb-4 p-3 rounded-lg border border-emerald-300 bg-emerald-50 flex items-start gap-2">
        <span className="text-lg mt-0.5">🔒</span>
        <div>
          <div className="text-xs font-bold text-emerald-800">Import Safe Mode is ON</div>
          <div className="text-[11px] text-emerald-700 mt-0.5">
            No automation fires during import — no WhatsApp, no emails, no round-robin assignment, no SLA alerts, no escalations.
            Imported data is stored and shown in the CRM only. You enable automation separately after reviewing the data.
          </div>
        </div>
      </div>

      {/* Import type */}
      <div className="mb-4">
        <label className="block text-sm font-semibold mb-2">Import type <span className="text-red-500">*</span></label>
        <div className="flex flex-col gap-2">
          {[
            { val: "ACTIVE" as const, label: "Active Leads", desc: "Appears in Leads page", color: "accent-[#0b1a33]" },
            { val: "COLD" as const, label: "Cold Data / Revival Engine", desc: "Only visible in Revival Engine", color: "accent-amber-500" },
            { val: "PORTFOLIO" as const, label: "Historical Purchase Records", desc: "Portfolio / purchase history only", color: "accent-blue-500" },
          ].map(({ val, label, desc, color }) => (
            <label key={val} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="importType" value={val} checked={leadOrigin === val} onChange={() => setLeadOrigin(val)} className={color} />
              <span><b>{label}</b> — {desc}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Team picker */}
      <div className={`mb-3 p-3 rounded-lg border-2 ${forceTeam === "ask" ? "border-amber-400 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`}>
        <div className="text-xs font-bold uppercase tracking-widest text-gray-700 mb-1.5">
          Which team? <span className="text-red-600">*</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(["Dubai", "India"] as const).map(t => (
            <label key={t} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer ${forceTeam === t ? "border-emerald-500 bg-white" : "border-[#e5e7eb] bg-white/50"}`}>
              <input type="radio" name="forceTeam" value={t} checked={forceTeam === t} onChange={() => setForceTeam(t)} />
              <span className="text-sm font-semibold">{t === "Dubai" ? "🇦🇪" : "🇮🇳"} {t} team</span>
            </label>
          ))}
        </div>
      </div>

      {/* Sheet owner */}
      {agents.length > 0 && (
        <div className={`mb-3 p-3 rounded-lg border ${assignToUserId ? "border-emerald-300 bg-emerald-50" : "border-[#e5e7eb] bg-[#f7f8fa]"}`}>
          <div className="text-xs font-bold uppercase tracking-widest text-gray-700 mb-1.5">
            Whose sheet? <span className="text-gray-400 font-normal">(optional)</span>
          </div>
          <select value={assignToUserId} onChange={e => setAssignToUserId(e.target.value)}
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm bg-white min-h-11">
            <option value="">— Cold data (no owner) —</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.team ? ` · ${a.team}` : ""}</option>)}
          </select>
        </div>
      )}

      <input type="text" placeholder="Campaign (optional)" value={campaign} onChange={e => setCampaign(e.target.value)}
        className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm mb-2" />

      {/* File picker */}
      {!preview && !result && (
        <label className="block border-2 border-dashed border-[#e5e7eb] rounded-lg p-6 text-center text-sm text-gray-500 cursor-pointer hover:border-[#c9a24b]">
          <input type="file"
            accept=".csv,.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null); setErr(null); setPreview(null); }}
            className="hidden" />
          {file ? <span>📄 {file.name} · {(file.size / 1024).toFixed(1)} KB</span>
                : <span>Drop CSV or Excel here, or <b className="text-[#0b1a33]">click to browse</b></span>}
        </label>
      )}

      {file && !preview && !result && (
        <button onClick={runPreview} disabled={busy} className="btn btn-primary w-full justify-center mt-3">
          {busy ? "Scanning file…" : `📋 Preview import — ${file.name}`}
        </button>
      )}

      {/* ── Preview results ── */}
      {preview && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
          <div className="font-bold text-blue-900 text-sm flex items-center gap-2">
            📋 Import Preview
            <span className="text-[11px] font-normal text-blue-700">— nothing has been imported yet</span>
          </div>

          {/* Summary counts */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white rounded-lg p-2.5 border border-blue-100">
              <div className="text-xl font-bold text-[#0b1a33]">{preview.totalRows}</div>
              <div className="text-[10px] text-gray-500">Total rows</div>
            </div>
            <div className="bg-white rounded-lg p-2.5 border border-emerald-100">
              <div className="text-xl font-bold text-emerald-700">{preview.newRows}</div>
              <div className="text-[10px] text-gray-500">New leads</div>
            </div>
            <div className="bg-white rounded-lg p-2.5 border border-amber-100">
              <div className="text-xl font-bold text-amber-700">{preview.dupRows}</div>
              <div className="text-[10px] text-gray-500">Duplicates</div>
            </div>
          </div>

          {/* Warnings */}
          {(preview.missingName > 0 || preview.missingPhone > 0 || preview.missingProject > 0) && (
            <div className="text-[11px] space-y-0.5">
              {preview.missingName > 0 && <div className="text-amber-700">⚠ {preview.missingName} rows missing name</div>}
              {preview.missingPhone > 0 && <div className="text-amber-700">⚠ {preview.missingPhone} rows missing phone number</div>}
              {preview.missingProject > 0 && <div className="text-gray-500">ℹ {preview.missingProject} rows have no Project column value</div>}
            </div>
          )}

          {/* Duplicate samples */}
          {preview.dupSamples.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-amber-700 font-semibold">
                {preview.dupRows} duplicate{preview.dupRows === 1 ? "" : "s"} found — click to see samples ↓
              </summary>
              <div className="mt-2 space-y-1">
                {preview.dupSamples.map((d, i) => (
                  <div key={i} className="bg-amber-50 border border-amber-100 rounded px-2 py-1">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-gray-500"> · {d.phone}</span>
                    <span className="ml-2 text-amber-700">existing: {d.existingStatus}</span>
                  </div>
                ))}
                {preview.dupRows > preview.dupSamples.length && (
                  <div className="text-gray-400">…and {preview.dupRows - preview.dupSamples.length} more</div>
                )}
              </div>
            </details>
          )}

          {/* Automation safety */}
          <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
            🔒 {preview.automationNote}
          </div>

          {/* Detected columns */}
          {preview.detectedColumns.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-blue-700">Mapped columns ({preview.detectedColumns.length}) ↓</summary>
              <div className="mt-1 font-mono text-gray-600">{preview.detectedColumns.join(" · ")}</div>
            </details>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <button onClick={confirmImport} disabled={busy}
              className="flex-1 btn btn-primary justify-center">
              {busy ? "Importing…" : `✅ Confirm — import ${preview.newRows} new lead${preview.newRows === 1 ? "" : "s"}`}
            </button>
            <button onClick={resetAll} disabled={busy}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Import success ── */}
      {result && (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3 space-y-1">
          <div className="font-bold">✅ Import complete</div>
          <div>
            {result.fileType && <><b>{result.fileType}</b>{result.sheetName && <> · Sheet: <code>{result.sheetName}</code></>} · </>}
            <b>{result.rowsProcessed}</b> rows · <b>{result.created}</b> new · <b>{result.deduped}</b> merged · <b>{result.enriched}</b> enriched
          </div>
          <div className="text-[11px] text-emerald-700">🔒 Import Safe Mode was ON — no WhatsApp, emails, or assignments fired automatically.</div>
          {result.detectedColumns && result.detectedColumns.length > 0 && (
            <details>
              <summary className="text-[11px] cursor-pointer">Columns mapped ↓</summary>
              <div className="text-[11px] mt-1 font-mono">{result.detectedColumns.join(" · ")}</div>
            </details>
          )}
          {result.errors && result.errors.length > 0 && (
            <details>
              <summary className="text-[11px] text-amber-700 cursor-pointer">{result.errors.length} row errors ↓</summary>
              <ul className="text-[11px] mt-1 list-disc list-inside">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
          <button onClick={resetAll} className="text-[11px] text-emerald-600 hover:underline mt-1">Import another file</button>
        </div>
      )}

      {err && (
        <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">
          <div className="font-bold">❌ Failed</div>
          <div>{err.msg}</div>
          {err.hint && <div className="text-xs mt-1 text-red-700">💡 {err.hint}</div>}
        </div>
      )}
    </div>
  );
}
