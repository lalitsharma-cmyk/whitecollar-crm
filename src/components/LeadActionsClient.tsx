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

      <div className="flex flex-wrap gap-2 mt-3">
        {phone && (
          <a href={telUrl(phone)} className="btn btn-ghost"><Phone className="w-[16px] h-[16px]" /> Call</a>
        )}
        {phone && (
          <>
            <a href={waUrl(phone)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost"><MessageCircle className="w-[16px] h-[16px]" /> WhatsApp</a>
            <a href={waUrlWithDraft(phone)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" title="Opens WhatsApp with a pre-typed greeting — you just tap Send"><Sparkles className="w-[16px] h-[16px]" /> WA Greeting</a>
          </>
        )}
        {email && (
          <a href={`mailto:${email}`} className="btn btn-ghost"><Mail className="w-[16px] h-[16px]" /> Email</a>
        )}
        <button onClick={() => setShowCall(true)} className="btn btn-gold">📝 Log Call</button>
        {canReassign && (
          <div className="inline-flex items-center gap-2 border border-[#e5e7eb] rounded-lg px-2 py-1 text-sm">
            <span className="text-xs text-gray-500">Assign to:</span>
            <select
              defaultValue={currentOwnerId ?? ""}
              disabled={assignBusy}
              onChange={(e) => onReassign(e.target.value)}
              className="text-sm border-0 bg-transparent outline-none"
            >
              <option value="">— pick —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>
              ))}
            </select>
          </div>
        )}
      </div>

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
