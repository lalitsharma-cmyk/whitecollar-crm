"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CONVO_CARD } from "@/lib/detailLayout";

// ── Buyer Conversation History — VISUAL PARITY with the Lead view's
// ConversationStreamCard (src/components/ConversationStreamCard.tsx). Same card
// shell (`card p-5 border-l-4 border-emerald-500 bg-emerald-50/20`), same header
// (💬 Conversation History + a Raw History / Smart Timeline segmented toggle pill),
// same Raw-History block (verbatim mono on a slate rail) and the same scrollable
// Smart-Timeline stream container (`max-h-[620px] overflow-y-auto`). The data is
// buyer-specific (BuyerActivity, not CallLog/Note), so the per-row markup mirrors
// the Lead timeline rows rather than re-using the lead-typed component verbatim.
//
// It renders the BuyerActivity stream (calls / notes / WA / voice / attempts +
// lifecycle ASSIGNED/RETURNED/CONVERTED/REJECTED) chronologically. Provides
// controls to log a CALL / NOTE / WHATSAPP / VOICE_NOTE and an ATTEMPT (No Answer /
// Not Picked / WA No Response) → POST /api/buyer-data/[id]/activity. Shows
// attemptCount + a warning as it approaches 5 (auto-return). For admins, also
// renders the agent-handling history (stints). Read via GET
// /api/buyer-data/[id]/history. canLog = the assigned agent or admin.

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

export default function BuyerActivityTimeline({ buyerId, canLog, isAdmin, rawRemarks }: { buyerId: string; canLog: boolean; isAdmin: boolean; rawRemarks?: string | null }) {
  const router = useRouter();
  const [data, setData] = useState<HistoryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState<{ type: string; label: string } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // View toggle — Smart Timeline (processed activity stream) is the DEFAULT,
  // mirroring the Lead ConversationStreamCard (Lalit's "default Smart Timeline"
  // consistency rule). Raw History (verbatim imported remarks) is one tap away.
  const rawText = (rawRemarks ?? "").trim();
  const hasRaw = rawText.length > 0;
  const [viewMode, setViewMode] = useState<"raw" | "smart">("smart");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/buyer-data/${buyerId}/history`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [buyerId]);
  useEffect(() => { load(); }, [load]);
  // Auto-refresh the stream when the user returns to the tab — e.g. after editing a
  // remark/field in a sibling island (those router.refresh the SERVER tree, but this
  // client island keeps its own fetched copy). Re-fetching on focus/visibility keeps
  // the timeline current without a manual reload. (no-store fetch; cheap payload.)
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => { document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, [load]);

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

  const activities = data?.activities ?? [];

  return (
    // Card shell — byte-for-byte the same wrapper as the Lead ConversationStreamCard
    // (card p-5 · emerald left rail · faint emerald tint). data-lead-section="timeline"
    // keeps it on the same mobile tab as the Lead view's Conversation History.
    <div className={`${CONVO_CARD}`} data-lead-section="timeline">
      {/* Header — same row layout + title size as the Lead view, with the Raw /
          Smart segmented toggle pill (identical emerald-bordered styling). */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="font-semibold flex items-center gap-2 text-base flex-wrap">
          💬 Conversation History
          <span className="inline-flex rounded-md border border-emerald-300 overflow-hidden text-[10px] font-medium">
            <button type="button" onClick={() => setViewMode("raw")}
              title="Exact imported text — no grouping, no dedup, no rewriting. Source of truth."
              className={viewMode === "raw" ? "px-2 py-0.5 bg-[#0b1a33] text-white" : "px-2 py-0.5 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"}>
              📜 Raw History
            </button>
            <button type="button" onClick={() => setViewMode("smart")}
              title="Processed convenience view — the buyer's CRM activity stream. Never modifies the raw audit trail."
              className={viewMode === "smart" ? "px-2 py-0.5 bg-[#0b1a33] text-white" : "px-2 py-0.5 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"}>
              ✨ Smart Timeline
            </button>
          </span>
          <span className="text-[10px] text-gray-500 font-normal">
            {viewMode === "raw" ? "— Raw History (Audit Log) · verbatim" : "— Smart Timeline (Processed View)"}
          </span>
        </div>
        {/* Attempt counter — buyer-specific (auto-return at 5). Sits where the Lead
            view's filter chips sit, so the header row reads identically. */}
        {isAssigned && (
          <span className={`text-xs font-medium ${attemptCount >= 4 ? "text-red-600" : attemptCount >= 3 ? "text-amber-600" : "text-gray-500 dark:text-slate-400"}`}>
            {attemptCount}/5 attempts{attemptCount >= 3 && attemptCount < 5 ? ` · ${5 - attemptCount} left before auto-return` : ""}
          </span>
        )}
      </div>

      {/* Log controls (assigned agent / admin only, on an ASSIGNED buyer) —
          shown above the stream, exactly where the Lead view surfaces its
          inline log affordances. Hidden in Raw History mode so the verbatim
          audit text reads cleanly (parity: Raw is read-only). */}
      {canLog && isAssigned && viewMode === "smart" && (
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

      {/* ── Main stream — same scroll container as the Lead view (space-y-1.5,
          text-sm, capped height with internal scroll). ── */}
      <div className="space-y-1.5 text-sm max-h-[620px] overflow-y-auto pr-1">
        {/* RAW HISTORY (Audit Log) — verbatim imported remark on a slate rail,
            mono, whitespace-preserved. Identical block to the Lead view. */}
        {viewMode === "raw" && (
          hasRaw ? (
            <div className="border-l-2 border-slate-400 bg-slate-50/70 dark:bg-slate-800/40 pl-3 pr-2 py-2 rounded-r">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5 flex-wrap">
                📜 Imported Remarks — verbatim audit log
              </div>
              <div className="text-xs text-gray-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed font-mono">{rawText}</div>
            </div>
          ) : (
            <div className="text-gray-500 text-xs text-center py-4">No imported remarks on this buyer.</div>
          )
        )}

        {/* SMART TIMELINE — the buyer's processed CRM-activity stream (calls ·
            notes · WhatsApp · voice · attempts · lifecycle), newest-first. */}
        {viewMode === "smart" && (
          loading ? (
            <div className="text-gray-500 text-xs text-center py-4">Loading activity…</div>
          ) : activities.length === 0 ? (
            <div className="text-gray-500 text-xs text-center py-4">
              No calls, WhatsApp messages, or notes logged yet.{canLog && isAssigned ? " Use the buttons above to log a call, note, or attempt." : ""}
            </div>
          ) : (
            activities.map((a) => {
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
            })
          )
        )}
      </div>

      {/* Agent-handling history (admin) — buyer-specific stint table, kept below
          the stream (separated by a hairline rule, matching the Lead view's
          below-stream secondary blocks). */}
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
