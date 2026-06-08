"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Candidate { id: string; name: string; currentProfile: string | null; }
interface Props { candidates: Candidate[]; preselectedCandidateId?: string; }

export default function HRResumeUploadWidget({ candidates, preselectedCandidateId }: Props) {
  const router = useRouter();
  const [, startT] = useTransition();
  const [candidateId, setCandidateId] = useState(preselectedCandidateId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function upload() {
    if (!candidateId || !file) return;
    setBusy(true); setErr(null); setDone(false);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/hr/candidates/${candidateId}/resume`, { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(json.error ?? "Upload failed"); return; }
    setDone(true);
    setFile(null);
    startT(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      {/* Candidate picker (hidden when preselected) */}
      {!preselectedCandidateId && (
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Attach to candidate</label>
          <select
            value={candidateId} onChange={e => setCandidateId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-600"
          >
            <option value="">— Select candidate —</option>
            {candidates.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.currentProfile ? ` · ${c.currentProfile}` : ""}</option>
            ))}
          </select>
        </div>
      )}

      {/* File picker */}
      <label className={`block border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition
        ${file ? "border-green-400 bg-green-50/30" : "border-gray-200 hover:border-[#1a2e4a]"}`}>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*"
          onChange={e => { setFile(e.target.files?.[0] ?? null); setErr(null); setDone(false); }}
          className="hidden"
        />
        {file ? (
          <div className="text-sm font-medium text-green-700">
            {file.type.startsWith("image/") ? "🖼️" : "📄"} {file.name}
            <div className="text-[11px] text-green-600 mt-0.5">{(file.size / 1024).toFixed(0)} KB</div>
          </div>
        ) : (
          <div className="text-sm text-gray-500">
            <div className="text-2xl mb-1">📎</div>
            Drop resume here or <b className="text-[#1a2e4a] dark:text-blue-400">click to browse</b>
            <div className="text-[11px] text-gray-400 mt-0.5">PDF, JPG, PNG up to 5 MB</div>
          </div>
        )}
      </label>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      {done && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          ✅ Resume uploaded and marked as active.
        </div>
      )}

      <button
        type="button"
        disabled={!candidateId || !file || busy}
        onClick={upload}
        className="w-full py-2 rounded-xl bg-[#1a2e4a] text-white text-sm font-semibold hover:bg-[#243d60] disabled:opacity-40 transition"
      >
        {busy ? "Uploading…" : "Upload Resume"}
      </button>
    </div>
  );
}
