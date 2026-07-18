"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Phone, AlertCircle, Mic } from "lucide-react";
import { whatsappLink, telLink, hasDialableNumber } from "@/lib/phone";
// Buyer dials land in the SAME central CallLog as lead dials (buyerId-linked).
import { useDialBeacon } from "@/components/useDialBeacon";
import { ActionButton } from "@/components/actions/ActionButton";
import { backdropProps } from "@/lib/useDismiss";
import { ACTION_ROW } from "@/lib/detailLayout";

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
  const dial = useDialBeacon();
  const waGreeting = `Hi ${clientName}, this is ${agentName} from White Collar Realty regarding your property. May I know a convenient time to connect?`;

  const [showLog, setShowLog] = useState(false);
  const [outcomeKey, setOutcomeKey] = useState("CALL_CONNECTED");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // When the log modal was opened via the Voice button, the saved activity is a
  // VOICE_NOTE (🎤), not a plain NOTE — audit fix 2026-06-27.
  const [voiceMode, setVoiceMode] = useState(false);

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
    // A note dictated via the Voice button is logged as VOICE_NOTE (🎤), not NOTE.
    const ok = await logActivity(voiceMode ? "VOICE_NOTE" : opt.type, remarks.trim() || null);
    if (ok) {
      setShowLog(false); setRemarks(""); setOutcomeKey("CALL_CONNECTED"); setVoiceMode(false);
      router.refresh();
    }
  }

  async function quickVoiceNote() {
    // Tapping Voice opens the Log modal pre-set to a VOICE note with dictation —
    // mirrors the Lead voice-note flow (record → save). We reuse the same modal.
    setVoiceMode(true);
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
      {/* Primary action bar — EXACT same fluid flex-wrap primitive as the Lead
          view's LeadActionsClient (ACTION_ROW token: flex-wrap · [&>*]:grow
          [&>*]:basis-28) so the buttons size uniformly and wrap gracefully
          instead of locking into a rigid grid. Buttons themselves come from the
          central Action Design System (Call/WhatsApp/Email/Log Call/Note) so
          colour+icon match the Lead view exactly; Voice is a buyer-specific
          dictation action. All hrefs/handlers/permissions (canLog) unchanged. */}
      <div className={ACTION_ROW}>
        {phone && (
          <ActionButton action="call" href={telLink(phone)} onClick={dial({ buyerId, phone })} />
        )}
        {phone && (
          <ActionButton action="whatsapp" href={whatsappLink(phone, waGreeting)} external />
        )}
        {email && (
          <ActionButton action="email" href={`mailto:${email}`} />
        )}
        {canLog && (
          <ActionButton action="logCall" onClick={() => { setVoiceMode(false); setShowLog(true); }} />
        )}
        <ActionButton
          action="note"
          onClick={() => window.dispatchEvent(new CustomEvent(`open-sticky-${buyerId}`))}
        />
        {canLog && (
          <button onClick={quickVoiceNote} className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition shadow-sm min-h-11">
            <Mic className="w-4 h-4" /> Voice
          </button>
        )}
      </div>

      {/* Alternate number — render after the primary bar, only when both are
          genuinely dialable (parity with LeadActionsClient). hasDialableNumber()
          rejects a blank / whitespace / bare-dial-prefix alt so the Call-alt /
          WhatsApp-alt buttons never show without a real second number. */}
      {hasDialableNumber(phone) && hasDialableNumber(altPhone) && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">📱 Alternate number</div>
          <div className="grid grid-cols-2 gap-1.5 [&>*]:w-full">
            <ActionButton action="call" size="sm" href={telLink(altPhone)} label="Call alt" onClick={dial({ buyerId, phone: altPhone })} />
            <ActionButton action="whatsapp" size="sm" href={whatsappLink(altPhone, waGreeting)} label="WA alt" external />
          </div>
        </div>
      )}

      {/* Log conversation modal — same bottom-sheet/centered-card pattern as the Lead view. */}
      {showLog && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4" {...backdropProps(() => setShowLog(false))}>
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
