"use client";
// Admin control (Team page) — mark a sales agent on/off leave for TODAY. While on
// leave, no NEW lead auto-assigns to them (leave-cover engine #16 redirects to a
// teammate → Lalit → park). Existing leads are untouched. Auto-expires overnight.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Palmtree, Check } from "lucide-react";

type Agent = { id: string; name: string; team: string | null; onLeave: boolean; until?: string | null };

export default function AgentLeavePanel({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(id: string, next: boolean) {
    setBusy(id);
    setErr(null);
    try {
      const r = await fetch("/api/admin/agent-leave", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: id, onLeave: next }),
      });
      if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error ?? "Update failed"); return; }
      router.refresh();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(null);
    }
  }

  const onLeaveCount = agents.filter((a) => a.onLeave).length;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Palmtree className="w-[18px] h-[18px] text-amber-600" />
        <h2 className="font-semibold">Agent Leave (today)</h2>
        {onLeaveCount > 0 && (
          <span className="text-[10px] bg-amber-500 text-[#0b1a33] px-2 py-0.5 rounded-full font-bold">{onLeaveCount} on leave</span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-3">
        On leave = no NEW leads auto-assign to them today (they go to a teammate / you instead). Existing leads are untouched. Clears automatically overnight.
      </p>
      {err && <div className="text-xs text-red-600 mb-2">{err}</div>}
      <div className="flex flex-wrap gap-2">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy === a.id}
            onClick={() => toggle(a.id, !a.onLeave)}
            title={a.onLeave ? "On leave today — click to mark working" : "Working — click to mark on leave today"}
            className={[
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors disabled:opacity-50",
              a.onLeave
                ? "bg-amber-100 border-amber-400 text-amber-800 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200"
                : "bg-white border-gray-300 text-gray-700 hover:border-gray-400 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200",
            ].join(" ")}
          >
            {a.onLeave ? <Palmtree className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5 text-emerald-500" />}
            {a.name}
            {a.team && <span className="opacity-50 font-normal">{a.team}</span>}
            <span className="opacity-70">{a.onLeave ? "· on leave" : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
