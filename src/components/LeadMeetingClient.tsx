"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fromISTLocalInput } from "@/lib/datetime";
import CRMDatePicker from "./CRMDatePicker";
import { showXpToast } from "./XPToast";
import { showCelebration } from "@/components/DealCelebration";

interface Counts {
  officeMeetings: { count: number; lastAt: Date | null };
  virtualMeetings: { count: number; lastAt: Date | null };
  siteVisits: { count: number; lastAt: Date | null };
}

const TYPES = [
  { v: "OFFICE_MEETING",  label: "🏢 Office Meeting" },
  { v: "VIRTUAL_MEETING", label: "💻 Virtual Meeting" },
  { v: "SITE_VISIT",      label: "🚗 Site Visit" },
];

function ago(d: Date | null) {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function LeadMeetingClient({ leadId, counts, leadName }: { leadId: string; counts: Counts; leadName?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("OFFICE_MEETING");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (remarks.trim().length < 3) { setErr("Remarks required (min 3 chars)."); return; }
    // Convert IST wall-clock input → unambiguous ISO before sending. Empty input
    // = log as "now" (handled server-side).
    const whenISO = when ? fromISTLocalInput(when)?.toISOString() ?? "" : "";
    setErr(null); setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, when: whenISO, durationMin: Number(duration) || 0, remarks }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed"); return; }
      setOpen(false); setWhen(""); setDuration(""); setRemarks("");
      if (j.awardedXp) {
        showXpToast({
          amount: j.awardedXp.amount,
          label: j.awardedXp.label,
          leveledUp: !!j.awardedXp.leveledUp,
          newLevel: j.awardedXp.newLevel,
        });
      }
      showCelebration({ kind: "meeting_booked", message: `Meeting booked — ${leadName ?? "client"}` });
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">Meetings & Site Visits</div>
        <button onClick={() => setOpen(true)} className="text-xs btn btn-ghost py-1">+ Log Meeting</button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="p-2 border border-[#e5e7eb] rounded-lg">
          <div className="text-[11px] text-gray-500">🏢 Office</div>
          <div className="text-xl font-bold">{counts.officeMeetings.count}</div>
          <div className="text-[10px] text-gray-500">last {ago(counts.officeMeetings.lastAt)}</div>
        </div>
        <div className="p-2 border border-[#e5e7eb] rounded-lg">
          <div className="text-[11px] text-gray-500">🚗 Site Visit</div>
          <div className="text-xl font-bold">{counts.siteVisits.count}</div>
          <div className="text-[10px] text-gray-500">last {ago(counts.siteVisits.lastAt)}</div>
        </div>
        <div className="p-2 border border-[#e5e7eb] rounded-lg">
          <div className="text-[11px] text-gray-500">💻 Virtual</div>
          <div className="text-xl font-bold">{counts.virtualMeetings.count}</div>
          <div className="text-[10px] text-gray-500">last {ago(counts.virtualMeetings.lastAt)}</div>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold mb-3 text-lg">Log Meeting / Site Visit</div>
            <label className="text-xs font-semibold text-gray-600">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">When (leave empty to log as now)</label>
            <div className="mb-3">
              <CRMDatePicker
                value={when}
                onChange={setWhen}
                withTime
                triggerStyle="input"
                placeholder="Leave empty — defaults to now"
                title="When did this happen?"
              />
            </div>
            <label className="text-xs font-semibold text-gray-600">Duration (minutes, optional)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => { if (["-", "e", "E", "+", "."].includes(e.key)) e.preventDefault(); }}
              onBlur={(e) => { const n = Number(e.target.value); if (!isFinite(n) || n < 0) setDuration(""); }}
              min={0}
              step={1}
              inputMode="numeric"
              placeholder="e.g. 45"
              className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm min-h-11"
            />
            <label className="text-xs font-semibold text-gray-600">What happened? *</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={4}
              placeholder="What did client say? Which projects did you discuss? What's the next step?"
              className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm font-mono text-[13px]" />
            {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
