"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { telLink } from "@/lib/phone";
import { showXpToast } from "@/components/XPToast";

// Lead shape — narrow on purpose. Anything not listed here is unavailable to
// the session UI by design; expand only when the card actually renders it.
export interface SessionLead {
  id: string;
  name: string;
  phone: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetCurrency: string;
  aiScore: "HOT" | "WARM" | "COLD" | null;
  whoIsClient: string | null;
  remarks: string | null;
  coldCallReason: string | null;
  lastTouchedAt: string | null;
}

// Outcome map — index = keyboard digit, also drives the 2-col grid order.
// "WRONG_NUMBER" is a real CallOutcome enum value, so we use it directly.
type OutcomeKey =
  | "CONNECTED"
  | "NOT_ANSWERED"   // mapped → NOT_PICKED enum on submit
  | "CALLBACK"
  | "WRONG_NUMBER"
  | "INTERESTED"
  | "NOT_INTERESTED";

interface OutcomeDef {
  key: OutcomeKey;
  emoji: string;
  label: string;
  bg: string;       // tailwind bg class for the big button
  needsCallback?: boolean;
  promote?: boolean;
  reject?: boolean;
  notesOverride?: string;
}

const OUTCOMES: OutcomeDef[] = [
  { key: "CONNECTED",      emoji: "✅", label: "Connected",       bg: "bg-emerald-600 hover:bg-emerald-700" },
  { key: "NOT_ANSWERED",   emoji: "❌", label: "Not picked",      bg: "bg-gray-600 hover:bg-gray-700" },
  { key: "CALLBACK",       emoji: "⏰", label: "Callback later",  bg: "bg-amber-500 hover:bg-amber-600", needsCallback: true },
  { key: "WRONG_NUMBER",   emoji: "🚫", label: "Wrong number",    bg: "bg-rose-500 hover:bg-rose-600", notesOverride: "wrong number" },
  { key: "INTERESTED",     emoji: "🔥", label: "Interested",      bg: "bg-orange-600 hover:bg-orange-700", promote: true },
  { key: "NOT_INTERESTED", emoji: "😴", label: "Not interested",  bg: "bg-zinc-700 hover:bg-zinc-800", reject: true, notesOverride: "Not interested in cold call" },
];

// CallOutcome enum string we send to /api/leads/[id]/log-call.
function toEnumOutcome(k: OutcomeKey): string {
  if (k === "NOT_ANSWERED") return "NOT_PICKED";
  return k;
}

function formatBudget(min: number | null, max: number | null, ccy: string): string {
  if (!min && !max) return "—";
  const fmt = (n: number) => {
    if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
    if (n >= 100_000) return `${(n / 100_000).toFixed(1)}L`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return `${n}`;
  };
  if (min && max && min !== max) return `${ccy} ${fmt(min)}–${fmt(max)}`;
  return `${ccy} ${fmt(min ?? max!)}`;
}

export default function ColdCallSession({ leads }: { leads: SessionLead[] }) {
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Optional callback chooser (only shown after pressing the ⏰ button).
  const [showCallback, setShowCallback] = useState(false);
  const [callbackAt, setCallbackAt] = useState("");
  // XP tally — purely cosmetic, drives the completion message.
  const [xpEarned, setXpEarned] = useState(0);

  const total = leads.length;
  const done = idx >= total;
  const current = !done ? leads[idx] : null;

  const advance = useCallback(() => {
    setShowCallback(false);
    setCallbackAt("");
    setErr(null);
    setIdx((i) => i + 1);
  }, []);

  const submit = useCallback(async (outcome: OutcomeDef, opts?: { callbackISO?: string }) => {
    if (!current || busy) return;
    setBusy(true);
    setErr(null);
    try {
      // 1) Always log the call via the standard endpoint so call history,
      //    rescoring, gamification, and SLA all stay consistent.
      const r = await fetch(`/api/leads/${current.id}/log-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: toEnumOutcome(outcome.key),
          remarks: outcome.notesOverride ?? "",
          callbackAt: opts?.callbackISO ?? "",
          direction: "OUTBOUND",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? `Log failed (${r.status})`);
        setBusy(false);
        return;
      }
      if (j.awardedXp) {
        setXpEarned((x) => x + (j.awardedXp.amount ?? 0));
        showXpToast({
          amount: j.awardedXp.amount,
          label: j.awardedXp.label,
          leveledUp: !!j.awardedXp.leveledUp,
          newLevel: j.awardedXp.newLevel,
        });
      }

      // 2) Outcome-specific side-effects fire AFTER the log succeeded.
      if (outcome.promote) {
        const pr = await fetch(`/api/leads/${current.id}/promote-cold`, { method: "POST" });
        const pj = await pr.json().catch(() => ({}));
        if (pr.ok && pj.awardedXp) {
          setXpEarned((x) => x + (pj.awardedXp.amount ?? 0));
          showXpToast({
            amount: pj.awardedXp.amount,
            label: pj.awardedXp.label,
            leveledUp: !!pj.awardedXp.leveledUp,
            newLevel: pj.awardedXp.newLevel,
          });
        }
      } else if (outcome.reject) {
        // Reject endpoint requires reason + note when reason=OTHER.
        await fetch(`/api/leads/${current.id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "OTHER", note: "Not interested in cold call" }),
        }).catch(() => {});
      }

      advance();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  }, [current, busy, advance]);

  // ── Keyboard shortcuts: 1-6 trigger the matching outcome, → / s = skip.
  // Ignore when typing in the callback datetime input (focus on INPUT).
  useEffect(() => {
    if (done) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key >= "1" && e.key <= "6") {
        const i = Number(e.key) - 1;
        const o = OUTCOMES[i];
        if (!o) return;
        if (o.needsCallback) {
          setShowCallback(true);
          return;
        }
        void submit(o);
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "s") {
        advance();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, submit, advance]);

  // Callback chooser default — +1 hour, formatted for <input type="datetime-local">.
  const defaultCallback = useMemo(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  function submitCallback() {
    const raw = callbackAt || defaultCallback;
    const d = new Date(raw);
    if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      setErr("Pick a future time");
      return;
    }
    const callback = OUTCOMES.find((o) => o.key === "CALLBACK")!;
    void submit(callback, { callbackISO: d.toISOString() });
  }

  // ── Empty-list state.
  if (total === 0) {
    return (
      <div className="max-w-xl mx-auto mt-12 text-center space-y-3">
        <div className="text-5xl">🎉</div>
        <h1 className="text-xl font-bold">No cold leads to call</h1>
        <p className="text-sm text-gray-500">All your cold leads have been touched in the past 7 days. Nice work.</p>
        <Link href="/cold-calls" className="btn bg-emerald-600 text-white inline-block">← Back to Cold Calls</Link>
      </div>
    );
  }

  // ── Session complete state.
  if (done) {
    return (
      <div className="max-w-xl mx-auto mt-12 text-center space-y-3">
        <div className="text-6xl">🎯</div>
        <h1 className="text-2xl font-bold">Session complete!</h1>
        <p className="text-sm text-gray-600">
          You powered through <b>{total}</b> cold lead{total === 1 ? "" : "s"}.
          {xpEarned > 0 && <> Earned <b>+{xpEarned} XP</b>.</>}
        </p>
        <Link href="/cold-calls" className="btn bg-emerald-600 text-white inline-block">← Back to Cold Calls</Link>
      </div>
    );
  }

  // ── Active session.
  const lead = current!;
  const tel = lead.phone ? telLink(lead.phone) : "";
  const progress = Math.round(((idx) / total) * 100);
  const left = total - idx;

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* Top progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
          <span>Lead {idx + 1} of {total}</span>
          <span className="text-gray-500">{left} left</span>
        </div>
        <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* The big lead card */}
      <div className="card p-5 sm:p-6 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/leads/${lead.id}`} className="text-xl sm:text-2xl font-bold hover:underline truncate block">
              {lead.name}
            </Link>
            <div className="text-xs text-gray-500 mt-0.5">
              Budget: <span className="font-semibold text-gray-800">{formatBudget(lead.budgetMin, lead.budgetMax, lead.budgetCurrency)}</span>
            </div>
          </div>
          {lead.aiScore && (
            <span className={`chip text-[10px] font-bold ${
              lead.aiScore === "HOT" ? "chip-hot" :
              lead.aiScore === "WARM" ? "chip-warm" : "chip-cold"
            }`}>{lead.aiScore}</span>
          )}
        </div>

        {/* Tap-to-call — big, finger-sized */}
        {lead.phone ? (
          <a
            href={tel}
            className="flex items-center justify-center gap-2 w-full py-4 rounded-xl bg-emerald-600 text-white text-lg font-bold hover:bg-emerald-700 shadow"
          >
            📞 Tap to call {lead.phone}
          </a>
        ) : (
          <div className="text-center text-sm text-rose-600 py-2">No phone number on file</div>
        )}

        {lead.whoIsClient && (
          <div className="text-sm">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Who is client</div>
            <div className="text-gray-800 mt-0.5 whitespace-pre-wrap">{lead.whoIsClient}</div>
          </div>
        )}

        {(lead.remarks || lead.coldCallReason) && (
          <div className="text-sm">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Last note</div>
            <div className="text-gray-800 mt-0.5 whitespace-pre-wrap italic">
              {lead.remarks || lead.coldCallReason}
            </div>
          </div>
        )}
      </div>

      {/* Callback chooser appears only after tapping the ⏰ button */}
      {showCallback && (
        <div className="card p-3 space-y-2 border-amber-300">
          <div className="text-xs font-semibold">When should we call back?</div>
          <input
            type="datetime-local"
            value={callbackAt || defaultCallback}
            onChange={(e) => setCallbackAt(e.target.value)}
            className="w-full border rounded-lg px-2 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={submitCallback} disabled={busy} className="flex-1 btn bg-amber-500 text-white text-sm font-semibold disabled:opacity-50">
              {busy ? "Saving…" : "Save callback"}
            </button>
            <button onClick={() => { setShowCallback(false); setErr(null); }} disabled={busy} className="btn bg-gray-200 text-gray-800 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 6 big quick-outcome buttons in a 2-col grid */}
      <div className="grid grid-cols-2 gap-2">
        {OUTCOMES.map((o, i) => (
          <button
            key={o.key}
            onClick={() => {
              if (o.needsCallback) { setShowCallback(true); return; }
              void submit(o);
            }}
            disabled={busy}
            className={`flex flex-col items-center justify-center gap-0.5 py-4 rounded-xl text-white text-sm font-bold shadow transition disabled:opacity-50 ${o.bg}`}
          >
            <span className="text-2xl leading-none">{o.emoji}</span>
            <span>{o.label}</span>
            <span className="text-[10px] opacity-80 font-normal">press {i + 1}</span>
          </button>
        ))}
      </div>

      {/* Skip — advances without logging */}
      <button
        onClick={advance}
        disabled={busy}
        className="w-full py-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        Skip → (or press →)
      </button>

      {err && <div className="text-xs text-red-600 text-center">{err}</div>}
    </div>
  );
}
