"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, Mail, AlertCircle, Sparkles } from "lucide-react";

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
  email: string | null;
  currentOwnerId: string | null;
  canReassign: boolean;
  agents: Agent[];
  phoneMasked: string | null;
  leadName: string;
  agentName: string;
}

/** Build a tel: URL — strips spaces but keeps + and digits */
function telUrl(p: string | null) { return p ? `tel:${p.replace(/[^\d+]/g, "")}` : ""; }
function waUrl(p: string | null) {
  if (!p) return "";
  const digits = p.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

export default function LeadActionsClient({ leadId, phone, email, currentOwnerId, canReassign, agents, phoneMasked, leadName, agentName }: Props) {
  const waGreeting = `Hi ${leadName}, this is ${agentName} from White Collar Realty. I'll be your dedicated property advisor. May I know a convenient time to call you today?`;
  const waUrlWithDraft = (p: string | null) => p ? `https://wa.me/${p.replace(/\D/g, "")}?text=${encodeURIComponent(waGreeting)}` : "";
  const router = useRouter();
  const [showCall, setShowCall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("CONNECTED");
  const [remarks, setRemarks] = useState("");
  const [duration, setDuration] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);

  async function submitCall() {
    setErr(null);
    if (remarks.trim().length < 3) { setErr("Please write what happened in the call (min 3 chars)."); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/log-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, remarks, durationSec: Number(duration) || 0 }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed"); return; }
      setShowCall(false); setRemarks(""); setDuration("");
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        {phone && (
          <a href={telUrl(phone)} className="flex flex-col items-center justify-center py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition shadow-sm">
            <Phone className="w-5 h-5 mb-1" /> Call
          </a>
        )}
        {phone && (
          <a href={waUrl(phone)} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center justify-center py-3 rounded-xl bg-[#25D366] text-white font-semibold hover:opacity-90 transition shadow-sm">
            <MessageCircle className="w-5 h-5 mb-1" /> WhatsApp
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="flex flex-col items-center justify-center py-3 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 transition shadow-sm">
            <Mail className="w-5 h-5 mb-1" /> Email
          </a>
        )}
        <button onClick={() => setShowCall(true)} className="flex flex-col items-center justify-center py-3 rounded-xl bg-[#c9a24b] text-[#0b1a33] font-semibold hover:bg-[#e7c97a] transition shadow-sm">
          <span className="text-base mb-1">📝</span> Log Call
        </button>
      </div>
      {phone && (
        <a href={waUrlWithDraft(phone)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 mt-2 py-2 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold hover:bg-emerald-100 transition">
          <Sparkles className="w-4 h-4" /> Send WhatsApp with pre-typed greeting
        </a>
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
