"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Agent { id: string; name: string; }
interface Props { agents: Agent[]; meId: string; }

const SOURCES = ["LinkedIn","Naukri","Referral","Walk-in","Indeed","Internshala","Campus","WhatsApp","Other"];
const NOTICE  = ["Immediate","7 days","15 days","30 days","45 days","60 days","90 days","Serving Notice"];

export default function HRAddCandidateForm({ agents, meId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dupWarning, setDupWarning] = useState<{id:string;name:string}|null>(null);

  const [form, setForm] = useState({
    name:"", phone:"", altPhone:"", whatsappPhone:"", email:"",
    location:"", currentCompany:"", currentProfile:"", experience:"",
    currentSalary:"", expectedSalary:"", noticePeriod:"", source:"",
    remarks:"", tags:"", nextAction:"", nextActionDate:"",
    primaryOwnerId: meId, secondaryOwnerId:"",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setErr("Name is required."); return; }
    setBusy(true); setErr(null); setDupWarning(null);
    const res = await fetch("/api/hr/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const json = await res.json();
    setBusy(false);
    if (res.status === 409) { setDupWarning({ id: json.existingId, name: json.existingName }); return; }
    if (!res.ok) { setErr(json.error ?? "Failed to add candidate."); return; }
    router.push(`/hr/candidates/${json.candidate.id}`);
  }

  const inp = "w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1a33]/20 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100";
  const lbl = "block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1";

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      {dupWarning && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm">
          <div className="font-semibold text-amber-800">⚠ Duplicate found</div>
          <div className="text-amber-700 mt-1">
            A candidate named <b>{dupWarning.name}</b> with the same phone/email already exists.
          </div>
          <a href={`/hr/candidates/${dupWarning.id}`} className="text-blue-600 hover:underline text-xs mt-1 inline-block">
            Open existing profile →
          </a>
        </div>
      )}

      {/* Basic info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Name <span className="text-red-500">*</span></label>
          <input className={inp} value={form.name} onChange={set("name")} placeholder="Full name" required />
        </div>
        <div>
          <label className={lbl}>Phone</label>
          <input className={inp} value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" type="tel" />
        </div>
        <div>
          <label className={lbl}>Alt Phone</label>
          <input className={inp} value={form.altPhone} onChange={set("altPhone")} type="tel" />
        </div>
        <div>
          <label className={lbl}>WhatsApp</label>
          <input className={inp} value={form.whatsappPhone} onChange={set("whatsappPhone")} placeholder="If different from phone" type="tel" />
        </div>
        <div>
          <label className={lbl}>Email</label>
          <input className={inp} value={form.email} onChange={set("email")} type="email" placeholder="candidate@email.com" />
        </div>
        <div>
          <label className={lbl}>Location</label>
          <input className={inp} value={form.location} onChange={set("location")} placeholder="City" />
        </div>
      </div>

      {/* Experience */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={lbl}>Current Company</label>
          <input className={inp} value={form.currentCompany} onChange={set("currentCompany")} />
        </div>
        <div>
          <label className={lbl}>Current Profile / Role</label>
          <input className={inp} value={form.currentProfile} onChange={set("currentProfile")} placeholder="Sales Executive" />
        </div>
        <div>
          <label className={lbl}>Experience</label>
          <input className={inp} value={form.experience} onChange={set("experience")} placeholder="2 years" />
        </div>
        <div>
          <label className={lbl}>Current Salary (₹ /month)</label>
          <input className={inp} value={form.currentSalary} onChange={set("currentSalary")} type="number" placeholder="25000" />
        </div>
        <div>
          <label className={lbl}>Expected Salary (₹ /month)</label>
          <input className={inp} value={form.expectedSalary} onChange={set("expectedSalary")} type="number" placeholder="35000" />
        </div>
        <div>
          <label className={lbl}>Notice Period</label>
          <select className={inp} value={form.noticePeriod} onChange={set("noticePeriod")}>
            <option value="">— Select —</option>
            {NOTICE.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Source + owner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={lbl}>Source</label>
          <select className={inp} value={form.source} onChange={set("source")}>
            <option value="">— Select —</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Primary Owner</label>
          <select className={inp} value={form.primaryOwnerId} onChange={set("primaryOwnerId")}>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Secondary Owner (optional)</label>
          <select className={inp} value={form.secondaryOwnerId} onChange={set("secondaryOwnerId")}>
            <option value="">— None —</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {/* Next action */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Next Action</label>
          <input className={inp} value={form.nextAction} onChange={set("nextAction")} placeholder="Call to discuss salary" />
        </div>
        <div>
          <label className={lbl}>Next Action Date</label>
          <input className={inp} value={form.nextActionDate} onChange={set("nextActionDate")} type="datetime-local" />
        </div>
      </div>

      {/* Remarks */}
      <div>
        <label className={lbl}>Remarks</label>
        <textarea className={inp} value={form.remarks} onChange={set("remarks")} rows={3}
          placeholder="Notes about this candidate…" />
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={busy} className="btn btn-primary flex-1 justify-center">
          {busy ? "Adding…" : "Add Candidate"}
        </button>
        <a href="/hr/candidates" className="btn justify-center flex-none px-4 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-sm">
          Cancel
        </a>
      </div>
    </form>
  );
}
