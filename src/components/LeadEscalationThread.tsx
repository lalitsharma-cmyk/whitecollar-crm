"use client";
// LeadEscalationThread — Channel ② "Escalation Thread" on the Lead View.
// The assigned agent raises a VOICE escalation to the manager (Lalit); the manager
// replies by voice; either side can mark it resolved. Mirrors Channel ①'s audio
// plumbing (original audio persisted + browser transcript) via the shared
// useVoiceRecorder hook. Audio streams inline from the existing kind-agnostic
// /voice-message/[msgId]/audio endpoint. Compact, light + dark.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useVoiceRecorder } from "@/components/useVoiceRecorder";

export interface EscMsg {
  id: string;
  kind: "ESCALATION" | "ESCALATION_REPLY";
  by: string;
  at: string;          // ISO
  transcript: string | null;
  textNote: string | null;
  durationSec: number | null;
  mine: boolean;
}
export interface EscThread {
  id: string;
  reason: string;
  status: "PENDING" | "MANAGER_REPLIED" | "RESOLVED";
  raisedBy: string;
  messages: EscMsg[];
}
interface Props {
  leadId: string;
  isManager: boolean;   // ADMIN/MANAGER — can reply
  canRaise: boolean;    // viewer may open/continue a thread (agent who owns the lead)
  threads: EscThread[];
}

const fmtIST = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
  }) + " IST";
const fmtDur = (s: number | null) => { if (!s || s <= 0) return ""; const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; };

const STATUS_CHIP: Record<EscThread["status"], { label: string; cls: string }> = {
  PENDING: { label: "⏳ Awaiting manager", cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700" },
  MANAGER_REPLIED: { label: "💬 Manager replied", cls: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700" },
  RESOLVED: { label: "✅ Resolved", cls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700" },
};

// Inline voice recorder + send box. onSend gets a ready FormData (audio + meta).
function RecorderBox({ label, onSend }: { label: string; onSend: (fd: FormData) => Promise<void> }) {
  const rec = useVoiceRecorder();
  const [textNote, setTextNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!rec.supported) {
    return <p className="text-xs text-gray-500 dark:text-slate-400">Voice recording isn&apos;t supported on this browser. Open the CRM on your phone (Chrome/Safari).</p>;
  }

  async function send() {
    if (!rec.audioBlob) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("audio", rec.audioBlob, "escalation.webm");
      fd.set("transcript", rec.transcript);
      fd.set("textNote", textNote.trim());
      fd.set("durationSec", String(rec.seconds));
      fd.set("lang", "en-IN");
      await onSend(fd);
      rec.reset(); setTextNote("");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-2.5 space-y-2 bg-gray-50/60 dark:bg-slate-800/40">
      <div className="flex items-center gap-2">
        {!rec.recording && !rec.audioBlob && (
          <button type="button" onClick={rec.start} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-3 py-1.5">
            <Mic size={15} /> {label}
          </button>
        )}
        {rec.recording && (
          <button type="button" onClick={rec.stop} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 text-white text-sm font-medium px-3 py-1.5">
            <Square size={13} /> Stop · {fmtDur(rec.seconds)}
          </button>
        )}
        {rec.recording && <span className="text-xs text-red-600 dark:text-red-400 animate-pulse">● recording…</span>}
      </div>

      {rec.audioBlob && !rec.recording && (
        <>
          {rec.audioUrl && <audio controls src={rec.audioUrl} className="w-full h-9" />}
          <textarea
            value={rec.transcript}
            onChange={(e) => rec.setTranscript(e.target.value)}
            placeholder={rec.speechSupported ? "Transcript (auto — edit if needed)…" : "Type what you said (auto-transcription not available on this browser)…"}
            rows={2}
            className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-600 px-2 py-1.5 dark:bg-slate-800 dark:text-slate-100"
          />
          <input
            value={textNote} onChange={(e) => setTextNote(e.target.value)}
            placeholder="Optional short note (e.g. which point you need help on)"
            className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-600 px-2 py-1.5 dark:bg-slate-800 dark:text-slate-100"
          />
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={send} className="rounded-lg bg-[#0b1a33] dark:bg-[#c9a24b] dark:text-[#0b1a33] text-white text-sm font-medium px-3 py-1.5 disabled:opacity-50">{busy ? "Sending…" : "Send"}</button>
            <button type="button" disabled={busy} onClick={() => rec.reset()} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-slate-200 underline">Discard</button>
          </div>
        </>
      )}
      {rec.error && <p className="text-xs text-red-600 dark:text-red-400">{rec.error}</p>}
    </div>
  );
}

export default function LeadEscalationThread({ leadId, isManager, canRaise, threads }: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  const open = threads.find((t) => t.status !== "RESOLVED") ?? null;
  const resolved = threads.filter((t) => t.status === "RESOLVED");

  async function post(url: string, body?: FormData | object) {
    setMsg(null);
    const init: RequestInit = { method: "POST" };
    if (body instanceof FormData) init.body = body;
    else if (body) { init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify(body); }
    const r = await fetch(url, init);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(`⚠ ${j.error ?? `Failed (${r.status})`}`); return; }
    router.refresh();
  }

  const audioSrc = (mId: string) => `/api/leads/${leadId}/voice-message/${mId}/audio`;

  const Message = ({ m }: { m: EscMsg }) => (
    <div className={`rounded-lg border p-2.5 ${m.kind === "ESCALATION_REPLY" ? "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/15 ml-4" : "border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800 mr-4"}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-slate-400">
        <span className="font-semibold text-gray-700 dark:text-slate-200">{m.kind === "ESCALATION_REPLY" ? "👔 " : "🎧 "}{m.by}{m.mine ? " (you)" : ""}</span>
        <span>{fmtIST(m.at)}{m.durationSec ? ` · ${fmtDur(m.durationSec)}` : ""}</span>
      </div>
      <audio controls src={audioSrc(m.id)} className="w-full h-9 mt-1.5" preload="none" />
      {m.transcript && <p className="text-sm text-gray-700 dark:text-slate-200 mt-1.5 whitespace-pre-wrap">{m.transcript}</p>}
      {m.textNote && <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 italic">“{m.textNote}”</p>}
    </div>
  );

  return (
    <section className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-500" />
        <h3 className="text-sm font-bold text-gray-800 dark:text-slate-100">Escalation to Manager</h3>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">Voice Channel ②</span>
      </div>

      {msg && <div className="text-xs px-2.5 py-1.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200">{msg}</div>}

      {open ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[open.status].cls}`}>{STATUS_CHIP[open.status].label}</span>
            <button type="button" onClick={() => post(`/api/leads/${leadId}/escalation/${open.id}/resolve`, {})}
              className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:underline">
              <CheckCircle2 size={13} /> Mark resolved
            </button>
          </div>
          <div className="space-y-2">{open.messages.map((m) => <Message key={m.id} m={m} />)}</div>
          {isManager
            ? <RecorderBox label="Record reply" onSend={(fd) => post(`/api/leads/${leadId}/escalation/${open.id}/reply`, fd)} />
            : <RecorderBox label="Add a message" onSend={(fd) => post(`/api/leads/${leadId}/escalation`, fd)} />}
        </div>
      ) : canRaise ? (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500 dark:text-slate-400">Stuck on this lead? Record a voice escalation — Lalit gets notified instantly and replies here.</p>
          <RecorderBox label="Raise escalation" onSend={(fd) => post(`/api/leads/${leadId}/escalation`, fd)} />
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-slate-400">No open escalation on this lead.</p>
      )}

      {resolved.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-500 dark:text-slate-400">Resolved escalations ({resolved.length})</summary>
          <div className="mt-2 space-y-2 opacity-80">
            {resolved.map((t) => (
              <div key={t.id} className="space-y-1.5 border-l-2 border-emerald-200 dark:border-emerald-800 pl-2">
                {t.messages.map((m) => <Message key={m.id} m={m} />)}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
