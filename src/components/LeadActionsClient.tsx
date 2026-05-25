"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, Mail, AlertCircle, Sparkles } from "lucide-react";
import { whatsappLink, telLink } from "@/lib/phone";
import TemplatePickerButton from "./TemplatePickerButton";
import { nowISTLocalInput, fromISTLocalInput } from "@/lib/datetime";

const OUTCOMES = [
  { v: "CONNECTED",        label: "✅ Connected" },
  { v: "NOT_PICKED",       label: "📵 Not picked" },
  { v: "CALLBACK",         label: "🔁 Callback" },
  { v: "WRONG_NUMBER",     label: "🚫 Wrong number" },
  { v: "BUSY",             label: "⏳ Busy" },
  { v: "SWITCHED_OFF",     label: "📵 Switched off" },
  { v: "INTERESTED",       label: "🔥 Interested" },
  { v: "NOT_INTERESTED",   label: "❄ Not interested" },
];

interface Agent { id: string; name: string; role: string; team: string | null; avatarColor: string | null; }

interface Props {
  leadId: string;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  currentOwnerId: string | null;
  canReassign: boolean;
  agents: Agent[];
  phoneMasked: string | null;
  altPhoneMasked: string | null;
  leadName: string;
  agentName: string;
  acefoneEnabled?: boolean;        // server flag — hide button if false
  acefoneMappedForUser?: boolean;  // current user has acefoneAgentId set
}

// Phone helpers — now in src/lib/phone.ts. Kept as thin wrappers for compatibility.
const telUrl = (p: string | null) => telLink(p);
const waUrl = (p: string | null) => whatsappLink(p);

export default function LeadActionsClient({ leadId, phone, altPhone, email, currentOwnerId, canReassign, agents, phoneMasked, altPhoneMasked, leadName, agentName, acefoneEnabled, acefoneMappedForUser }: Props) {
  const waGreeting = `Hi ${leadName}, this is ${agentName} from White Collar Realty. I'll be your dedicated property advisor. May I know a convenient time to call you today?`;
  const waUrlWithDraft = (p: string | null) => whatsappLink(p, waGreeting);

  // Fire-and-forget — log every WhatsApp link click so admin sees it in the
  // lead timeline + the daily report counts it under "WhatsApp touches".
  function logWaClick(kind: "click" | "send", message?: string) {
    fetch("/api/whatsapp/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true, // survives even if the new tab steals focus
      body: JSON.stringify({ leadId, kind, message }),
    }).catch(() => {});
  }
  const router = useRouter();
  const [showCall, setShowCall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("CONNECTED");
  const [remarks, setRemarks] = useState("");
  const [duration, setDuration] = useState("");
  // When the agent picks "🔁 Callback" or "⏳ Busy", they need to schedule a
  // specific time to call back. This datetime-local input (IST, future-only)
  // posts to log-call → server sets Lead.followupDate, which triggers the
  // 10-min-before push from the pre-meeting cron and shows up on the morning
  // dashboard's "☎ N client callbacks today" tile.
  const [callbackAt, setCallbackAt] = useState("");
  const needsCallback = outcome === "CALLBACK" || outcome === "BUSY" || outcome === "SWITCHED_OFF" || outcome === "NOT_PICKED";
  const [err, setErr] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [acefoneBusy, setAcefoneBusy] = useState(false);
  const [acefoneMsg, setAcefoneMsg] = useState<string | null>(null);

  async function callViaAcefone() {
    if (acefoneBusy) return;
    setAcefoneBusy(true); setAcefoneMsg(null);
    try {
      const r = await fetch(`/api/acefone/click-to-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const j = await r.json();
      if (!r.ok) { setAcefoneMsg(j.error ?? "Failed"); return; }
      setAcefoneMsg(`📞 Your phone will ring in a few seconds. Answer it — the lead is then dialled automatically.`);
    } catch (e) {
      setAcefoneMsg(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setAcefoneBusy(false); }
  }

  async function submitCall() {
    setErr(null);
    if (remarks.trim().length < 3) { setErr("Please write what happened in the call (min 3 chars)."); return; }
    // Convert IST wall-clock callback time → ISO. Server picks it up and writes
    // Lead.followupDate so the pre-call reminder cron fires 10 min before.
    let callbackAtISO: string | undefined;
    if (needsCallback && callbackAt) {
      const d = fromISTLocalInput(callbackAt);
      if (!d) { setErr("Invalid callback time."); return; }
      if (d.getTime() <= Date.now()) {
        setErr("Callback time must be in the future (IST).");
        return;
      }
      callbackAtISO = d.toISOString();
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/log-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, remarks, durationSec: Number(duration) || 0, callbackAt: callbackAtISO }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed"); return; }
      setShowCall(false); setRemarks(""); setDuration(""); setCallbackAt("");
      router.refresh();
    } finally { setBusy(false); }
  }

  async function onReassign(userId: string) {
    if (!userId || userId === currentOwnerId) return;
    setAssignBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (r.ok) router.refresh();
    } finally { setAssignBusy(false); }
  }

  return (
    <>
      {/* Phone shown masked, but tap-to-call uses real number */}
      {phone && (
        <div className="text-sm text-gray-500 mt-1">
          📞 <code className="text-[#0b1a33]">{phoneMasked}</code>
          <span className="text-[10px] text-gray-400 ml-2">(real number used when you tap Call)</span>
        </div>
      )}
      {/* Alt-phone (second number from the MIS sheet). Same masking convention.
          Lalit's MIS often had two numbers per client comma-separated in one cell;
          the second one now stores here and gets its own Call + WhatsApp buttons. */}
      {altPhone && (
        <div className="text-sm text-gray-500 mt-1 flex flex-wrap items-center gap-2">
          <span>📱 alt: <code className="text-[#0b1a33]">{altPhoneMasked}</code></span>
          <a href={telUrl(altPhone)} className="text-[11px] px-2 py-1 rounded bg-emerald-50 border border-emerald-300 text-emerald-800 font-semibold hover:bg-emerald-100 min-h-9 inline-flex items-center gap-1">
            <Phone className="w-3 h-3" /> Call
          </a>
          <a
            href={waUrl(altPhone)}
            onClick={() => logWaClick("click")}
            target="_blank" rel="noopener noreferrer"
            className="text-[11px] px-2 py-1 rounded bg-[#25D366]/15 border border-[#25D366] text-[#0b6a35] font-semibold hover:bg-[#25D366]/25 min-h-9 inline-flex items-center gap-1"
          >
            <MessageCircle className="w-3 h-3" /> WhatsApp
          </a>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        {phone && (
          <a href={telUrl(phone)} className="flex flex-col items-center justify-center py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition shadow-sm">
            <Phone className="w-5 h-5 mb-1" /> Call
          </a>
        )}
        {/* TemplatePicker replaces the bare WA + Email buttons — opens a chooser so the agent picks a template, placeholders filled per-lead. */}
        <TemplatePickerButton lead={{ id: leadId, name: leadName, phone, email }} kind="WHATSAPP" />
        <TemplatePickerButton lead={{ id: leadId, name: leadName, phone, email }} kind="EMAIL" />
        <button onClick={() => setShowCall(true)} className="flex flex-col items-center justify-center py-3 rounded-xl bg-[#c9a24b] text-[#0b1a33] font-semibold hover:bg-[#e7c97a] transition shadow-sm">
          <span className="text-base mb-1">📝</span> Log Call
        </button>
      </div>
      {/* Lalit asked: "Send whatsapp with pre typed greeting — Here options should be
          there to select according to which template to choose from." The WhatsApp
          button above already opens a template picker (greetings, brochure, follow-up,
          etc., all with placeholders filled). Hint at it explicitly below so agents
          notice it's a chooser, not a single hardcoded greeting. */}
      {phone && (
        <div className="mt-2 text-[11px] text-gray-500 flex items-center justify-center gap-1.5 py-1.5">
          <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
          <span>Tap <b className="text-emerald-700">WhatsApp</b> above to pick a greeting / brochure / follow-up template</span>
        </div>
      )}

      {/* Acefone click-to-call — rings agent first, then dials lead. Hidden when not configured. */}
      {phone && acefoneEnabled && (
        <button
          onClick={callViaAcefone}
          disabled={acefoneBusy || !acefoneMappedForUser}
          title={acefoneMappedForUser ? "Acefone will call your phone, then connect the lead automatically" : "Ask admin to set your Acefone agent id in Team & Roles"}
          className="w-full flex items-center justify-center gap-2 mt-2 py-2 rounded-xl bg-[#0b1a33] text-white text-sm font-semibold hover:bg-[#0f2347] transition disabled:opacity-50 min-h-11"
        >
          <Phone className="w-4 h-4" />
          {acefoneBusy ? "Connecting…" : acefoneMappedForUser ? "📞 Call via Acefone (auto-record)" : "📞 Acefone — admin needs to map your agent id"}
        </button>
      )}
      {acefoneMsg && (
        <div className={`mt-2 text-xs p-2 rounded-lg ${acefoneMsg.startsWith("📞") ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>{acefoneMsg}</div>
      )}
      {canReassign && (
        <div className="mt-3 flex items-center gap-2 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
          <span className="text-xs text-gray-500 font-semibold">REASSIGN TO:</span>
          <select
            defaultValue={currentOwnerId ?? ""}
            disabled={assignBusy}
            onChange={(e) => onReassign(e.target.value)}
            className="text-sm border-0 bg-transparent outline-none flex-1"
          >
            <option value="">— pick agent —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>
            ))}
          </select>
        </div>
      )}

      {showCall && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCall(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold mb-3 text-lg">Log Call</div>
            <label className="text-xs font-semibold text-gray-600">Outcome *</label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
              {OUTCOMES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
            <label className="text-xs font-semibold text-gray-600">Duration (seconds, optional)</label>
            <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 240" className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm" />

            {/* Callback scheduler — shows only when the outcome implies "ring back later".
                Required when the client asked for a specific time. Saved as
                Lead.followupDate so the pre-meeting cron sends a 10-min-before push
                and it shows in the morning dashboard's callback count. */}
            {needsCallback && (
              <div className="mb-3 p-3 rounded-lg border-2 border-amber-300 bg-amber-50">
                <label className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                  ⏰ When should you call back? <span className="text-[10px] text-amber-700 font-normal">(IST · required for scheduled callback)</span>
                </label>
                <input
                  type="datetime-local"
                  value={callbackAt}
                  onChange={(e) => setCallbackAt(e.target.value)}
                  min={nowISTLocalInput()}
                  className="w-full mt-1.5 border border-amber-400 rounded-lg px-3 py-2 text-sm bg-white min-h-11"
                />
                <p className="text-[10px] text-amber-800 mt-1">
                  You&apos;ll get a push notification 10 min before this time, and it will appear in your morning briefing.
                </p>
              </div>
            )}

            <label className="text-xs font-semibold text-gray-600">Remarks * <span className="text-gray-400 font-normal">(what did the client say?)</span></label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={4}
              placeholder="Be specific: client's exact concern, budget mentioned, next step agreed…"
              className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm font-mono text-[13px]" />
            {err && <div className="text-xs text-red-600 mt-2 flex gap-1 items-center"><AlertCircle className="w-3 h-3" /> {err}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCall(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={submitCall} disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save Call"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
