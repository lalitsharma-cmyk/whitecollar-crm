"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ── Buyer activity timeline + log controls + agent-handling history ──────────
// Renders the BuyerActivity stream (calls / notes / WA / voice / attempts +
// lifecycle ASSIGNED/RETURNED/CONVERTED/REJECTED) chronologically in the
// ConversationStreamCard look. Provides controls to log a CALL / NOTE / WHATSAPP /
// VOICE_NOTE and an ATTEMPT (No Answer / Not Picked / WA No Response) → POST
// /api/buyer-data/[id]/activity. Shows attemptCount + a warning as it approaches 5
// (auto-return). For admins, also renders the agent-handling history (stints).
// Read via GET /api/buyer-data/[id]/history. canLog = the assigned agent or admin.

type Activity = { id: string; type: string; description: string | null; by: string | null; createdAt: string };
type Assignment = { id: string; agent: string | null; assignedAt: string; returnedAt: string | null; returnReason: string | null; attemptsInStint: number; open: boolean };
type HistoryResp = {
  record: { poolStatus: string; attemptCount: number; ownerName?: string | null; owner?: { name: string | null } | null };
  assignments: Assignment[];
  activities: Activity[];
};

const IST = { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } as const;
const fmt = (s: string) => new Date(s).toLocaleString("en-IN", IST);

const TYPE_META: Record<string, { icon: string; label: string; cls: string }> = {
  CALL: { icon: "📞", label: "Call", cls: "border-emerald-400 bg-emerald-50/40 dark:bg-emerald-900/10" },
  NOTE: { icon: "📝", label: "Note", cls: "border-blue-400 bg-blue-50/40 dark:bg-blue-900/10" },
  WHATSAPP: { icon: "💬", label: "WhatsApp", cls: "border-green-400 bg-green-50/40 dark:bg-green-900/10" },
  VOICE_NOTE: { icon: "🎤", label: "Voice note", cls: "border-purple-400 bg-purple-50/40 dark:bg-purple-900/10" },
  ATTEMPT_NO_ANSWER: { icon: "📵", label: "No answer", cls: "border-amber-400 bg-amber-50/40 dark:bg-amber-900/10" },
  ATTEMPT_NOT_PICKED: { icon: "📴", label: "Not picked", cls: "border-amber-400 bg-amber-50/40 dark:bg-amber-900/10" },
  ATTEMPT_WA_NO_RESPONSE: { icon: "🚫", label: "WA no response", cls: "border-amber-400 bg-amber-50/40 dark:bg-amber-900/10" },
  ASSIGNED: { icon: "🏷️", label: "Assigned", cls: "border-slate-300 bg-slate-50 dark:bg-slate-800/40" },
  RETURNED: { icon: "↩️", label: "Returned to pool", cls: "border-slate-300 bg-slate-50 dark:bg-slate-800/40" },
  CONVERTED: { icon: "✅", label: "Converted", cls: "border-purple-400 bg-purple-50/40 dark:bg-purple-900/10" },
  REJECTED: { icon: "❌", label: "Rejected", cls: "border-red-300 bg-red-50/40 dark:bg-red-900/10" },
};

const LOG_BTNS: { type: string; icon: string; label: string }[] = [
  { type: "CALL", icon: "📞", label: "Call" },
  { type: "NOTE", icon: "📝", label: "Note" },
  { type: "WHATSAPP", icon: "💬", label: "WhatsApp" },
  { type: "VOICE_NOTE", icon: "🎤", label: "Voice" },
];
const ATTEMPT_BTNS: { type: string; label: string }[] = [
  { type: "ATTEMPT_NO_ANSWER", label: "No Answer" },
  { type: "ATTEMPT_NOT_PICKED", label: "Not Picked" },
  { type: "ATTEMPT_WA_NO_RESPONSE", label: "WA No Response" },
];

export default function BuyerActivityTimeline({ buyerId, canLog, isAdmin }: { buyerId: string; canLog: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<HistoryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState<{ type: string; label: string } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/buyer-data/${buyerId}/history`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [buyerId]);
  useEffect(() => { load(); }, [load]);

  const attemptCount = data?.record.attemptCount ?? 0;
  const poolStatus = data?.record.poolStatus ?? "";
  const isAssigned = poolStatus === "ASSIGNED";

  async function submit(type: string, description?: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/buyer-data/${buyerId}/activity`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, description: description ?? null }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg(`⚠ ${j.error ?? "Could not log."}`); setBusy(false); return; }
      setComposer(null); setText("");
      if (j.autoReturned) { setMsg(`🔁 5 attempts reached — buyer auto-returned to the Admin Pool.`); router.refresh(); }
      else { await load(); }
    } catch { setMsg("⚠ Network error."); }
    finally { setBusy(false); }
  }

  return (
    <div className="card p-4 border-l-4 border-emerald-500" data-lead-section="conversation">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="font-semibold dark:text-slate-100">💬 Conversation &amp; Activity</div>
        {isAssigned && (
          <span className={`text-xs font-medium ${attemptCount >= 4 ? "text-red-600" : attemptCount >= 3 ? "text-amber-600" : "text-gray-500 dark:text-slate-400"}`}>
            {attemptCount}/5 attempts{attemptCount >= 3 && attemptCount < 5 ? ` · ${5 - attemptCount} left before auto-return` : ""}
          </span>
        )}
      </div>

      {/* Log controls (assigned agent / admin only, on an ASSIGNED buyer) */}
      {canLog && isAssigned && (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {LOG_BTNS.map((b) => (
              <button key={b.type} type="button" disabled={busy}
                onClick={() => { setComposer({ type: b.type, label: b.label }); setText(""); }}
                className="px-2.5 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40">
                {b.icon} {b.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-500 dark:text-slate-400">Log attempt:</span>
            {ATTEMPT_BTNS.map((b) => (
              <button key={b.type} type="button" disabled={busy}
                onClick={() => submit(b.type)}
                className="px-2.5 py-1 rounded-full text-xs border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/20 disabled:opacity-40">
                {b.label}
              </button>
            ))}
          </div>
          {composer && (
            <div className="flex items-start gap-2">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
                placeholder={`${composer.label} note (optional)…`}
                className="flex-1 border border-[#c9a24b] rounded-lg px-2.5 py-2 text-base sm:text-sm dark:bg-slate-800 dark:text-slate-100" autoFocus />
              <div className="flex flex-col gap-1">
                <button type="button" disabled={busy} onClick={() => submit(composer.type, text)} className="btn btn-primary text-sm disabled:opacity-40">Log {composer.label}</button>
                <button type="button" onClick={() => setComposer(null)} className="btn btn-ghost text-xs">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && <div className="text-xs px-2.5 py-1.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 mb-2">{msg}</div>}

      {/* Timeline */}
      {loading ? (
        <div className="text-sm text-gray-400">Loading activity…</div>
      ) : !data || data.activities.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-slate-400">No activity logged yet.{canLog && isAssigned ? " Use the buttons above to log a call, note, or attempt." : ""}</div>
      ) : (
        <div className="space-y-1.5">
          {data.activities.map((a) => {
            const meta = TYPE_META[a.type] ?? { icon: "•", label: a.type, cls: "border-gray-300 bg-gray-50 dark:bg-slate-800/40" };
            return (
              <div key={a.id} className={`border-l-2 ${meta.cls} pl-3 pr-2 py-1.5 rounded-r`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-700 dark:text-slate-200">{meta.icon} {meta.label}</span>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{fmt(a.createdAt)}{a.by ? ` · ${a.by}` : ""}</span>
                </div>
                {a.description && <div className="text-sm text-gray-700 dark:text-slate-300 mt-0.5 break-words">{a.description}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Agent-handling history (admin) */}
      {isAdmin && data && data.assignments.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-800">
          <div className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">🧑‍💼 Agent-handling history</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500 dark:text-slate-400 border-b border-gray-100 dark:border-slate-800">
                <th className="py-1 pr-2">Agent</th><th className="py-1 pr-2">Assigned</th><th className="py-1 pr-2">Returned</th><th className="py-1 pr-2">Reason</th><th className="py-1 text-center">Attempts</th>
              </tr></thead>
              <tbody>
                {data.assignments.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 dark:border-slate-800/50">
                    <td className="py-1 pr-2 text-gray-700 dark:text-slate-200">{s.agent ?? "—"}{s.open && <span className="ml-1 text-[9px] rounded-full bg-emerald-100 text-emerald-700 px-1.5 dark:bg-emerald-900/40 dark:text-emerald-300">active</span>}</td>
                    <td className="py-1 pr-2 text-gray-500 dark:text-slate-400 whitespace-nowrap">{fmt(s.assignedAt)}</td>
                    <td className="py-1 pr-2 text-gray-500 dark:text-slate-400 whitespace-nowrap">{s.returnedAt ? fmt(s.returnedAt) : "—"}</td>
                    <td className="py-1 pr-2 text-gray-500 dark:text-slate-400">{s.returnReason ?? "—"}</td>
                    <td className="py-1 text-center tabular-nums">{s.attemptsInStint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
