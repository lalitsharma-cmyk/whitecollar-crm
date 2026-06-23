"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, Mail, AlertCircle, Mic } from "lucide-react";
import { whatsappLink, telLink } from "@/lib/phone";

// ── Buyer action button row — EXACT visual parity with LeadActionsClient ──────
// Same grid (grid-cols-3 sm:grid-cols-5), same button colours/sizes:
//   • Call (emerald)  → tel:
//   • WhatsApp (#25D366 green) → wa.me with a greeting draft
//   • Email (slate) → mailto:
//   • Log Call (gold #c9a24b) → opens the Log conversation modal → POST buyer
//     activity (CALL/WHATSAPP/NOTE/VOICE) with an outcome-ish note
//   • Note (amber #fcd34d) → opens the buyer sticky note (same event the widget
//     listens for: open-sticky-<buyerId>)
//   • Voice (purple) → browser Web Speech dictation → POST VOICE_NOTE activity
// All log actions go through /api/buyer-data/[id]/activity. Call/WA/Email are pure
// tel:/wa.me/mailto links (parity with the Lead view). Only enabled when the buyer
// is ASSIGNED (canLog); on a pool/converted buyer the Call/WA/Email links still
// work but the logging actions are hidden, mirroring how a converted lead behaves.

interface Props {
  buyerId: string;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  clientName: string;
  agentName: string;
  canLog: boolean; // buyer is ASSIGNED and viewer may log activity
}

const LOG_OUTCOMES: { key: string; type: string; label: string }[] = [
  { key: "CALL_CONNECTED",   type: "CALL",     label: "✅ Call connected" },
  { key: "CALL_NOT_PICKED",  type: "ATTEMPT_NOT_PICKED",  label: "📵 Not answered (attempt)" },
  { key: "CALL_NO_ANSWER",   type: "ATTEMPT_NO_ANSWER",   label: "📴 No answer (attempt)" },
  { key: "WA_SENT",          type: "WHATSAPP", label: "💬 WhatsApp sent" },
  { key: "WA_NO_RESPONSE",   type: "ATTEMPT_WA_NO_RESPONSE", label: "🚫 WA no response (attempt)" },
  { key: "NOTE",             type: "NOTE",     label: "📝 Note only" },
];

export default function BuyerActionsClient({ buyerId, phone, altPhone, email, clientName, agentName, canLog }: Props) {
  const router = useRouter();
  const waGreeting = `Hi ${clientName}, this is ${agentName} from White Collar Realty regarding your property. May I know a convenient time to connect?`;

  const [showLog, setShowLog] = useState(false);
  const [outcomeKey, setOutcomeKey] = useState("CALL_CONNECTED");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Voice dictation (Web Speech API) — same approach as LeadActionsClient.
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<unknown>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (SR) setSpeechSupported(true);
  }, []);

  function stopDictation() {
    const rec = recognitionRef.current as { stop?: () => void } | null;
    if (rec && typeof rec.stop === "function") { try { rec.stop(); } catch { /* already stopped */ } }
    recognitionRef.current = null;
    setListening(false);
  }
  function toggleDictation() {
    if (listening) { stopDictation(); return; }
    if (typeof window === "undefined") return;
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR() as {
      lang: string; continuous: boolean; interimResults: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void;
      onerror: () => void; onend: () => void; start: () => void; stop: () => void;
    };
    rec.lang = "en-IN"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (event) => {
      let chunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) chunk += event.results[i][0].transcript;
      const piece = chunk.trim();
      if (piece) setRemarks((prev) => (prev ? `${prev} ${piece}` : piece));
    };
    rec.onerror = () => stopDictation();
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = rec;
    try { rec.start(); setListening(true); } catch { recognitionRef.current = null; setListening(false); }
  }
  useEffect(() => { if (!showLog && listening) stopDictation(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showLog]);

  async function logActivity(type: string, description: string | null) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/buyer-data/${buyerId}/activity`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, description }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed to log."); return false; }
      return true;
    } catch { setErr("Network error."); return false; }
    finally { setBusy(false); }
  }

  async function submitLog() {
    const opt = LOG_OUTCOMES.find((o) => o.key === outcomeKey);
    if (!opt) return;
    const ok = await logActivity(opt.type, remarks.trim() || null);
    if (ok) {
      setShowLog(false); setRemarks(""); setOutcomeKey("CALL_CONNECTED");
      router.refresh();
    }
  }

  async function quickVoiceNote() {
    // Tapping Voice opens the Log modal pre-set to a VOICE note with dictation —
    // mirrors the Lead voice-note flow (record → save). We reuse the same modal.
    setOutcomeKey("NOTE");
    setShowLog(true);
    // Auto-start dictation for a true voice-first feel.
    setTimeout(() => { if (speechSupported && !listening) toggleDictation(); }, 200);
  }

  return (
    <div className="w-full min-w-0">
      {!phone && (
        <div className="mt-3 mb-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-1.5 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700">
          <Phone className="w-3.5 h-3.5 flex-none" />
          No phone number on this buyer — Call &amp; WhatsApp are unavailable.
        </div>
      )}
      {/* Primary action bar — identical grid + button styling to the Lead view. */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-3">
        {phone && (
          <a href={telLink(phone)} className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition shadow-sm min-h-11">
            <Phone className="w-4 h-4" /> Call
          </a>
        )}
        {phone && (
          <a href={whatsappLink(phone, waGreeting)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-[#25D366] text-white text-sm font-semibold hover:bg-[#1eb858] transition shadow-sm min-h-11">
            <MessageCircle className="w-4 h-4" /> WhatsApp
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-slate-600 text-white text-sm font-semibold hover:bg-slate-700 transition shadow-sm min-h-11">
            <Mail className="w-4 h-4" /> Email
          </a>
        )}
        {canLog && (
          <button onClick={() => setShowLog(true)} className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-[#c9a24b] text-[#0b1a33] text-sm font-semibold hover:bg-[#e7c97a] transition shadow-sm min-h-11">
            📝 Log Call
          </button>
        )}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent(`open-sticky-${buyerId}`))}
          // Same pinned-contrast colours as the Lead view's Note button so a global
          // dark-mode rule can't hijack it (dark-navy ink on amber).
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-[#fcd34d] text-[#3a2c00] text-sm font-semibold hover:bg-[#fbbf24] transition shadow-sm min-h-11"
          title="Open private sticky note"
        >
          🗒 Note
        </button>
        {canLog && (
          <button onClick={quickVoiceNote} className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition shadow-sm min-h-11">
            <Mic className="w-4 h-4" /> Voice
          </button>
        )}
      </div>

      {/* Alternate number — render after the primary bar, only when both exist (parity). */}
      {phone && altPhone && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">📱 Alternate number</div>
          <div className="grid grid-cols-2 gap-1.5">
            <a href={telLink(altPhone)} className="flex items-center justify-center gap-1 py-2 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 min-h-10">
              <Phone className="w-3.5 h-3.5" /> Call alt
            </a>
            <a href={whatsappLink(altPhone, waGreeting)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 py-2 rounded-lg bg-[#25D366]/15 border border-[#25D366] text-[#0b6a35] text-xs font-semibold hover:bg-[#25D366]/25 min-h-10">
              <MessageCircle className="w-3.5 h-3.5" /> WA alt
            </a>
          </div>
        </div>
      )}

      {/* Log conversation modal — same bottom-sheet/centered-card pattern as the Lead view. */}
      {showLog && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowLog(false)}>
          <div className="bg-white dark:bg-slate-900 sm:rounded-xl rounded-t-2xl max-w-lg w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto safe-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold mb-3 text-lg dark:text-slate-100">Log conversation</div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Outcome *</label>
            <select value={outcomeKey} onChange={(e) => setOutcomeKey(e.target.value)} className="w-full mt-1 mb-3 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100">
              {LOG_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Remarks <span className="text-gray-400 font-normal">(what did the client say?)</span></label>
              {speechSupported && (
                <button type="button" onClick={toggleDictation} title={listening ? "Stop dictation" : "Tap to dictate remarks"}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition border ${listening ? "bg-red-50 border-red-300 text-red-600 animate-pulse" : "bg-red-50 border-red-200 text-red-500 hover:bg-red-100"}`}>
                  <Mic className="w-3.5 h-3.5" />{listening ? "Stop" : "Dictate"}
                </button>
              )}
            </div>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={4}
              placeholder="Be specific: client's concern, budget mentioned, next step agreed…"
              className="w-full mt-1 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-[13px] dark:bg-slate-800 dark:text-slate-100" />
            {err && <div className="text-xs text-red-600 mt-2 flex gap-1 items-center"><AlertCircle className="w-3 h-3" /> {err}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowLog(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={submitLog} disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
