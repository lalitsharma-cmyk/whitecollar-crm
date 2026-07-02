"use client";
// AS Phone / telephony admin console (client). Reads /api/admin/telephony and
// surfaces config readiness, the webhook URL, agent mapping, the raw event feed,
// retry-queue health, and manual controls. Read-only until credentials are set.
import { useCallback, useEffect, useState } from "react";

type Cfg = { key: string; label: string; set: boolean; required: boolean };
type EventRow = { id: string; provider: string; providerCallId: string | null; direction: string | null; eventType: string | null; processed: boolean; error: string | null; receivedAt: string };
type FailedTask = { id: string; kind: string; refId: string | null; attempts: number; lastError: string | null; updatedAt: string };
type Agent = { id: string; name: string | null; acefoneAgentId: string | null; team: string | null };
type Data = {
  provider: string; ready: boolean; missing: string[]; config: Cfg[]; webhookUrl: string; signsWithHmac: boolean;
  counts: { byProvider: { provider: string; count: number }[]; unlinked: number };
  queue: { pending: number; failed: number; failedTasks: FailedTask[] };
  events: EventRow[];
  agents: { mapped: Agent[]; unmappedCount: number };
};

const CARD = "card p-4 space-y-3";

export default function TelephonyConsoleClient() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch("/api/admin/telephony");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setData(j);
    } catch (e) { setErr(String(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (action: string, extra?: Record<string, unknown>) => {
    setBusy(action); setMsg(null); setErr(null);
    try {
      const r = await fetch("/api/admin/telephony", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setMsg(`${action}: ${JSON.stringify(j).slice(0, 200)}`);
      await load();
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  }, [load]);

  const copy = (s: string) => { navigator.clipboard?.writeText(s).then(() => setMsg("Copied webhook URL")).catch(() => {}); };

  if (err && !data) return <div className={CARD}><div className="text-sm text-red-600">{err}</div></div>;
  if (!data) return <div className={CARD}><div className="text-sm text-gray-500">Loading telephony status…</div></div>;

  return (
    <div className="space-y-4">
      {/* ── Readiness + config ─────────────────────────────────────────────── */}
      <div className={CARD}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="font-semibold">Provider: <span className="font-mono">{data.provider}</span></div>
          <span className={`text-xs px-2 py-0.5 rounded ${data.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {data.ready ? "READY — calls will flow" : `Not configured — missing: ${data.missing.join(", ") || "credentials"}`}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {data.config.map((c) => (
            <div key={c.key} className="flex items-center gap-2 text-sm">
              <span className={`inline-block w-2 h-2 rounded-full ${c.set ? "bg-emerald-500" : c.required ? "bg-red-400" : "bg-gray-300"}`} />
              <span>{c.label}</span>
              <span className="text-[11px] text-gray-400">{c.set ? "set" : c.required ? "required" : "optional"}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-gray-500 dark:text-slate-400">
          Set these in Vercel → Settings → Environment Variables, then redeploy. Secret enables webhook
          HMAC verification ({data.signsWithHmac ? "active" : "not set — token guard used"}).
        </div>
      </div>

      {/* ── Webhook URL to paste into the provider ─────────────────────────── */}
      <div className={CARD}>
        <div className="font-semibold">Inbound webhook URL</div>
        <div className="flex items-center gap-2">
          <code className="text-xs bg-gray-100 dark:bg-slate-800 rounded px-2 py-1 flex-1 overflow-x-auto whitespace-nowrap">{data.webhookUrl}</code>
          <button onClick={() => copy(data.webhookUrl)} className="btn btn-ghost text-xs whitespace-nowrap">Copy</button>
        </div>
        <div className="text-xs text-gray-500 dark:text-slate-400">Point every call-event trigger (answered / missed / recording-ready) here. POST JSON or form-urlencoded.</div>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div className={CARD}>
        <div className="font-semibold">Controls</div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => act("sync")} disabled={!!busy} className="btn btn-primary text-xs">{busy === "sync" ? "Syncing…" : "Sync recent calls"}</button>
          <button onClick={() => act("retry")} disabled={!!busy} className="btn btn-ghost text-xs">{busy === "retry" ? "Draining…" : `Drain retry queue (${data.queue.pending})`}</button>
          <button onClick={load} disabled={!!busy} className="btn btn-ghost text-xs">Refresh</button>
        </div>
        {msg && <div className="text-xs text-emerald-600 break-all">{msg}</div>}
        {err && <div className="text-xs text-red-600">{err}</div>}
        <div className="text-xs text-gray-500 dark:text-slate-400">
          Calls logged: {data.counts.byProvider.map((p) => `${p.provider} ${p.count}`).join(" · ") || "none yet"}
          {data.counts.unlinked > 0 && <span className="text-amber-600"> · {data.counts.unlinked} unlinked</span>}
          {data.queue.failed > 0 && <span className="text-red-600"> · {data.queue.failed} failed tasks</span>}
        </div>
      </div>

      {/* ── Agent mapping ──────────────────────────────────────────────────── */}
      <div className={CARD}>
        <div className="font-semibold">Agent → extension mapping</div>
        <p className="text-xs text-gray-500 dark:text-slate-400">A call is attributed to the agent whose telephony extension matches. Set each agent&apos;s id in Team &amp; Roles. {data.agents.unmappedCount > 0 && <span className="text-amber-600">{data.agents.unmappedCount} active non-admin users have no extension.</span>}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
          {data.agents.mapped.map((a) => (
            <div key={a.id} className="flex items-center justify-between border-t border-gray-100 dark:border-slate-800 pt-1">
              <span>{a.name} <span className="text-[11px] text-gray-400">{a.team}</span></span>
              <span className="font-mono text-xs">{a.acefoneAgentId}</span>
            </div>
          ))}
          {data.agents.mapped.length === 0 && <div className="text-xs text-gray-400">No agents mapped yet.</div>}
        </div>
      </div>

      {/* ── Retry queue failures ───────────────────────────────────────────── */}
      {data.queue.failedTasks.length > 0 && (
        <div className={CARD}>
          <div className="font-semibold text-red-600">Failed tasks (gave up after retries)</div>
          {data.queue.failedTasks.map((t) => (
            <div key={t.id} className="text-xs border-t border-gray-100 dark:border-slate-800 pt-1">
              <span className="font-mono">{t.kind}</span> · {t.refId ?? "—"} · {t.attempts} attempts
              <div className="text-[11px] text-gray-400 truncate">{t.lastError}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Raw inbound event feed ─────────────────────────────────────────── */}
      <div className={CARD}>
        <div className="font-semibold">Recent inbound events (verbatim audit)</div>
        {data.events.length === 0 && <div className="text-xs text-gray-400">No events received yet. Once numbers are live and the webhook fires, they appear here.</div>}
        {data.events.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 text-xs border-t border-gray-100 dark:border-slate-800 pt-1">
            <div className="min-w-0">
              <span className={`px-1.5 py-0.5 rounded ${e.processed ? "bg-emerald-100 text-emerald-700" : e.error ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>{e.processed ? "ok" : e.error ? "err" : "…"}</span>
              {" "}<span className="font-mono">{e.provider}</span> · {e.direction ?? "?"} · {e.eventType ?? "?"} · <span className="font-mono">{e.providerCallId?.slice(-8) ?? "—"}</span>
              {e.error && <div className="text-[11px] text-red-500 truncate">{e.error}</div>}
            </div>
            {!e.processed && (
              <button onClick={() => act("replay", { eventId: e.id })} disabled={!!busy} className="btn btn-ghost text-[11px] whitespace-nowrap">Replay</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
