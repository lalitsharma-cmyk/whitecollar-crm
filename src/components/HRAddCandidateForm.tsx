"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Agent { id: string; name: string; }
interface Props { agents: Agent[]; meId: string; }
interface DupMatch { id: string; name: string; phone: string | null; whatsappPhone: string | null; email: string | null; status: string; }

const POSITIONS = ["Sales Executive", "BDE", "BDM", "Team Leader", "Manager", "HR", "Marketing", "Other"];
const SOURCES   = ["Naukri", "Indeed", "Referral", "Walk-in", "LinkedIn", "Database", "Consultant", "Email", "Whatsapp", "Other"];
const NOTICE    = ["Immediate", "7 days", "15 days", "30 days", "45 days", "60 days", "90 days", "Serving Notice"];

const ACTIVE_STATUSES: [string, string][] = [
  ["NEW", "New"], ["NOT_CALLED", "Not Called By HR"], ["PIPELINE", "Pipeline"],
  ["VIRTUAL_INTERVIEW_SCHEDULED", "Virtual Interview Scheduled"], ["HR_INTERVIEW_COMPLETED", "HR Interview Completed"],
  ["FINAL_INTERVIEW_SCHEDULED", "Final Interview Scheduled"], ["FINAL_INTERVIEW_COMPLETED", "Final Interview Completed"],
  ["SHORTLISTED", "Shortlisted"], ["OFFER_RELEASED", "Offer Released"], ["JOINED", "Joined"], ["HOLD", "Hold"],
];
const CLOSED_STATUSES: [string, string][] = [
  ["NOT_INTERESTED", "Not Interested"], ["NOT_SUITABLE", "Not Suitable"], ["HIGH_SALARY", "High Salary"],
  ["OTHER_PROFILE", "Other Profile"], ["REJECTED", "Rejected"], ["OFFER_DECLINED", "Offer Declined"],
  ["WRONG_NUMBER", "Wrong Number"], ["SWITCH_OFF", "Switch Off"], ["NEVER_RESPONSE", "Never Response"],
  ["NOT_RESPONDING", "Not Responding"],
];
const CLOSED_SET = new Set(CLOSED_STATUSES.map(([k]) => k));

const FOLLOWUP_TYPES: [string, string][] = [
  ["CALL_BACK", "Call Back"], ["INTERVIEW_CONFIRMATION", "Interview Confirmation"], ["REMINDER", "Reminder"],
  ["WHATSAPP_FOLLOWUP", "WhatsApp Follow-Up"], ["EMAIL_FOLLOWUP", "Email Follow-Up"], ["SALARY_DISCUSSION", "Salary Discussion"],
  ["OFFER_DISCUSSION", "Offer Discussion"], ["JOINING_FOLLOWUP", "Joining Follow-Up"], ["NO_SHOW_RECOVERY", "No Show Recovery"],
  ["CUSTOM", "Custom"],
];

export default function HRAddCandidateForm({ agents, meId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [dupBlock, setDupBlock] = useState<{ id: string; name: string } | null>(null);
  const [dupMatches, setDupMatches] = useState<DupMatch[]>([]);

  const [form, setForm] = useState({
    name: "", phone: "", whatsappPhone: "", email: "",
    city: "", location: "",
    positionApplied: "", source: "", experience: "", realEstateExperience: "",
    currentCompany: "", currentProfile: "", currentSalary: "", expectedSalary: "", noticePeriod: "",
    primaryOwnerId: meId, secondaryOwnerId: "",
    status: "NEW", nextAction: "", followUpType: "CALL_BACK",
    remarks: "",
  });
  const [followDate, setFollowDate] = useState("");
  const [followTime, setFollowTime] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const isClosed = CLOSED_SET.has(form.status);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  // Live duplicate lookup as mobile / WhatsApp / email are filled.
  useEffect(() => {
    const { phone, whatsappPhone, email } = form;
    if (!phone && !whatsappPhone && !email) { setDupMatches([]); return; }
    const t = setTimeout(async () => {
      const qs = new URLSearchParams();
      if (phone) qs.set("phone", phone);
      if (whatsappPhone) qs.set("whatsapp", whatsappPhone);
      if (email) qs.set("email", email);
      try {
        const res = await fetch(`/api/hr/candidates/check-duplicate?${qs.toString()}`);
        const json = await res.json();
        setDupMatches(Array.isArray(json.matches) ? json.matches : []);
      } catch { /* ignore transient errors */ }
    }, 450);
    return () => clearTimeout(t);
  }, [form.phone, form.whatsappPhone, form.email]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles(prev => [...prev, ...Array.from(list)]);
  }

  async function submit(mode: "save" | "interview" | "followup") {
    setErr(null); setDupBlock(null);
    if (!form.name.trim()) { setErr("Candidate name is required."); return; }
    if (!form.status) { setErr("Status is required."); return; }
    if (!isClosed && (!form.nextAction.trim() || !followDate || !followTime)) {
      setErr("Next action, follow-up date & time are required for active candidates.");
      return;
    }
    const nextActionDate = followDate && followTime ? `${followDate}T${followTime}` : "";

    setBusy(true);
    let res: Response, json: { candidate?: { id: string }; existingId?: string; existingName?: string; error?: string };
    try {
      res = await fetch("/api/hr/candidates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, nextActionDate }),
      });
      json = await res.json();
    } catch { setBusy(false); setErr("Network error — please try again."); return; }

    if (res.status === 409) { setBusy(false); setDupBlock({ id: json.existingId!, name: json.existingName! }); return; }
    if (!res.ok || !json.candidate) { setBusy(false); setErr(json.error ?? "Failed to add candidate."); return; }

    const id = json.candidate.id;

    // Attach any resumes to the freshly-created candidate.
    if (files.length) {
      setUploading(true);
      for (const f of files) {
        const fd = new FormData(); fd.append("file", f);
        try { await fetch(`/api/hr/candidates/${id}/resume`, { method: "POST", body: fd }); } catch { /* keep going */ }
      }
      setUploading(false);
    }

    const dest = mode === "interview" ? `/hr/candidates/${id}?do=interview`
      : mode === "followup" ? `/hr/candidates/${id}?do=followup`
        : `/hr/candidates/${id}`;
    router.push(dest);
  }

  const inp = "w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1a33]/20 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100";
  const lbl = "block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1";
  const section = "text-[11px] font-bold uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-slate-700 pb-1.5 mb-3";

  const showDupWarning = dupBlock || dupMatches.length > 0;

  return (
    <form onSubmit={e => { e.preventDefault(); submit("save"); }} className="card p-5 space-y-6">
      {/* Duplicate warning (live + hard block) */}
      {showDupWarning && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm dark:bg-amber-900/20 dark:border-amber-700">
          <div className="font-semibold text-amber-800 dark:text-amber-300">
            {dupBlock ? "⚠ This candidate already exists" : "⚠ Possible duplicate"}
          </div>
          {dupBlock ? (
            <div className="text-amber-700 dark:text-amber-200 mt-1">
              <b>{dupBlock.name}</b> already has a profile with the same mobile / WhatsApp / email.{" "}
              <a href={`/hr/candidates/${dupBlock.id}`} className="text-blue-600 hover:underline font-medium">Open existing profile →</a>
            </div>
          ) : (
            <div className="text-amber-700 dark:text-amber-200 mt-1 space-y-0.5">
              {dupMatches.map(m => (
                <div key={m.id}>
                  <a href={`/hr/candidates/${m.id}`} className="text-blue-600 hover:underline font-medium">{m.name}</a>
                  {m.phone && <span className="text-amber-600"> · {m.phone}</span>}
                  <span className="text-[11px] text-amber-500"> · {m.status.replace(/_/g, " ").toLowerCase()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Essentials ── */}
      <div>
        <div className={section}>Candidate</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={lbl}>Candidate Name <span className="text-red-500">*</span></label>
            <input className={inp} value={form.name} onChange={set("name")} placeholder="Full name" required />
          </div>
          <div>
            <label className={lbl}>Mobile Number</label>
            <input className={inp} value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" type="tel" />
          </div>
          <div>
            <label className={lbl}>WhatsApp Number</label>
            <input className={inp} value={form.whatsappPhone} onChange={set("whatsappPhone")} placeholder="If different from mobile" type="tel" />
          </div>
          <div>
            <label className={lbl}>Position Applied For</label>
            <select className={inp} value={form.positionApplied} onChange={set("positionApplied")}>
              <option value="">— Select —</option>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Primary Owner</label>
            <select className={inp} value={form.primaryOwnerId} onChange={set("primaryOwnerId")}>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Follow-up (core — mandatory for active candidates) ── */}
      <div>
        <div className={section}>Status &amp; Next Action</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Current Status <span className="text-red-500">*</span></label>
            <select className={inp} value={form.status} onChange={set("status")} required>
              <optgroup label="Active">
                {ACTIVE_STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </optgroup>
              <optgroup label="Closed">
                {CLOSED_STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </optgroup>
            </select>
          </div>
          <div>
            <label className={lbl}>Next Action {!isClosed && <span className="text-red-500">*</span>}</label>
            <input className={inp} value={form.nextAction} onChange={set("nextAction")} placeholder="e.g. Call to discuss salary & notice" required={!isClosed} />
          </div>
          <div>
            <label className={lbl}>Next Follow-up Date {!isClosed && <span className="text-red-500">*</span>}</label>
            <input className={inp} type="date" value={followDate} onChange={e => setFollowDate(e.target.value)} required={!isClosed} />
          </div>
          <div>
            <label className={lbl}>Next Follow-up Time {!isClosed && <span className="text-red-500">*</span>}</label>
            <input className={inp} type="time" value={followTime} onChange={e => setFollowTime(e.target.value)} required={!isClosed} />
          </div>
        </div>
        {!isClosed && (
          <p className="text-[11px] text-gray-400 mt-1.5">No active candidate is saved without a next action and follow-up time.</p>
        )}
      </div>

      {/* ── More Details (collapsible — reduces data-entry burden) ── */}
      <div>
        <button type="button" onClick={() => setShowMore(s => !s)}
          className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 hover:text-gray-700 dark:text-slate-400 border border-dashed border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 transition">
          <span>{showMore ? "▾" : "▸"} More Details{showMore ? "" : " — email, city, experience, salary, company…"}</span>
          <span className="text-[10px] text-gray-400">optional</span>
        </button>

        {showMore && (
          <div className="mt-4 space-y-5">
            <div>
              <div className={section}>Contact &amp; Location</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Email</label>
                  <input className={inp} value={form.email} onChange={set("email")} type="email" placeholder="candidate@email.com" />
                </div>
                <div>
                  <label className={lbl}>Source</label>
                  <select className={inp} value={form.source} onChange={set("source")}>
                    <option value="">— Select —</option>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>City</label>
                  <input className={inp} value={form.city} onChange={set("city")} placeholder="Home city" />
                </div>
                <div>
                  <label className={lbl}>Current Location</label>
                  <input className={inp} value={form.location} onChange={set("location")} placeholder="Where based now" />
                </div>
              </div>
            </div>

            <div>
              <div className={section}>Experience &amp; Compensation</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Total Experience</label>
                  <input className={inp} value={form.experience} onChange={set("experience")} placeholder="e.g. 3 years" />
                </div>
                <div>
                  <label className={lbl}>Real Estate Experience</label>
                  <input className={inp} value={form.realEstateExperience} onChange={set("realEstateExperience")} placeholder="e.g. 1 year" />
                </div>
                <div>
                  <label className={lbl}>Current Company</label>
                  <input className={inp} value={form.currentCompany} onChange={set("currentCompany")} />
                </div>
                <div>
                  <label className={lbl}>Current Designation</label>
                  <input className={inp} value={form.currentProfile} onChange={set("currentProfile")} placeholder="Sales Executive" />
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
            </div>

            <div>
              <div className={section}>Ownership &amp; Notes</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Secondary Owner</label>
                  <select className={inp} value={form.secondaryOwnerId} onChange={set("secondaryOwnerId")}>
                    <option value="">— None —</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Follow-up Type</label>
                  <select className={inp} value={form.followUpType} onChange={set("followUpType")}>
                    {FOLLOWUP_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={lbl}>Initial HR Notes</label>
                  <textarea className={inp} value={form.remarks} onChange={set("remarks")} rows={3} placeholder="First impressions, screening notes, anything relevant…" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Resume ── */}
      <div>
        <div className={section}>Resume</div>
        <label className="block border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl p-4 text-center cursor-pointer hover:border-[#1a2e4a] transition">
          <input
            type="file" multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*"
            onChange={e => { addFiles(e.target.files); e.target.value = ""; }}
            className="hidden"
          />
          <div className="text-2xl mb-1">📎</div>
          <div className="text-sm text-gray-500">
            Upload resume — PDF, image, or phone photo · <b className="text-[#1a2e4a] dark:text-blue-400">click to browse</b>
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">You can add multiple files; the newest is marked active.</div>
        </label>
        {files.length > 0 && (
          <div className="mt-2 space-y-1">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-slate-800 rounded-lg px-3 py-1.5">
                <span className="shrink-0">{f.type.startsWith("image/") ? "🖼️" : "📄"}</span>
                <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-slate-200">{f.name}</span>
                <span className="text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                  className="text-red-500 hover:text-red-700 shrink-0">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 dark:bg-red-900/20 dark:border-red-700">{err}</div>}

      {/* ── Quick actions ── */}
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <button type="button" disabled={busy} onClick={() => submit("save")}
          className="btn btn-primary flex-1 justify-center">
          {busy ? (uploading ? "Uploading resume…" : "Saving…") : "Save"}
        </button>
        <button type="button" disabled={busy} onClick={() => submit("interview")}
          className="btn justify-center flex-1 border border-purple-300 text-purple-700 hover:bg-purple-50 rounded-lg text-sm dark:border-purple-700 dark:text-purple-300">
          🎯 Save &amp; Schedule Interview
        </button>
        <button type="button" disabled={busy} onClick={() => submit("followup")}
          className="btn justify-center flex-1 border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg text-sm dark:border-amber-700 dark:text-amber-300">
          📅 Save &amp; Add Follow-up
        </button>
        <a href="/hr/candidates" className="btn justify-center flex-none px-4 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-sm dark:border-slate-600 dark:text-slate-300">
          Cancel
        </a>
      </div>
    </form>
  );
}
