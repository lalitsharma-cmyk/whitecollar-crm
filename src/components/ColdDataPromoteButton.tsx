"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp } from "lucide-react";

interface Props { leadId: string; leadName: string; }

/**
 * One-click "Cold → Lead" conversion. Server flips isColdCall=false, sets
 * status=CONTACTED if currently NEW, and writes a COLD_TO_LEAD activity for
 * the daily-conversion report. Card disappears from /cold-calls after.
 */
export default function ColdDataPromoteButton({ leadId, leadName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function promote() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/promote-cold`, { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Failed (${r.status})`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 60)}`);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <button
        onClick={promote}
        disabled={busy}
        title={`Move ${leadName} from cold data to active leads (logged in daily report)`}
        className="w-full flex items-center justify-center gap-1 text-xs py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
      >
        <TrendingUp className="w-3 h-3" /> {busy ? "Promoting…" : "🔥 Promote to Lead"}
      </button>
      {err && <div className="text-[10px] text-red-600 mt-1">{err}</div>}
    </div>
  );
}
