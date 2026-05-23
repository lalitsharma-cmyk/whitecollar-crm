"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CsvUploader() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [campaign, setCampaign] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; deduped: number; errors: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true); setErr(null); setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    if (campaign) fd.append("campaign", campaign);
    const res = await fetch("/api/intake/csv", { method: "POST", body: fd });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(json.error ?? "Upload failed"); return; }
    setResult({ created: json.created, deduped: json.deduped, errors: json.errors ?? [] });
    router.refresh();
  }

  return (
    <div>
      <input
        type="text"
        placeholder="Campaign (e.g. Dubai Expo 2026)"
        value={campaign}
        onChange={(e) => setCampaign(e.target.value)}
        className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm mb-2"
      />
      <label className="block border-2 border-dashed border-[#e5e7eb] rounded-lg p-6 text-center text-sm text-gray-500 cursor-pointer hover:border-[#c9a24b]">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        {file ? <span>📄 {file.name} · {(file.size / 1024).toFixed(1)} KB</span>
              : <span>Drop CSV here or <b className="text-[#0b1a33]">click to browse</b></span>}
      </label>
      <div className="mt-2 text-[11px] text-gray-500">Auto-detected columns: name, phone, email, city, configuration, budget, notes, tags.</div>
      {file && (
        <button onClick={upload} disabled={busy} className="btn btn-primary w-full justify-center mt-3">
          {busy ? "Uploading…" : "Import CSV"}
        </button>
      )}
      {result && (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3">
          ✅ {result.created} new leads · {result.deduped} merged (duplicates)
          {result.errors.length > 0 && <div className="text-xs mt-1">{result.errors.length} row errors</div>}
        </div>
      )}
      {err && <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">❌ {err}</div>}
    </div>
  );
}
