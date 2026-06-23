"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── Buyer detail action bar ──────────────────────────────────────────────────
// Lifecycle actions on one buyer, gated by what the viewer may do:
//   • Convert to Lead   (assigned agent or admin) → POST /[id]/convert; on success
//     shows the resulting lead link + a "Converted From Buyer Data" tag.
//   • Reject / Return to Pool (assigned agent or admin) → POST /[id]/reject.
//   • Assign / Transfer (admin or manager) → POST /api/buyer-data/assign (from pool)
//     or the bulk transfer (reassign). Picks an agent from the passed roster.
// Mirrors the safe pattern: confirm before a state change, surface the outcome.

type Agent = { id: string; name: string; team: string | null };

interface Props {
  buyerId: string;
  poolStatus: string;          // ADMIN_POOL | ASSIGNED | CONVERTED | REJECTED
  ownerName: string | null;
  convertedLeadId: string | null;
  canConvertReject: boolean;   // assigned agent or admin
  canAssign: boolean;          // admin or manager
  agents: Agent[];
}

export default function BuyerDetailActions({ buyerId, poolStatus, ownerName, convertedLeadId, canConvertReject, canAssign, agents }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; leadId?: string } | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const isConverted = poolStatus === "CONVERTED";
  const isAssigned = poolStatus === "ASSIGNED";
  const isPool = poolStatus === "ADMIN_POOL";

  async function convert() {
    if (!window.confirm("Convert this buyer into a real Lead? A tagged lead will be created and assigned.")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/buyer-data/${buyerId}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: j.error ?? "Convert failed." }); setBusy(false); return; }
      setMsg({ ok: true, text: "Converted to a lead.", leadId: j.leadId });
      router.refresh();
    } catch { setMsg({ ok: false, text: "Network error." }); }
    finally { setBusy(false); }
  }

  async function reject() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/buyer-data/${buyerId}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: rejectReason || null }) });
      const j = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: j.error ?? "Reject failed." }); setBusy(false); return; }
      setMsg({ ok: true, text: "Returned to the Admin Pool." });
      setRejectOpen(false); setRejectReason("");
      router.refresh();
    } catch { setMsg({ ok: false, text: "Network error." }); }
    finally { setBusy(false); }
  }

  async function assign() {
    if (!assignTo) return;
    setBusy(true); setMsg(null);
    try {
      // Pool buyer → /assign; already-assigned buyer being moved → also /assign
      // (assignBuyerInTx closes the prior stint). One endpoint covers both.
      const r = await fetch(`/api/buyer-data/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buyerId, agentId: assignTo }) });
      const j = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: j.error ?? "Assign failed." }); setBusy(false); return; }
      setMsg({ ok: true, text: isAssigned ? "Transferred to the new agent." : "Assigned to the agent." });
      setAssignTo("");
      router.refresh();
    } catch { setMsg({ ok: false, text: "Network error." }); }
    finally { setBusy(false); }
  }

  const sel = "border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-2 text-base sm:text-sm dark:bg-slate-800 dark:text-slate-100";

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600 dark:text-slate-300">
          Status: <b className="text-gray-800 dark:text-slate-100">{poolStatus.replace("_", " ")}</b>
          {ownerName ? <> · Owner: <b>{ownerName}</b></> : isPool ? <> · <span className="text-blue-600 dark:text-blue-400">in Admin Pool</span></> : null}
        </span>

        {/* Convert */}
        {canConvertReject && !isConverted && (
          <button type="button" disabled={busy} onClick={convert} className="btn btn-primary text-sm disabled:opacity-40">⤴ Convert to Lead</button>
        )}
        {/* Reject / return */}
        {canConvertReject && isAssigned && (
          <button type="button" disabled={busy} onClick={() => setRejectOpen((o) => !o)} className="btn text-sm text-red-600 border border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 disabled:opacity-40">↩ Reject / Return</button>
        )}
        {/* Assign / Transfer (admin / manager) */}
        {canAssign && !isConverted && (
          <span className="inline-flex items-center gap-1.5">
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={sel}>
              <option value="">{isAssigned ? "Transfer to…" : "Assign to…"}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.team ? ` · ${a.team}` : ""}</option>)}
            </select>
            <button type="button" disabled={!assignTo || busy} onClick={assign} className="btn btn-ghost text-sm disabled:opacity-40">{isAssigned ? "Transfer" : "Assign"}</button>
          </span>
        )}
      </div>

      {/* Reject reason composer */}
      {rejectOpen && (
        <div className="flex items-start gap-2">
          <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason (optional)…" className={`${sel} flex-1`} />
          <button type="button" disabled={busy} onClick={reject} className="btn text-sm text-red-600 border border-red-300 hover:bg-red-50 disabled:opacity-40">Confirm return to pool</button>
        </div>
      )}

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
    </div>
  );
}
