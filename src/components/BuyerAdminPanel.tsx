"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── Buyer admin panel (right rail) ───────────────────────────────────────────
// The buyer equivalent of the Lead view's "🛠 Lead admin" card: a vertical,
// right-sidebar panel (data-lead-section="admin") that holds the buyer lifecycle
// actions + status context, instead of the old horizontal action bar. Contents:
//   • Status line (poolStatus + owner / "in Admin Pool").
//   • Convert to Lead        (assigned agent / admin) → POST /[id]/convert
//   • Reject / Return to Pool (assigned agent / admin) → POST /[id]/reject
//   • Assign / Transfer       (admin / manager) → POST /api/buyer-data/assign
//   • Attempt Count (X/5 with auto-return warning) — read from /[id]/history.
//   • Transfer History — the BuyerAssignment stint history (admin/manager).
// All endpoints are the EXISTING lifecycle routes (no new server logic).

type Agent = { id: string; name: string; team: string | null };
type Assignment = { id: string; agent: string | null; assignedAt: string; returnedAt: string | null; returnReason: string | null; attemptsInStint: number; open: boolean };

interface Props {
  buyerId: string;
  poolStatus: string;          // ADMIN_POOL | ASSIGNED | CONVERTED | REJECTED
  ownerName: string | null;
  convertedLeadId: string | null;
  canConvertReject: boolean;   // assigned agent or admin
  canAssign: boolean;          // admin or manager
  showHistory: boolean;        // admin/manager — render the stint Transfer History
  agents: Agent[];
}

const IST = { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } as const;
const fmt = (s: string) => new Date(s).toLocaleString("en-IN", IST);

export default function BuyerAdminPanel({ buyerId, poolStatus, ownerName, convertedLeadId, canConvertReject, canAssign, showHistory, agents }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; leadId?: string } | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Live lifecycle state (attemptCount + stints) — read from the history endpoint.
  const [attemptCount, setAttemptCount] = useState<number>(0);
  const [stints, setStints] = useState<Assignment[]>([]);

  const isConverted = poolStatus === "CONVERTED";
  const isAssigned = poolStatus === "ASSIGNED";
  const isPool = poolStatus === "ADMIN_POOL";

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`/api/buyer-data/${buyerId}/history`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        setAttemptCount(j.record?.attemptCount ?? 0);
        setStints(j.assignments ?? []);
      }
    } catch { /* ignore */ }
  }, [buyerId]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function convert() {
    if (!window.confirm("Convert this buyer into a real Lead? A tagged lead will be created and assigned.")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/buyer-data/${buyerId}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: j.error ?? "Convert failed." }); setBusy(false); return; }
      // Buyer is now CONVERTED — an AGENT can no longer view the buyer detail
      // (canTouchBuyer requires ASSIGNED), so a self-refresh would 404. Go straight
      // to the newly-created lead (the natural next step); replace() so the browser
      // Back button doesn't land on the now-inaccessible buyer detail. Fall back to
      // the Buyer Data list if no leadId came back.
      if (j.leadId) router.replace(`/leads/${j.leadId}`);
      else router.replace("/buyer-data");
    } catch { setMsg({ ok: false, text: "Network error." }); }
    finally { setBusy(false); }
  }

  async function reject() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/buyer-data/${buyerId}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: rejectReason || null }) });
      const j = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: j.error ?? "Reject failed." }); setBusy(false); return; }
      setRejectOpen(false); setRejectReason("");
      // The buyer is now back in the Admin Pool (ownerId cleared). An AGENT can no
      // longer view a pooled buyer — canTouchBuyer would 404 the re-rendered detail
      // page (the "reject → 404" bug). replace() (not refresh) sends the user back to
      // the Buyer Data list AND drops the now-inaccessible detail URL from history,
      // so the browser Back button doesn't 404 either.
      router.replace("/buyer-data");
    } catch { setMsg({ ok: false, text: "Network error." }); }
    finally { setBusy(false); }
  }

  async function assign() {
    if (!assignTo) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/buyer-data/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buyerId, agentId: assignTo }) });
      const j = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: j.error ?? "Assign failed." }); setBusy(false); return; }
      setMsg({ ok: true, text: isAssigned ? "Transferred to the new agent." : "Assigned to the agent." });
      setAssignTo("");
      router.refresh();
    } catch { setMsg({ ok: false, text: "Network error." }); }
    finally { setBusy(false); }
  }

  const sel = "w-full border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-2 text-base sm:text-sm dark:bg-slate-800 dark:text-slate-100";

  const poolLabel = poolStatus.replace(/_/g, " ");
  const statusChip =
    isConverted ? "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700"
    : isAssigned ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"
    : poolStatus === "REJECTED" ? "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700"
    : "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700";

  return (
    <div data-lead-section="admin" className="card p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold">🛠 Buyer admin</div>

      {/* Status line */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${statusChip}`}>{poolLabel}</span>
        {ownerName ? <span className="text-gray-600 dark:text-slate-300">Owner: <b className="text-gray-800 dark:text-slate-100">{ownerName}</b></span>
          : isPool ? <span className="text-blue-600 dark:text-blue-400">in Admin Pool</span> : null}
      </div>

      {/* Attempt count + auto-return warning (assigned only). */}
      {isAssigned && (
        <div className={`text-xs rounded-lg px-2.5 py-2 border ${attemptCount >= 4 ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700" : attemptCount >= 3 ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700" : "border-gray-200 bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"}`}>
          <b>{attemptCount}/5</b> contact attempts{attemptCount >= 3 && attemptCount < 5 ? ` · ${5 - attemptCount} left before auto-return to pool` : ""}{attemptCount >= 5 ? " · auto-returned" : ""}
        </div>
      )}

      {/* Lifecycle actions — stacked (vertical) for the right rail. */}
      <div className="space-y-2">
        {canConvertReject && !isConverted && (
          <button type="button" disabled={busy} onClick={convert} className="btn btn-primary w-full justify-center text-sm disabled:opacity-40">⤴ Convert to Lead</button>
        )}
        {canConvertReject && isAssigned && (
          <button type="button" disabled={busy} onClick={() => setRejectOpen((o) => !o)} className="btn w-full justify-center text-sm text-red-600 border border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 disabled:opacity-40">↩ Reject / Return to Pool</button>
        )}
        {rejectOpen && (
          <div className="space-y-2">
            <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason (optional)…" className={sel} />
            <button type="button" disabled={busy} onClick={reject} className="btn w-full justify-center text-sm text-red-600 border border-red-300 hover:bg-red-50 disabled:opacity-40">Confirm return to pool</button>
          </div>
        )}
        {canAssign && !isConverted && (
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold">{isAssigned ? "Transfer to agent" : "Assign to agent"}</label>
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={sel}>
              <option value="">{isAssigned ? "Transfer to…" : "Assign to…"}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.team ? ` · ${a.team}` : ""}</option>)}
            </select>
            <button type="button" disabled={!assignTo || busy} onClick={assign} className="btn btn-ghost w-full justify-center text-sm disabled:opacity-40">{isAssigned ? "Transfer" : "Assign"}</button>
          </div>
        )}
      </div>

      {/* Converted banner */}
      {isConverted && convertedLeadId && (
        <div className="text-sm rounded-lg bg-purple-50 border border-purple-200 text-purple-800 px-3 py-2 dark:bg-purple-900/20 dark:border-purple-700 dark:text-purple-200">
          ✅ <b>Converted From Buyer Data</b> — <Link href={`/leads/${convertedLeadId}`} className="underline font-medium">open the lead →</Link>
        </div>
      )}

      {/* Outcome message */}
      {msg && (
        <div className={`text-sm px-3 py-2 rounded ${msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200"}`}>
          {msg.ok ? "✓ " : "⚠ "}{msg.text}
          {msg.leadId && <> — <Link href={`/leads/${msg.leadId}`} className="underline font-medium">open the lead →</Link></>}
        </div>
      )}

      {/* Transfer / handling history (admin / manager) — the BuyerAssignment stints. */}
      {showHistory && stints.length > 0 && (
        <div className="pt-3 border-t border-gray-100 dark:border-slate-800">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold mb-2">🔁 Transfer history</div>
          <div className="space-y-2">
            {stints.map((s) => (
              <div key={s.id} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <b className="text-gray-700 dark:text-slate-200">{s.agent ?? "—"}</b>
                  {s.open && <span className="text-[9px] rounded-full bg-emerald-100 text-emerald-700 px-1.5 dark:bg-emerald-900/40 dark:text-emerald-300">active</span>}
                  <span className="text-gray-400">· {s.attemptsInStint} attempt{s.attemptsInStint === 1 ? "" : "s"}</span>
                </div>
                <div className="text-gray-500 dark:text-slate-400">
                  {fmt(s.assignedAt)}{s.returnedAt ? ` → ${fmt(s.returnedAt)}` : ""}
                  {s.returnReason ? ` · ${s.returnReason.replace(/_/g, " ").toLowerCase()}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
