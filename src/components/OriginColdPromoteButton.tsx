"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp } from "lucide-react";

interface Props { leadId: string; leadName: string; compact?: boolean; }

/**
 * Promotes a leadOrigin="COLD" record to an active lead by calling
 * PATCH /api/leads/[id]/promote, which flips leadOrigin → "ACTIVE"
 * and bumps status from NEW → CONTACTED.
 */
export default function OriginColdPromoteButton({ leadId, leadName, compact }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function promote() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/promote`, { method: "PATCH" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? `Failed (${r.status})`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 60)}`);
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <div>
        <button
          onClick={promote}
          disabled={busy}
          title={`Promote ${leadName} to active lead`}
          className="h-8 px-2 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
        >
          <TrendingUp className="w-3 h-3 flex-none" />
          {busy ? "…" : "Promote"}
        </button>
        {err && <div className="text-[10px] text-red-600 mt-1">{err}</div>}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={promote}
        disabled={busy}
        title={`Move ${leadName} from cold-data import to active leads`}
        className="w-full flex items-center justify-center gap-1 text-xs py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
      >
        <TrendingUp className="w-3 h-3" /> {busy ? "Promoting…" : "Promote to Lead →"}
      </button>
      {err && <div className="text-[10px] text-red-600 mt-1">{err}</div>}
    </div>
  );
}
