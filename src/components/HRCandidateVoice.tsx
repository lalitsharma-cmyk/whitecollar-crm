"use client";
// HRCandidateVoice — the HR Voice Engine surface on the Candidate View. Mirrors the
// Sales LeadVoiceGuidance (Channel ①) + LeadEscalationThread (Channel ②), unified into
// one "Voice & Escalations" card. Self-fetches the voice list from
// /api/hr/candidates/[id]/voice and reuses the shared useVoiceRecorder hook.
//
//   • Guidance  (canGuide)    : manager records one-way voice guidance for the owner(s).
//   • Escalation(canEscalate) : HR raises a voice escalation thread to a reviewer.
//   • Reply     (canReview)   : reviewer replies by voice + can mark the thread resolved.
//
// Audio is persisted verbatim and streams inline from .../voice/[messageId]/play.
// Transcript is OPTIONAL everywhere — never blocks sending.
import { useCallback, useEffect, useState } from "react";
import { Mic, Square, AlertTriangle, CheckCircle2, MessageSquare, Loader2 } from "lucide-react";
import { useVoiceRecorder } from "@/components/useVoiceRecorder";

type Kind = "GUIDANCE" | "ESCALATION" | "ESCALATION_REPLY";

interface VoiceMsg {
  id: string;
  kind: Kind;
  by: string;
  at: string;
  transcript: string | null;
  textNote: string | null;
  title: string | null;
  durationSec: number | null;
  escalationId: string | null;
  mine: boolean;
  understood: boolean;
}
interface Escalation {
  id: string;
  reason: string;
  status: "PENDING" | "MANAGER_REPLIED" | "RESOLVED";
  raisedBy: string;
  raisedById: string;
  resolvedAt: string | null;
  createdAt: string;
}
interface ApiResp { me: { id: string }; messages: VoiceMsg[]; escalations: Escalation[]; }

interface Props {
  candidateId: string;
  canGuide: boolean;
  canEscalate: boolean;
  canReview: boolean;
}

const fmtIST = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
  }) + " IST";
const fmtDur = (s: number | null) => { if (!s || s <= 0) return ""; const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; };

const STATUS_CHIP: Record<Escalation["status"], { label: string; cls: string }> = {
  PENDING: { label: "Awaiting reviewer", cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700" },
  MANAGER_REPLIED: { label: "Reviewer replied", cls: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700" },
  RESOLVED: { label: "Resolved", cls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700" },
};

// ── Inline voice recorder + send box. onSend gets a ready FormData (audio + meta). ──
function RecorderBox({ candidateId, label, kind, escalationId, onSent }: {
  candidateId: string; label: string; kind: Kind; escalationId?: string; onSent: () => void;
}) {
  const rec = useVoiceRecorder();
  const [title, setTitle] = useState("");
  const [textNote, setTextNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!rec.supported) {
    return <p className="text-xs text-gray-500 dark:text-slate-400">Voice recording isn&apos;t supported on this browser. Open the CRM on your phone (Chrome/Safari).</p>;
  }

  async function send() {
    if (!rec.audioBlob) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("audio", rec.audioBlob, "voice.webm");
      fd.set("transcript", rec.transcript);
      fd.set("durationSec", String(rec.seconds));
      fd.set("lang", "en-IN");
      if (kind === "GUIDANCE") fd.set("title", title.trim());
      else fd.set("textNote", textNote.trim());
      if (escalationId) fd.set("escalationId", escalationId);
      const r = await fetch(`/api/hr/candidates/${candidateId}/voice`, { method: "POST", body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error ?? `Failed (${r.status})`); }
      rec.reset(); setTitle(""); setTextNote("");
      onSent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to send.");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-2.5 space-y-2 bg-gray-50/60 dark:bg-slate-800/40">
      <div className="flex items-center gap-2">
        {!rec.recording && !rec.audioBlob && (
          <button type="button" onClick={rec.start} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0b1a33] hover:bg-[#1a2d4d] text-white text-sm font-medium px-3 py-1.5 dark:bg-blue-700 dark:hover:bg-blue-600">
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
          {kind === "GUIDANCE" && (
            <input
              value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional title / category"
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-600 px-2 py-1.5 dark:bg-slate-800 dark:text-slate-100"
            />
          )}
          <textarea
            value={rec.transcript}
            onChange={(e) => rec.setTranscript(e.target.value)}
            placeholder={rec.speechSupported ? "Transcript (auto — edit if needed; audio is saved exactly)…" : "Type what you said (auto-transcription not available on this browser)…"}
            rows={2}
            className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-600 px-2 py-1.5 dark:bg-slate-800 dark:text-slate-100"
          />
          {kind !== "GUIDANCE" && (
            <input
              value={textNote} onChange={(e) => setTextNote(e.target.value)}
              placeholder="Optional short note (e.g. what you need help on)"
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-600 px-2 py-1.5 dark:bg-slate-800 dark:text-slate-100"
            />
          )}
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={send} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-3 py-1.5 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}{busy ? "Sending…" : "Send"}
            </button>
            <button type="button" disabled={busy} onClick={() => rec.reset()} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-slate-200 underline">Discard</button>
          </div>
        </>
      )}
      {(err || rec.error) && <p className="text-xs text-red-600 dark:text-red-400">{err ?? rec.error}</p>}
    </div>
  );
}

export default function HRCandidateVoice({ candidateId, canGuide, canEscalate, canReview }: Props) {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/hr/candidates/${candidateId}/voice`, { cache: "no-store" });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      setData(await r.json());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load voice messages.");
    } finally { setLoading(false); }
  }, [candidateId]);

  useEffect(() => { load(); }, [load]);

  const audioSrc = (mId: string) => `/api/hr/candidates/${candidateId}/voice/${mId}/play`;

  async function markUnderstood(messageId: string) {
    await fetch(`/api/hr/candidates/${candidateId}/voice`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId }),
    }).catch(() => {});
    load();
  }
  async function resolve(escalationId: string) {
    await fetch(`/api/hr/candidates/${candidateId}/escalation`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ escalationId }),
    }).catch(() => {});
    load();
  }

  const guidance = (data?.messages ?? []).filter((m) => m.kind === "GUIDANCE");
  const escalations = data?.escalations ?? [];
  const openEsc = escalations.find((e) => e.status !== "RESOLVED") ?? null;
  const resolvedEsc = escalations.filter((e) => e.status === "RESOLVED");
  const escMsgs = (escId: string) => (data?.messages ?? []).filter((m) => m.escalationId === escId);
  const unreadGuidance = guidance.filter((m) => !m.mine && !m.understood).length;

  // ── Guidance message card ──
  const GuidanceCard = ({ m }: { m: VoiceMsg }) => {
    const unread = !m.mine && !m.understood;
    return (
      <li className={`rounded-lg border p-2.5 ${unread
        ? "border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/20"
        : "border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800/40"}`}>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-gray-800 dark:text-slate-100 flex items-center gap-1.5">
              {unread && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 flex-none" aria-label="unread" />}
              <Mic size={13} className="text-[#0b1a33] dark:text-blue-300" /> Voice guidance by {m.by}{m.mine ? " (you)" : ""}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400">{fmtIST(m.at)}{m.title ? ` · ${m.title}` : ""}{m.durationSec ? ` · ${fmtDur(m.durationSec)}` : ""}</div>
          </div>
        </div>
        <audio controls src={audioSrc(m.id)} className="w-full h-9 mt-1.5" preload="none" />
        {m.transcript && <p className="text-sm text-gray-700 dark:text-slate-200 mt-1.5 whitespace-pre-wrap leading-relaxed">{m.transcript}</p>}
        {!m.mine && (
          <div className="mt-1.5 flex justify-end">
            {m.understood
              ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium"><CheckCircle2 size={12} /> Understood</span>
              : <button type="button" onClick={() => markUnderstood(m.id)}
                  className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
                  Mark as understood
                </button>}
          </div>
        )}
      </li>
    );
  };

  // ── Escalation message bubble ──
  const EscBubble = ({ m }: { m: VoiceMsg }) => (
    <div className={`rounded-lg border p-2.5 ${m.kind === "ESCALATION_REPLY"
      ? "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/15 ml-4"
      : "border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800 mr-4"}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-slate-400">
        <span className="font-semibold text-gray-700 dark:text-slate-200">{m.by}{m.mine ? " (you)" : ""}{m.kind === "ESCALATION_REPLY" ? " · reviewer" : ""}</span>
        <span>{fmtIST(m.at)}{m.durationSec ? ` · ${fmtDur(m.durationSec)}` : ""}</span>
      </div>
      <audio controls src={audioSrc(m.id)} className="w-full h-9 mt-1.5" preload="none" />
      {m.transcript && <p className="text-sm text-gray-700 dark:text-slate-200 mt-1.5 whitespace-pre-wrap">{m.transcript}</p>}
      {m.textNote && <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 italic">&ldquo;{m.textNote}&rdquo;</p>}
    </div>
  );

  // Nothing to show and nothing to do → render nothing (keeps the page clean).
  if (!loading && !err && guidance.length === 0 && escalations.length === 0 && !canGuide && !canEscalate) return null;

  return (
    <div className="card p-4" data-candidate-section="voice-escalations">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <MessageSquare size={16} className="text-[#0b1a33] dark:text-blue-300" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">Voice &amp; Escalations</span>
        {unreadGuidance > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700">
            {unreadGuidance} new
          </span>
        )}
      </div>

      {loading && <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

      {!loading && !err && (
        <div className="space-y-5">
          {/* ── Manager Voice Guidance (Channel ①) ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">
              <Mic size={13} /> Manager Voice Guidance
            </div>
            {canGuide && <RecorderBox candidateId={candidateId} label="Record Voice Guidance" kind="GUIDANCE" onSent={load} />}
            {guidance.length === 0
              ? <p className="text-xs text-gray-400 dark:text-slate-500">No voice guidance yet.</p>
              : <ul className="space-y-2">{guidance.map((m) => <GuidanceCard key={m.id} m={m} />)}</ul>}
          </div>

          {/* ── Escalation Thread (Channel ②) ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">
              <AlertTriangle size={13} className="text-amber-500" /> Escalation to Reviewer
            </div>

            {openEsc ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[openEsc.status].cls}`}>{STATUS_CHIP[openEsc.status].label}</span>
                  {canReview && (
                    <button type="button" onClick={() => resolve(openEsc.id)} className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:underline">
                      <CheckCircle2 size={13} /> Mark resolved
                    </button>
                  )}
                </div>
                <div className="space-y-2">{escMsgs(openEsc.id).map((m) => <EscBubble key={m.id} m={m} />)}</div>
                {canReview
                  ? <RecorderBox candidateId={candidateId} label="Record reply" kind="ESCALATION_REPLY" escalationId={openEsc.id} onSent={load} />
                  : canEscalate
                    ? <RecorderBox candidateId={candidateId} label="Add a message" kind="ESCALATION" onSent={load} />
                    : null}
              </div>
            ) : canEscalate ? (
              <div className="space-y-1.5">
                <p className="text-xs text-gray-500 dark:text-slate-400">Stuck on this candidate? Record a voice escalation — a reviewer gets notified instantly and replies here.</p>
                <RecorderBox candidateId={candidateId} label="Raise escalation" kind="ESCALATION" onSent={load} />
              </div>
            ) : (
              <p className="text-xs text-gray-400 dark:text-slate-500">No open escalation on this candidate.</p>
            )}

            {resolvedEsc.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-500 dark:text-slate-400">Resolved escalations ({resolvedEsc.length})</summary>
                <div className="mt-2 space-y-2 opacity-80">
                  {resolvedEsc.map((e) => (
                    <div key={e.id} className="space-y-1.5 border-l-2 border-emerald-200 dark:border-emerald-800 pl-2">
                      {escMsgs(e.id).map((m) => <EscBubble key={m.id} m={m} />)}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
