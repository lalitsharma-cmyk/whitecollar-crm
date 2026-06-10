"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Shown at the top of the lead detail page when the lead is soft-deleted (in the
 * Super-Admin recycle bin). Without it, opening a deleted lead by direct URL looks
 * identical to an active lead — which makes a deletion look like it "didn't work".
 */
export default function DeletedLeadBanner({
  leadId, deletedAtISO, canRestore,
}: {
  leadId: string;
  deletedAtISO: string | null;
  canRestore: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const when = deletedAtISO
    ? new Date(deletedAtISO).toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
      })
    : null;

  async function restore() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/restore`, { method: "POST" });
      if (r.ok) { router.refresh(); return; }
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? `Restore failed (${r.status})`);
    } catch {
      setErr("Network error");
    } finally { setBusy(false); }
  }

  return (
    <div className="card p-4 border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-bold text-red-800 dark:text-red-300">🗑 This lead is in the recycle bin (deleted)</div>
          <div className="text-xs text-red-700/80 dark:text-red-300/70 mt-0.5">
            {when ? `Deleted on ${when} IST · ` : ""}Hidden from the active Leads list, dashboard &amp; reports. It still belongs to its agent until restored or permanently removed.
          </div>
          {err && <div className="text-xs text-red-700 mt-1 font-medium">⚠ {err}</div>}
        </div>
        <div className="flex gap-2 flex-none">
          <Link href="/leads/deleted" className="btn btn-ghost text-xs">Recycle bin</Link>
          {canRestore && (
            <button onClick={restore} disabled={busy} className="btn btn-primary text-xs">
              {busy ? "Restoring…" : "↩ Restore lead"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
