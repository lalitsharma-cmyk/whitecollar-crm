"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, AlertCircle, X } from "lucide-react";
import { fromISTLocalInput } from "@/lib/datetime";
import CRMDatePicker from "./CRMDatePicker";

type AdvancedType = "EXPO_MEETING" | "HOME_VISIT" | "DUBAI_SITE_VISIT";

interface Props {
  leadId: string;
  team: "Dubai" | "India" | null;
  /** Admin-set INR per kilometre rate, used to live-preview the reimbursement. */
  travelRatePerKm: number;
}

/**
 * Specialised logger for the workflows the generic meeting form doesn't cover:
 *
 *   Dubai team:
 *     - 🎪 Expo meeting  → city/hotel/developer/contact/agent-attended
 *     - 🚗 Dubai site visit → developer salesperson, cab scheduled, decision in office
 *   India team:
 *     - 🏠 Home visit    → distance km (auto-calculates reimbursement)
 *     - 🚗 Site visit    → also captures distance + reimbursement
 *
 * Posts to /api/leads/[id]/advanced-activity.
 */
export default function AdvancedActivityLogger({ leadId, team, travelRatePerKm }: Props) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [type, setType] = useState<AdvancedType>(team === "India" ? "HOME_VISIT" : "EXPO_MEETING");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    when: "",
    notes: "",
    expoCity: "",
    expoHotel: "",
    expoDeveloper: "",
    expoDeveloperContact: "",
    expoAgentAttended: false,
    dubaiDeveloperSalesperson: "",
    cabScheduled: false,
    decisionInOffice: false,
    distanceKm: "",
  });
  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const km = Number(form.distanceKm) || 0;
  const reimbursementPreview = km > 0 ? km * travelRatePerKm : 0;

  async function submit() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/advanced-activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          // IST wall-clock → unambiguous ISO. Empty = now.
          when: form.when ? (fromISTLocalInput(form.when)?.toISOString() ?? new Date().toISOString()) : new Date().toISOString(),
          notes: form.notes,
          ...(type === "EXPO_MEETING" && {
            expoCity: form.expoCity,
            expoHotel: form.expoHotel,
            expoDeveloper: form.expoDeveloper,
            expoDeveloperContact: form.expoDeveloperContact,
            expoAgentAttended: form.expoAgentAttended,
          }),
          ...(type === "DUBAI_SITE_VISIT" && {
            dubaiDeveloperSalesperson: form.dubaiDeveloperSalesperson,
            cabScheduled: form.cabScheduled,
            decisionInOffice: form.decisionInOffice,
          }),
          ...(type === "HOME_VISIT" && { distanceKm: km || undefined }),
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed"); return; }
      setShow(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => setShow(true)} className="btn btn-ghost text-xs w-full justify-center">
        <Calendar className="w-3 h-3" />
        {team === "India" ? "🏠 Home/Site visit (with km)" : "🎪 Expo / Dubai site visit"}
      </button>

      {show && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setShow(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg">Log specialised activity</div>
              <button onClick={() => setShow(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>

            <label className="text-xs font-semibold text-gray-600">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as AdvancedType)} className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
              {team === "Dubai" ? (
                <>
                  <option value="EXPO_MEETING">🎪 Expo meeting (developer expo in IN city)</option>
                  <option value="DUBAI_SITE_VISIT">🚗 Dubai site visit (with developer's sales — no travel expense)</option>
                </>
              ) : (
                <option value="HOME_VISIT">🏠 Home visit (with distance reimbursement)</option>
              )}
            </select>

            <label className="text-xs font-semibold text-gray-600 block mb-1.5">When</label>
            <div className="mb-3">
              <CRMDatePicker
                value={form.when}
                onChange={(v) => update("when", v)}
                withTime
                futureOnly
                triggerStyle="input"
                placeholder="Pick date &amp; time"
                title="When"
              />
            </div>

            {type === "EXPO_MEETING" && (
              <>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">City</label>
                    <input value={form.expoCity} onChange={(e) => update("expoCity", e.target.value)} placeholder="Gurgaon / Delhi / Mumbai" className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Hotel / venue</label>
                    <input value={form.expoHotel} onChange={(e) => update("expoHotel", e.target.value)} placeholder="Leela Ambience" className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Developer hosting</label>
                    <input value={form.expoDeveloper} onChange={(e) => update("expoDeveloper", e.target.value)} placeholder="Emaar / Sobha / DLF" className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Developer's contact</label>
                    <input value={form.expoDeveloperContact} onChange={(e) => update("expoDeveloperContact", e.target.value)} placeholder="Rajesh @ Emaar" className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold mb-3 cursor-pointer">
                  <input type="checkbox" checked={form.expoAgentAttended} onChange={(e) => update("expoAgentAttended", e.target.checked)} />
                  Our agent travelled + attended in person?
                </label>
              </>
            )}

            {type === "DUBAI_SITE_VISIT" && team === "Dubai" && (
              <>
                <label className="text-xs font-semibold text-gray-600">Developer's salesperson name</label>
                <input value={form.dubaiDeveloperSalesperson} onChange={(e) => update("dubaiDeveloperSalesperson", e.target.value)} placeholder="Ahmed @ Sobha Dubai" className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm" />
                <label className="flex items-center gap-2 text-sm font-semibold mb-2 cursor-pointer">
                  <input type="checkbox" checked={form.cabScheduled} onChange={(e) => update("cabScheduled", e.target.checked)} />
                  Cab scheduled for client?
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold mb-3 cursor-pointer">
                  <input type="checkbox" checked={form.decisionInOffice} onChange={(e) => update("decisionInOffice", e.target.checked)} />
                  Decision made in developer's office?
                </label>
              </>
            )}

            {(type === "HOME_VISIT" || (type === "DUBAI_SITE_VISIT" && team === "India")) && (
              <>
                <label className="text-xs font-semibold text-gray-600">Distance travelled (km)</label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  inputMode="numeric"
                  value={form.distanceKm}
                  onChange={(e) => update("distanceKm", e.target.value.replace(/[^\d]/g, ""))}
                  onKeyDown={(e) => { if (["-", "e", "E", "+", "."].includes(e.key)) e.preventDefault(); }}
                  onBlur={(e) => { const n = Number(e.target.value); if (!isFinite(n) || n < 0) update("distanceKm", ""); }}
                  placeholder="e.g. 32"
                  className="w-full mt-1 mb-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm min-h-11"
                />
                <div className="text-[11px] text-gray-600 mb-3">
                  Reimbursement: <b>₹{reimbursementPreview.toFixed(0)}</b> ({km.toFixed(1)} km × ₹{travelRatePerKm}/km).
                  Rate is set by admin in /settings.
                </div>
              </>
            )}

            <label className="text-xs font-semibold text-gray-600">What happened</label>
            <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={3} placeholder="Outcome, objections, next step…" className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm font-mono text-[13px]" />

            {err && <div className="text-[11px] text-red-700 mt-2 flex gap-1"><AlertCircle className="w-3 h-3 mt-0.5" /> {err}</div>}

            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShow(false)} disabled={busy} className="btn btn-ghost text-sm">Cancel</button>
              <button onClick={submit} disabled={busy} className="btn btn-primary text-sm">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
