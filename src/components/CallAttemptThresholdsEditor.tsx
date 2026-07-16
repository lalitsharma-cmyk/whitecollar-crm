"use client";
import { useState } from "react";

// ── Call-attempt thresholds (admin) ──────────────────────────────────────────
// Two numbers behind the Call Attempt Tracking system (src/lib/callAttempts.ts):
//   • ghostingThreshold  — Normal Leads: after N attempts with no response the
//     lead is tagged 👻 Ghosting (secondary tag — never replaces the status).
//   • revivalMaxAttempts — Revival/cold: after N attempts with no response the
//     record auto-returns to the Admin queue for redistribution.
// Mirrors the TravelRateEditor save flow (POST → per-setting route → audit).

interface Props {
  initialGhosting: number;
  initialRevivalMax: number;
  canEdit: boolean;
}

// Allowed ranges (enforced server-side too — keep in sync with the API route).
export const GHOSTING_MIN = 3;
export const GHOSTING_MAX = 30;
export const REVIVAL_MIN = 2;
export const REVIVAL_MAX = 15;

export default function CallAttemptThresholdsEditor({ initialGhosting, initialRevivalMax, canEdit }: Props) {
  const [ghosting, setGhosting] = useState(String(initialGhosting));
  const [revivalMax, setRevivalMax] = useState(String(initialRevivalMax));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <div className="text-sm font-mono mt-2">
        👻 {initialGhosting} attempts · ↩ {initialRevivalMax} attempts{" "}
        <span className="text-[10px] text-gray-500">(read-only — only Admin can change)</span>
      </div>
    );
  }

  async function save() {
    setSaving(true); setStatus("idle"); setError(null);
    try {
      const r = await fetch("/api/settings/call-attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ghostingThreshold: Number(ghosting),
          revivalMaxAttempts: Number(revivalMax),
        }),
      });
      if (r.ok) {
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2000);
      } else {
        const j = await r.json().catch(() => ({}));
        setError(typeof j.error === "string" ? j.error : null);
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="text-xs font-semibold text-gray-700 dark:text-slate-200 block">
          👻 Ghosting Threshold (Normal Leads)
        </label>
        <p className="text-[11px] text-gray-500 mt-0.5">
          After this many call attempts with no response, a Normal Lead is tagged 👻 Ghosting
          (a secondary tag — the lead keeps its status and stays with its agent).
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <input
            type="number"
            min={GHOSTING_MIN}
            max={GHOSTING_MAX}
            step="1"
            value={ghosting}
            onChange={(e) => setGhosting(e.target.value)}
            className="w-24 border border-[#e5e7eb] rounded px-2 py-1 text-sm font-mono"
          />
          <span className="text-sm text-gray-500">attempts (allowed {GHOSTING_MIN}–{GHOSTING_MAX})</span>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-700 dark:text-slate-200 block">
          ↩ Revival Max Attempts (auto-return)
        </label>
        <p className="text-[11px] text-gray-500 mt-0.5">
          After this many attempts with no response, a Revival record returns to the Admin queue
          for redistribution (its history, remarks, and calls are all preserved).
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <input
            type="number"
            min={REVIVAL_MIN}
            max={REVIVAL_MAX}
            step="1"
            value={revivalMax}
            onChange={(e) => setRevivalMax(e.target.value)}
            className="w-24 border border-[#e5e7eb] rounded px-2 py-1 text-sm font-mono"
          />
          <span className="text-sm text-gray-500">attempts (allowed {REVIVAL_MIN}–{REVIVAL_MAX})</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="btn btn-primary text-xs">
          {saving ? "Saving…" : "Save"}
        </button>
        {status === "saved" && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
        {status === "error" && (
          <span className="text-xs text-red-600 font-semibold">✕ {error ?? "Failed"}</span>
        )}
      </div>
    </div>
  );
}
