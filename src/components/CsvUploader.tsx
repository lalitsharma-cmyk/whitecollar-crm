"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Agent { id: string; name: string; team: string | null; }

export default function CsvUploader({ agents = [] }: { agents?: Agent[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [campaign, setCampaign] = useState("");
  // Team override — admin picks which team this whole import belongs to.
  // Lalit reported same sheet landing as both India + Dubai when auto-detection
  // mis-guessed per row. "ask" forces the picker to be deliberate (no default).
  const [forceTeam, setForceTeam] = useState<"ask" | "Dubai" | "India">("ask");
  // Sheet-owner picker. If admin is importing Mehak's MIS, they pick "Mehak"
  // here. Every new lead becomes Mehak's lead AND every unattributed remark
  // entry ("on 3 May (12:36) …" without a name prefix) gets credited to Mehak
  // in the Call History card — instead of showing as "Admin" (the importer).
  const [assignToUserId, setAssignToUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    fileType?: string; sheetName?: string; allSheets?: string[];
    rowsProcessed?: number; created: number; deduped: number; enriched: number; callLogsCreated?: number;
    autofilled?: number;
    detectedColumns?: string[]; errors?: string[];
  } | null>(null);
  const [err, setErr] = useState<{ msg: string; hint?: string } | null>(null);

  async function upload() {
    if (!file) return;
    if (forceTeam === "ask") {
      setErr({ msg: "Pick a team for this import first (Dubai or India)." });
      return;
    }
    setBusy(true); setErr(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (campaign) fd.append("campaign", campaign);
      fd.append("forceTeam", forceTeam);
      if (assignToUserId) fd.append("assignToUserId", assignToUserId);
      const res = await fetch("/api/intake/csv", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({ error: "Server returned invalid response" }));
      if (!res.ok) {
        setErr({ msg: json.error ?? `Upload failed (HTTP ${res.status})`, hint: json.hint });
        return;
      }
      setResult(json);
      router.refresh();
    } catch (e) {
      setErr({ msg: `Network error: ${String(e)}` });
    } finally { setBusy(false); }
  }

  return (
    <div>
      {/* MANDATORY team picker — must be set before upload button enables */}
      <div className={`mb-3 p-3 rounded-lg border-2 ${forceTeam === "ask" ? "border-amber-400 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`}>
        <div className="text-xs font-bold uppercase tracking-widest text-gray-700 mb-1.5">
          Which team are these leads for? <span className="text-red-600">*</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer min-h-11 ${forceTeam === "Dubai" ? "border-emerald-500 bg-white" : "border-[#e5e7eb] bg-white/50"}`}>
            <input type="radio" name="forceTeam" value="Dubai" checked={forceTeam === "Dubai"} onChange={() => setForceTeam("Dubai")} />
            <span className="text-sm font-semibold">🇦🇪 Dubai team</span>
            <span className="text-[10px] text-gray-500">· AED</span>
          </label>
          <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer min-h-11 ${forceTeam === "India" ? "border-emerald-500 bg-white" : "border-[#e5e7eb] bg-white/50"}`}>
            <input type="radio" name="forceTeam" value="India" checked={forceTeam === "India"} onChange={() => setForceTeam("India")} />
            <span className="text-sm font-semibold">🇮🇳 India team</span>
            <span className="text-[10px] text-gray-500">· ₹</span>
          </label>
        </div>
        <p className="text-[11px] text-gray-600 mt-1.5">
          Every row in this file goes to the picked team. Currency follows automatically.
        </p>
      </div>

      {/* Optional: pre-assign every lead to one agent (Mehak's sheet, Nitisha's
          sheet, etc.). Doubles as the attribution fallback — any remark entry
          without a name prefix shows as that agent in Call History, not "Admin". */}
      {agents.length > 0 && (
        <div className={`mb-3 p-3 rounded-lg border ${assignToUserId ? "border-emerald-300 bg-emerald-50" : "border-[#e5e7eb] bg-[#f7f8fa]"}`}>
          <div className="text-xs font-bold uppercase tracking-widest text-gray-700 mb-1.5">
            Whose sheet is this? <span className="text-gray-400 font-normal">(optional — sets owner + Call History name)</span>
          </div>
          <select
            value={assignToUserId}
            onChange={(e) => setAssignToUserId(e.target.value)}
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm bg-white min-h-11"
          >
            <option value="">— Cold data (no owner, no attribution) —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.team ? ` · ${a.team}` : ""}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-600 mt-1.5">
            Pick the agent whose MIS sheet this is. Every new lead becomes theirs (status → CONTACTED) and any imported call entry without a name prefix is credited to them in Call History.
          </p>
        </div>
      )}

      <input
        type="text"
        placeholder="Campaign (optional, e.g. Dubai Expo 2026)"
        value={campaign}
        onChange={(e) => setCampaign(e.target.value)}
        className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm mb-2"
      />
      <label className="block border-2 border-dashed border-[#e5e7eb] rounded-lg p-6 text-center text-sm text-gray-500 cursor-pointer hover:border-[#c9a24b]">
        <input
          type="file"
          accept=".csv,.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setErr(null); }}
          className="hidden"
        />
        {file ? <span>📄 {file.name} · {(file.size / 1024).toFixed(1)} KB</span>
              : <span>Drop CSV or Excel here, or <b className="text-[#0b1a33]">click to browse</b></span>}
      </label>
      <div className="mt-2 text-[11px] text-gray-500">
        Accepts: <b>.csv .xlsx .xlsm .xls</b> · Auto-detects header row · Recognises: Customer, Mobile, Email, Project, Budget, Stage, Status, Remarks, Followup, To Do, Mood, Potential, Fund Readiness, Who Is Client, etc.
      </div>
      {file && (
        <button onClick={upload} disabled={busy} className="btn btn-primary w-full justify-center mt-3">
          {busy ? "Importing… (may take 30s for large files)" : `Import ${file.name}`}
        </button>
      )}
      {result && (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3 space-y-1">
          <div className="font-bold">✅ Import done</div>
          <div>
            File: <b>{result.fileType}</b>
            {result.sheetName && <> · Sheet: <code>{result.sheetName}</code></>}
            {result.allSheets && result.allSheets.length > 1 && <> · Other sheets in file: <code>{result.allSheets.filter(s => s !== result.sheetName).join(", ")}</code></>}
          </div>
          <div>
            Processed <b>{result.rowsProcessed}</b> rows · <b>{result.created}</b> new leads · <b>{result.deduped}</b> merged (duplicates) · <b>{result.enriched}</b> enriched
            {(result.callLogsCreated ?? 0) > 0 && <> · <b>{result.callLogsCreated}</b> call-history entries parsed from remarks</>}
          </div>
          {result.detectedColumns && result.detectedColumns.length > 0 && (
            <details>
              <summary className="text-[11px] text-emerald-700 cursor-pointer">Show {result.detectedColumns.length} mapped columns ↓</summary>
              <div className="text-[11px] mt-1 font-mono">{result.detectedColumns.join(" · ")}</div>
            </details>
          )}
          {result.errors && result.errors.length > 0 && (
            <details>
              <summary className="text-[11px] text-amber-700 cursor-pointer">{result.errors.length} row errors ↓</summary>
              <ul className="text-[11px] mt-1 list-disc list-inside">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      {err && (
        <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">
          <div className="font-bold">❌ Import failed</div>
          <div>{err.msg}</div>
          {err.hint && <div className="text-xs mt-1 text-red-700">💡 {err.hint}</div>}
        </div>
      )}
    </div>
  );
}
