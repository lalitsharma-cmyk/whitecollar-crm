"use client";
// DashboardVoiceBroadcast — Feature 1 SENDER (Lalit/Admin only). Record a voice
// message + choose audience (Everyone / a Team / one agent) + send. Recipients see
// it on their dashboard. Transcript is OPTIONAL (the audio sends even without it).
// Reuses the shared useVoiceRecorder hook. Rendered only when the server has
// already confirmed canSendBroadcast (role ADMIN && !leadOpsOnly).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Mic, Square } from "lucide-react";
import { useVoiceRecorder } from "@/components/useVoiceRecorder";

type Agent = { id: string; name: string; team: string | null };
type TargetKind = "ALL" | "TEAM" | "USER";

const fmtDur = (s: number) => { if (!s) return ""; const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; };

export default function DashboardVoiceBroadcast({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const rec = useVoiceRecorder();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TargetKind>("ALL");
  const [team, setTeam] = useState("Dubai");
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    if (!rec.audioBlob) { setMsg("Record a message first."); return; }
    if (kind === "USER" && !userId) { setMsg("Pick an agent to send to."); return; }
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("audio", rec.audioBlob, "broadcast.webm");
      fd.set("targetKind", kind);
      if (kind === "TEAM") fd.set("targetTeam", team);
      if (kind === "USER") fd.set("targetUserId", userId);
      fd.set("transcript", rec.transcript);   // optional — server never requires it
      fd.set("title", title.trim());
      fd.set("durationSec", String(rec.seconds));
      const r = await fetch("/api/voice-broadcast", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(`⚠ ${j.error ?? `Failed (${r.status})`}`); return; }
      setMsg(`✅ Sent to ${j.recipients} recipient${j.recipients === 1 ? "" : "s"}.`);
      rec.reset(); setTitle(""); setOpen(false);
      router.refresh();
    } catch { setMsg("⚠ Network error."); }
    finally { setBusy(false); }
  }

  const seg = "text-sm border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 dark:bg-slate-800 dark:text-slate-100";

  return (
    <div className="rounded-xl border border-[#c9a24b]/40 bg-amber-50/40 dark:bg-slate-800/40 p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-bold text-[#0b1a33] dark:text-[#d9b765]">
          <Megaphone size={16} /> Send Voice Broadcast
        </span>
        <span className="text-xs text-gray-500">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2.5">
          {!rec.supported && <p className="text-xs text-red-600 dark:text-red-400">Recording isn&apos;t supported on this browser — open the CRM on your phone (Chrome/Safari).</p>}

          {/* Audience */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-slate-300">Send to:</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as TargetKind)} className={seg}>
              <option value="ALL">Everyone</option>
              <option value="TEAM">A team</option>
              <option value="USER">One agent</option>
            </select>
            {kind === "TEAM" && (
              <select value={team} onChange={(e) => setTeam(e.target.value)} className={seg}>
                <option value="Dubai">Dubai team</option>
                <option value="India">India team</option>
              </select>
            )}
            {kind === "USER" && (
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className={`${seg} min-w-[160px]`}>
                <option value="">— pick agent —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.team ? ` · ${a.team}` : ""}</option>)}
              </select>
            )}
          </div>

          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional title (e.g. Morning huddle)" className={`${seg} w-full`} />

          {/* Recorder */}
          <div className="flex items-center gap-2">
            {!rec.recording && !rec.audioBlob && rec.supported && (
              <button type="button" onClick={rec.start} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-3 py-1.5"><Mic size={15} /> Record</button>
            )}
            {rec.recording && (
              <button type="button" onClick={rec.stop} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 text-white text-sm font-medium px-3 py-1.5"><Square size={13} /> Stop · {fmtDur(rec.seconds)}</button>
            )}
            {rec.recording && <span className="text-xs text-red-600 dark:text-red-400 animate-pulse">● recording…</span>}
          </div>

          {rec.audioBlob && !rec.recording && (
            <>
              {rec.audioUrl && <audio controls src={rec.audioUrl} className="w-full h-9" />}
              <textarea value={rec.transcript} onChange={(e) => rec.setTranscript(e.target.value)} rows={2}
                placeholder={rec.speechSupported ? "Transcript (optional — auto, edit if needed)…" : "Transcript optional — type if you want (auto-transcription not available here)…"}
                className={`${seg} w-full`} />
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy} onClick={send} className="rounded-lg bg-[#0b1a33] dark:bg-[#c9a24b] dark:text-[#0b1a33] text-white text-sm font-semibold px-3 py-1.5 disabled:opacity-50">{busy ? "Sending…" : "📤 Send broadcast"}</button>
                <button type="button" disabled={busy} onClick={() => rec.reset()} className="text-xs text-gray-500 underline">Re-record</button>
              </div>
            </>
          )}
          {rec.error && <p className="text-xs text-red-600 dark:text-red-400">{rec.error}</p>}
        </div>
      )}
      {msg && <div className="mt-2 text-xs px-2.5 py-1.5 rounded bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200">{msg}</div>}
    </div>
  );
}
