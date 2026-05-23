"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GoogleSheetImporter() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [campaign, setCampaign] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; deduped: number; enriched: number; rowsProcessed: number; detectedColumns: string[] } | null>(null);
  const [err, setErr] = useState<{ msg: string; hint?: string } | null>(null);

  async function importSheet() {
    if (!url.trim()) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const res = await fetch("/api/intake/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), campaign: campaign.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr({ msg: json.error ?? "Import failed", hint: json.hint });
      } else {
        setResult(json);
        router.refresh();
      }
    } finally { setBusy(false); }
  }

  return (
    <div>
      <input
        type="url"
        placeholder="https://docs.google.com/spreadsheets/d/..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm mb-2 font-mono"
      />
      <input
        type="text"
        placeholder="Campaign name (optional, e.g. Dubai Sheet 2026)"
        value={campaign}
        onChange={(e) => setCampaign(e.target.value)}
        className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm mb-2"
      />
      <button onClick={importSheet} disabled={busy || !url.trim()} className="btn btn-primary w-full justify-center">
        {busy ? "Fetching from Google…" : "Import from Google Sheets"}
      </button>
      <div className="text-[11px] text-gray-500 mt-2">
        ⚠ Sheet must be shared as <b>"Anyone with the link → Viewer"</b>. Paste any sheet URL (edit / view / share link — even with #gid for a specific tab).
      </div>
      {result && (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3">
          ✅ Processed {result.rowsProcessed} rows · {result.created} new · {result.deduped} merged · {result.enriched} enriched
          <div className="text-[11px] mt-1">Columns mapped: {result.detectedColumns.slice(0, 8).join(", ")}{result.detectedColumns.length > 8 ? "…" : ""}</div>
        </div>
      )}
      {err && (
        <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">
          ❌ {err.msg}
          {err.hint && <div className="text-xs mt-1 text-red-700">💡 {err.hint}</div>}
        </div>
      )}
    </div>
  );
}
