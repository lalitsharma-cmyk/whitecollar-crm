"use client";
import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import HRResumeUploadWidget from "@/components/HRResumeUploadWidget";
import HRCandidateVoice from "@/components/HRCandidateVoice";
import { ACTIVE_STATUS_DEFS, CLOSED_STATUS_DEFS, statusColor, statusLabel, displayStatus } from "@/lib/hrStatus";
import type { HRCandidateStatus, HRActivityType, HRFollowUpType, HRInterviewType } from "@prisma/client";

// ─── Types ──────────────────────────────────────────────────────────────────
interface User { id: string; name: string; }
interface Activity { id: string; type: string; notes: string|null; createdAt: string; oldStatus:string|null; newStatus:string|null; user:{name:string}|null; }
interface Interview { id: string; type: string; scheduledAt: string; confirmationStatus: string; attendanceStatus: string; result: string|null; notes: string|null; noShowReason: string|null; interviewer: {name:string}|null; }
interface FollowUp { id: string; type: string; dueAt: string; completedAt: string|null; notes: string|null; autoCreated: boolean; user: {name:string}|null; }
interface Resume { id: string; filename: string; url: string; mimeType: string; isActive: boolean; createdAt: string; }
interface Application { id: string; positionApplied: string; source: string; locationPreference: string|null; experience: string|null; statusAtApply: string; submittedAt: string; }
interface Candidate {
  id: string; name: string; phone: string|null; altPhone: string|null; whatsappPhone: string|null;
  email: string|null; location: string|null; city: string|null; currentCompany: string|null; currentProfile: string|null;
  positionApplied: string|null; experience: string|null; realEstateExperience: string|null;
  currentSalary: number|null; expectedSalary: number|null; noticePeriod: string|null;
  source: string|null; status: HRCandidateStatus; originalStatus: string|null; remarks: string|null; tags: string|null;
  nextAction: string|null; nextActionDate: string|null; joiningDate: string|null;
  fitExperience: string|null; fitCommunication: string|null; fitStability: string|null; fitSalary: string|null; fitNotice: string|null;
  interviewFeedback: string|null; joiningProbability: string|null;
  primaryOwnerId: string|null; secondaryOwnerId: string|null;
  primaryOwner: {id:string;name:string;avatarColor:string}|null;
  secondaryOwner: {id:string;name:string;avatarColor:string}|null;
  activities: Activity[]; interviews: Interview[]; followUps: FollowUp[]; resumes: Resume[]; applications?: Application[];
}
interface VoicePerms { canGuide: boolean; canEscalate: boolean; canReview: boolean; }
interface Props { candidate: Candidate; agents: User[]; me: { id: string; name: string; role: string }; voicePerms?: VoicePerms; }

// ─── Constants ──────────────────────────────────────────────────────────────
const CALL_OUTCOMES: { type: HRActivityType; label: string; color: string }[] = [
  { type: "CALL_CONNECTED",    label: "✅ Connected",    color: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { type: "CALL_NOT_ANSWERED", label: "📵 No Answer",    color: "bg-red-100 text-red-700 border-red-300" },
  { type: "CALL_BUSY",         label: "⏳ Busy",         color: "bg-orange-100 text-orange-700 border-orange-300" },
  { type: "CALL_SWITCHED_OFF", label: "📴 Switched Off", color: "bg-gray-100 text-gray-600 border-gray-300" },
  { type: "CALL_WRONG_NUMBER", label: "🚫 Wrong Number", color: "bg-red-200 text-red-800 border-red-400" },
  { type: "CALL_LATER",        label: "🔁 Call Later",   color: "bg-blue-100 text-blue-700 border-blue-300" },
];
const FOLLOWUP_TYPES: HRFollowUpType[] = ["CALL_BACK","INTERVIEW_CONFIRMATION","REMINDER","WHATSAPP_FOLLOWUP","SALARY_DISCUSSION","OFFER_DISCUSSION","JOINING_FOLLOWUP","NO_SHOW_RECOVERY","CUSTOM"];
const INTERVIEW_TYPES: HRInterviewType[] = ["VIRTUAL","HR","FINAL","FACE_TO_FACE"];
const SOURCE_OPTS  = ["Naukri","Indeed","Referral","Walk-in","LinkedIn","Database","Consultant","Email","Whatsapp","Other"].map(s=>[s,s] as [string,string]);
const NOTICE_OPTS  = ["Immediate","7 days","15 days","30 days","45 days","60 days","90 days","Serving Notice"].map(s=>[s,s] as [string,string]);
const POSITION_OPTS= ["Sales Executive","BDE","BDM","Team Leader","Manager","HR","Marketing","Other"].map(s=>[s,s] as [string,string]);
const FIT_OPTS: [string,string][]  = [["Good","🟢 Good"],["Average","🟡 Average"],["Weak","🔴 Weak"]];
const PROB_OPTS: [string,string][] = [["High","🟢 High"],["Medium","🟡 Medium"],["Low","🔴 Low"]];
const WA_TEMPLATES: { label: string; text: string }[] = [
  { label: "Intro", text: "Hi {name}, this is {recruiter} from White Collar Realty regarding a job opportunity. Is now a good time to talk?" },
  { label: "Interview", text: "Hi {name}, confirming your interview with White Collar Realty. Please reply to confirm your availability." },
  { label: "Follow-up", text: "Hi {name}, following up on your application with White Collar Realty — are you still interested in the role?" },
  { label: "Offer", text: "Hi {name}, great news — we'd like to discuss an offer with you. When can we connect?" },
  { label: "Docs", text: "Hi {name}, please share your latest resume and a convenient time for a quick call." },
];

const ACT_LABEL: Record<string, string> = {
  CALL_CONNECTED:"📞 Call — Connected",CALL_NOT_ANSWERED:"📵 Call — No Answer",CALL_BUSY:"⏳ Call — Busy",
  CALL_SWITCHED_OFF:"📴 Call — Switched Off",CALL_WRONG_NUMBER:"🚫 Wrong Number",CALL_LATER:"🔁 Call Later",
  WHATSAPP_SENT:"💬 WhatsApp Sent",WHATSAPP_RECEIVED:"💬 WhatsApp Reply",EMAIL_LOGGED:"📧 Email Logged",
  INTERVIEW_SCHEDULED:"🎯 Interview Scheduled",INTERVIEW_ATTENDED:"✅ Interview Attended",INTERVIEW_NO_SHOW:"⚠️ No Show",
  INTERVIEW_RESCHEDULED:"🔄 Interview Rescheduled",OFFER_RELEASED:"📄 Offer Released",OFFER_DECLINED:"❌ Offer Declined",
  CANDIDATE_JOINED:"🎉 Joined",FOLLOWUP_CREATED:"📅 Follow-up Set",FOLLOWUP_COMPLETED:"✔ Follow-up Done",
  STATUS_CHANGED:"🔄 Status Changed",NOTE_ADDED:"📝 Note / Remark",
};
function fmt(s: string) { return s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()); }
function fmtDate(s: string) { return new Date(s).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
function fmtSalary(n: number|null) { if(!n) return ""; return n>=100000?`₹${(n/100000).toFixed(1)}L`:`₹${(n/1000).toFixed(0)}K`; }
function timeAgo(s: string) {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Inline-edit field (click to edit, PUTs a single field) ───────────────────
function InlineField({ candidateId, field, value, type = "text", options, placeholder, format }: {
  candidateId: string; field: string; value: string | number | null;
  type?: "text" | "number" | "email" | "tel" | "date" | "select" | "textarea";
  options?: [string, string][]; placeholder?: string; format?: (v: string | number) => string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const mini = "w-full border border-gray-200 rounded px-2 py-1 text-xs dark:bg-slate-800 dark:border-slate-600";

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/hr/candidates/${candidateId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: val === "" ? null : val }),
      });
    } finally { setSaving(false); setEditing(false); }
    router.refresh();
  }

  if (!editing) {
    const empty = value == null || value === "";
    return (
      <button type="button" onClick={() => { setVal(value == null ? "" : (type === "date" ? new Date(value as string).toISOString().slice(0, 10) : String(value))); setEditing(true); }}
        className="group text-left text-sm text-gray-800 dark:text-slate-100 hover:bg-blue-50/60 dark:hover:bg-slate-800 rounded px-1 -mx-1 w-full truncate">
        <span className={empty ? "text-gray-300 italic" : ""}>{empty ? "add" : (format ? format(value as string | number) : String(value))}</span>
        <span className="opacity-0 group-hover:opacity-100 text-[10px] text-blue-500 ml-1">✎</span>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {type === "select" ? (
        <select autoFocus value={val} onChange={e => setVal(e.target.value)} className={mini}>
          <option value="">—</option>
          {options?.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea autoFocus value={val} placeholder={placeholder} onChange={e => setVal(e.target.value)} rows={3} className={mini} />
      ) : (
        <input autoFocus type={type} value={val} placeholder={placeholder}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className={mini} />
      )}
      <button type="button" disabled={saving} onClick={save} className="text-green-600 text-sm px-1 shrink-0">✓</button>
      <button type="button" onClick={() => setEditing(false)} className="text-gray-400 text-sm px-1 shrink-0">✕</button>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1 border-b border-gray-50 dark:border-slate-800/60 last:border-0">
      <span className="text-[11px] text-gray-400 shrink-0 w-24">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function HRCandidateDetail({ candidate: c, agents, me, voicePerms }: Props) {
  const router = useRouter();
  const [, startT] = useTransition();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"timeline"|"interviews"|"followups"|"resumes"|"applications">("timeline");
  const [panel, setPanel] = useState<"none"|"call"|"wa"|"followup"|"interview"|"status"|"note">("none");

  const [callNotes, setCallNotes] = useState(""); const [callNext, setCallNext] = useState(""); const [callNextDate, setCallNextDate] = useState("");
  const [waNotes, setWaNotes] = useState("");
  const [fuType, setFuType] = useState<HRFollowUpType>("CALL_BACK"); const [fuDate, setFuDate] = useState(""); const [fuNotes, setFuNotes] = useState("");
  const [ivType, setIvType] = useState<HRInterviewType>("HR"); const [ivDate, setIvDate] = useState(""); const [ivInterviewer, setIvInterviewer] = useState(me.id); const [ivNotes, setIvNotes] = useState("");
  const [newStatus, setNewStatus] = useState<HRCandidateStatus>(c.status); const [statusNote, setStatusNote] = useState("");
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    const doParam = new URLSearchParams(window.location.search).get("do");
    if (doParam === "interview") setPanel("interview");
    else if (doParam === "followup") setPanel("followup");
    else if (doParam === "note") setPanel("note");
    else if (doParam === "resume") setTab("resumes");
  }, []);

  const inp = "w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1a33]/20 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100";

  async function post(path: string, body: object) {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/candidates/${c.id}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    } finally { setBusy(false); }
  }
  async function logCall(outcome: HRActivityType) {
    await post("/log", { type: outcome, notes: callNotes || null, nextAction: callNext||null, nextActionDate: callNextDate||null });
    setPanel("none"); setCallNotes(""); setCallNext(""); setCallNextDate(""); startT(() => router.refresh());
  }
  async function logWA(type: "WHATSAPP_SENT"|"WHATSAPP_RECEIVED") {
    await post("/log", { type, notes: waNotes || null });
    setPanel("none"); setWaNotes(""); startT(() => router.refresh());
  }
  async function createFollowUp() {
    if (!fuDate) return;
    await post("/followup", { type: fuType, dueAt: fuDate, notes: fuNotes||null });
    setPanel("none"); setFuDate(""); setFuNotes(""); startT(() => router.refresh());
  }
  async function scheduleInterview() {
    if (!ivDate) return;
    await post("/interview", { type: ivType, scheduledAt: ivDate, interviewerId: ivInterviewer, notes: ivNotes||null });
    setPanel("none"); setIvDate(""); setIvNotes(""); startT(() => router.refresh());
  }
  async function updateStatus() {
    setBusy(true);
    try {
      await fetch(`/api/hr/candidates/${c.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus, statusNote: statusNote||null }) });
    } finally { setBusy(false); }
    setPanel("none"); setStatusNote(""); startT(() => router.refresh());
  }
  async function addNote() {
    if (!noteText.trim()) return;
    await post("/log", { type: "NOTE_ADDED", notes: noteText });
    setPanel("none"); setNoteText(""); startT(() => router.refresh());
  }
  async function completeFollowUp(fuId: string) {
    setBusy(true);
    await fetch(`/api/hr/candidates/${c.id}/followup`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ followUpId: fuId }) });
    setBusy(false); startT(() => router.refresh());
  }

  const now = new Date();
  const pendingFollowUps = c.followUps.filter(f => !f.completedAt).sort((a,b) => +new Date(a.dueAt) - +new Date(b.dueAt));
  const upcomingInterviews = c.interviews.filter(i => i.attendanceStatus === "SCHEDULED" || i.attendanceStatus === "RESCHEDULED").sort((a,b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
  const nextFU = pendingFollowUps[0];
  const nextIV = upcomingInterviews[0] ?? c.interviews[0];
  const activeResume = c.resumes.find(r => r.isActive) ?? c.resumes[0];
  const waPhone = c.whatsappPhone ?? c.phone ?? "";
  const ownerOpts = agents.map(a => [a.id, a.name] as [string, string]);
  const ownerName = (id: string | number) => agents.find(a => a.id === String(id))?.name ?? "—";
  const fillTpl = (s: string) => s.replace(/\{name\}/g, c.name.split(" ")[0]).replace(/\{recruiter\}/g, me.name.split(" ")[0]);
  const lastAct = c.activities[0];
  const activeStatusDefs = me.role === "AGENT" ? ACTIVE_STATUS_DEFS.filter(s => s.key !== "OFFER_RELEASED") : ACTIVE_STATUS_DEFS;

  const btn = "btn text-sm border rounded-lg gap-1.5";

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      {/* ── Top bar ── */}
      <div className="card p-4 sm:p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <div className="text-xl font-bold text-gray-900 dark:text-white"><InlineField candidateId={c.id} field="name" value={c.name} /></div>
            <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
              {c.positionApplied && <span className="text-[#0b1a33] dark:text-blue-300 font-medium">Applied: {c.positionApplied}</span>}
              {c.currentProfile && <span>{c.currentProfile}</span>}
              {c.currentCompany && <span>· {c.currentCompany}</span>}
            </div>
            <div className="flex gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
              {c.phone && <a href={`tel:${c.phone}`} className="hover:text-blue-600">📞 {c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="hover:text-blue-600">✉️ {c.email}</a>}
              {c.location && <span>📍 {c.location}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <button type="button" onClick={() => setPanel(p => p==="status"?"none":"status")} title="Change status"
              className={`text-xs px-2.5 py-1 rounded-full font-semibold ${statusColor(c.status)} hover:opacity-80`}>
              {displayStatus(c)} ▾
            </button>
            <Link href={`/hr/candidates/${c.id}/timeline`} className="text-[11px] text-blue-600 hover:underline">Full timeline →</Link>
            {lastAct?.user && <span className="text-[10px] text-gray-400">✎ {lastAct.user.name.split(" ")[0]} · {timeAgo(lastAct.createdAt)}</span>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {c.phone && <a href={`tel:${c.phone}`} className={`${btn} border-gray-300 text-gray-700 hover:bg-gray-50`}>📞 Call</a>}
          {waPhone && <a href={`https://wa.me/${waPhone.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" className={`${btn} border-green-300 text-green-700 hover:bg-green-50`}>💬 WhatsApp</a>}
          {waPhone && <button type="button" onClick={() => setPanel(p => p==="wa"?"none":"wa")} className={`${btn} border-green-300 text-green-700 hover:bg-green-50`}>💬 Log WA</button>}
          {c.email && <a href={`mailto:${c.email}`} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-50`}>✉️ Email</a>}
          <button type="button" onClick={() => setPanel(p => p==="call"?"none":"call")} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-50`}>📞 Log Call</button>
          <button type="button" onClick={() => setPanel(p => p==="note"?"none":"note")} className={`${btn} border-gray-300 text-gray-700 hover:bg-gray-50`}>📝 Add Note</button>
          <button type="button" onClick={() => setPanel(p => p==="interview"?"none":"interview")} className={`${btn} border-purple-300 text-purple-700 hover:bg-purple-50`}>🎯 Schedule Interview</button>
          <button type="button" onClick={() => setPanel(p => p==="followup"?"none":"followup")} className={`${btn} border-amber-300 text-amber-700 hover:bg-amber-50`}>📅 Add Follow-Up</button>
          <button type="button" onClick={() => setTab("resumes")} className={`${btn} border-gray-300 text-gray-700 hover:bg-gray-50`}>📎 Upload Resume</button>
        </div>

        {/* Action panels */}
        {panel === "call" && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-blue-800">Log Call — outcome:</div>
            <div className="flex flex-wrap gap-2">
              {CALL_OUTCOMES.map(o => <button key={o.type} type="button" disabled={busy} onClick={() => logCall(o.type)} className={`text-xs px-3 py-1.5 rounded-full border font-medium ${o.color} hover:opacity-80`}>{o.label}</button>)}
            </div>
            <textarea value={callNotes} onChange={e=>setCallNotes(e.target.value)} placeholder="Notes…" rows={2} className={inp} />
            <div className="flex gap-2">
              <input className={`${inp} flex-1`} placeholder="Next action" value={callNext} onChange={e=>setCallNext(e.target.value)} />
              <input className={`${inp} flex-1`} type="datetime-local" value={callNextDate} onChange={e=>setCallNextDate(e.target.value)} />
            </div>
          </div>
        )}
        {panel === "wa" && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg space-y-2">
            <div className="text-[11px] text-green-800 font-semibold">Templates — tap to open WhatsApp &amp; pre-fill the log:</div>
            <div className="flex flex-wrap gap-1.5">
              {WA_TEMPLATES.map(t => (
                <a key={t.label} href={`https://wa.me/${waPhone.replace(/\D/g,"")}?text=${encodeURIComponent(fillTpl(t.text))}`}
                  target="_blank" rel="noopener noreferrer" onClick={() => setWaNotes(fillTpl(t.text))}
                  className="text-[11px] px-2 py-1 rounded-full border border-green-300 bg-white text-green-700 hover:bg-green-100">{t.label}</a>
              ))}
            </div>
            <textarea value={waNotes} onChange={e=>setWaNotes(e.target.value)} placeholder="What was discussed / sent…" rows={2} className={inp} />
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => logWA("WHATSAPP_SENT")} className="btn text-sm bg-green-600 text-white hover:bg-green-700">We Sent</button>
              <button type="button" disabled={busy} onClick={() => logWA("WHATSAPP_RECEIVED")} className="btn text-sm bg-teal-600 text-white hover:bg-teal-700">Client Replied</button>
            </div>
          </div>
        )}
        {panel === "followup" && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select className={inp} value={fuType} onChange={e=>setFuType(e.target.value as HRFollowUpType)}>{FOLLOWUP_TYPES.map(t=><option key={t} value={t}>{fmt(t)}</option>)}</select>
              <input className={inp} type="datetime-local" value={fuDate} onChange={e=>setFuDate(e.target.value)} />
            </div>
            <input className={inp} placeholder="Note (optional)" value={fuNotes} onChange={e=>setFuNotes(e.target.value)} />
            <div className="flex gap-1.5 flex-wrap text-[11px]">
              {[["30 min","30"],["1 hour","60"],["2 hours","120"],["Tomorrow","1440"]].map(([label,mins])=>(
                <button key={mins} type="button" onClick={() => setFuDate(new Date(Date.now()+parseInt(mins)*60000).toISOString().slice(0,16))} className="px-2 py-0.5 rounded border border-amber-300 bg-white text-amber-700 hover:bg-amber-100">{label}</button>
              ))}
            </div>
            <button type="button" disabled={busy || !fuDate} onClick={createFollowUp} className="btn text-sm bg-amber-500 text-white hover:bg-amber-600">Save Follow-Up</button>
          </div>
        )}
        {panel === "interview" && (
          <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <select className={inp} value={ivType} onChange={e=>setIvType(e.target.value as HRInterviewType)}>{INTERVIEW_TYPES.map(t=><option key={t} value={t}>{fmt(t)}</option>)}</select>
              <input className={inp} type="datetime-local" value={ivDate} onChange={e=>setIvDate(e.target.value)} />
              <select className={inp} value={ivInterviewer} onChange={e=>setIvInterviewer(e.target.value)}>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </div>
            <textarea value={ivNotes} onChange={e=>setIvNotes(e.target.value)} placeholder="Notes / format…" rows={2} className={inp} />
            <div className="text-[11px] text-purple-700">✅ Confirmation follow-up + morning reminder auto-created.</div>
            <button type="button" disabled={busy || !ivDate} onClick={scheduleInterview} className="btn text-sm bg-purple-600 text-white hover:bg-purple-700">Schedule</button>
          </div>
        )}
        {panel === "status" && (
          <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><div className="text-[10px] font-semibold text-gray-500 mb-1 uppercase">Active</div>
                {activeStatusDefs.map(({key,label})=><button key={key} type="button" onClick={()=>setNewStatus(key)} className={`block w-full text-left px-2 py-1 rounded text-xs mb-0.5 ${newStatus===key?"bg-blue-100 text-blue-800 font-semibold":"hover:bg-gray-100 text-gray-700"}`}>{label}</button>)}
              </div>
              <div><div className="text-[10px] font-semibold text-gray-500 mb-1 uppercase">Closed</div>
                {CLOSED_STATUS_DEFS.map(({key,label})=><button key={key} type="button" onClick={()=>setNewStatus(key)} className={`block w-full text-left px-2 py-1 rounded text-xs mb-0.5 ${newStatus===key?"bg-red-100 text-red-800 font-semibold":"hover:bg-gray-100 text-gray-700"}`}>{label}</button>)}
              </div>
            </div>
            <input className={inp} placeholder="Reason / note (optional)" value={statusNote} onChange={e=>setStatusNote(e.target.value)} />
            <button type="button" disabled={busy} onClick={updateStatus} className="btn text-sm bg-[#0b1a33] text-white hover:bg-[#1a2d4d]">Update Status</button>
          </div>
        )}
        {panel === "note" && (
          <div className="mt-3 p-3 bg-amber-50/60 border border-amber-200 rounded-lg space-y-2">
            <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Add a remark — it becomes a timeline entry…" rows={3} className={inp} />
            <button type="button" disabled={busy||!noteText.trim()} onClick={addNote} className="btn text-sm bg-amber-500 text-white hover:bg-amber-600">Save Note</button>
          </div>
        )}
      </div>

      {/* ── 2-column body ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Main — on mobile, push BELOW the info panels so phone users reach
            phone/salary/owner/fit without scrolling the whole timeline first. */}
        <div className="lg:col-span-2 space-y-4 order-2 lg:order-none">
          {pendingFollowUps.length > 0 && (
            <div className="card p-3 border-l-4 border-amber-400 bg-amber-50">
              <div className="text-xs font-semibold text-amber-800 mb-2">📅 Pending Follow-Ups ({pendingFollowUps.length})</div>
              <div className="space-y-1.5">
                {pendingFollowUps.slice(0,3).map(fu => { const d=new Date(fu.dueAt); const overdue=d<now; return (
                  <div key={fu.id} className="flex items-center justify-between gap-2">
                    <div className="text-xs"><span className={overdue?"text-red-600 font-semibold":"text-amber-700"}>{overdue?"⚠ Overdue — ":""}{d.toLocaleDateString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</span><span className="text-gray-500 ml-1.5">{fmt(fu.type)}</span>{fu.notes && <span className="text-gray-400 ml-1">· {fu.notes}</span>}</div>
                    <button type="button" disabled={busy} onClick={() => completeFollowUp(fu.id)} className="text-[10px] px-2 py-0.5 rounded border border-green-300 bg-white text-green-700 hover:bg-green-50 shrink-0">✔ Done</button>
                  </div>
                ); })}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-slate-700 flex gap-0">
            {([["timeline","Timeline"],["interviews","Interviews"],["followups","Follow-Ups"],["resumes","Resumes"],...(c.applications?.length?[["applications",`Applications (${c.applications.length})`]]:[])] as [typeof tab,string][]).map(([t,label])=>(
              <button key={t} type="button" onClick={()=>setTab(t)} className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${tab===t?"border-[#0b1a33] text-[#0b1a33] dark:border-white dark:text-white":"border-transparent text-gray-500 hover:text-gray-700"}`}>{label}</button>
            ))}
          </div>

          {tab === "timeline" && (
            <div className="space-y-2">
              {c.activities.length === 0 && <div className="text-sm text-gray-400 text-center py-6">No activity logged yet.</div>}
              {c.activities.map(a => (
                <div key={a.id} className="flex gap-3 text-sm">
                  <div className="text-xs text-gray-400 w-24 shrink-0 pt-0.5">{new Date(a.createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}<br/><span className="text-[10px]">{new Date(a.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span></div>
                  <div className="flex-1 bg-gray-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-gray-800 dark:text-slate-200">{ACT_LABEL[a.type] ?? fmt(a.type)}</span>
                      {a.user && <span className="text-[10px] text-gray-400">· {a.user.name}</span>}
                      {a.newStatus && a.oldStatus && a.oldStatus !== a.newStatus && <span className="text-[10px] text-gray-400">· {statusLabel(a.oldStatus)} → {statusLabel(a.newStatus)}</span>}
                    </div>
                    {a.notes && <div className="text-xs text-gray-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{a.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === "interviews" && (
            <div className="space-y-3">
              {c.interviews.length === 0 && <div className="text-sm text-gray-400 text-center py-6">No interviews yet.</div>}
              {c.interviews.map(iv => (
                <div key={iv.id} className="card p-4 border border-[#e5e7eb]">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div><div className="font-semibold text-sm">{fmt(iv.type)} Interview</div><div className="text-xs text-gray-500">{fmtDate(iv.scheduledAt)}</div>{iv.interviewer && <div className="text-xs text-gray-500">Interviewer: {iv.interviewer.name}</div>}</div>
                    <div className="flex gap-1.5 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${iv.confirmationStatus==="CONFIRMED"?"bg-green-100 text-green-700":"bg-amber-100 text-amber-700"}`}>{fmt(iv.confirmationStatus)}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${iv.attendanceStatus==="ATTENDED"?"bg-green-100 text-green-700":iv.attendanceStatus==="NO_SHOW"?"bg-red-100 text-red-700":"bg-gray-100 text-gray-600"}`}>{fmt(iv.attendanceStatus)}</span>
                    </div>
                  </div>
                  {iv.notes && <div className="text-xs text-gray-600 mt-2">{iv.notes}</div>}
                </div>
              ))}
            </div>
          )}
          {tab === "followups" && (
            <div className="space-y-2">
              {c.followUps.length === 0 && <div className="text-sm text-gray-400 text-center py-6">No follow-ups yet.</div>}
              {c.followUps.map(fu => { const d=new Date(fu.dueAt); const overdue=!fu.completedAt&&d<now; return (
                <div key={fu.id} className={`card p-3 border ${fu.completedAt?"border-green-200 bg-green-50/30 opacity-70":overdue?"border-red-200 bg-red-50/30":"border-amber-200 bg-amber-50/30"}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <span className="text-xs font-semibold">{fmt(fu.type)}</span>{fu.autoCreated && <span className="text-[10px] ml-1.5 text-gray-400">· auto</span>}
                      <div className={`text-[11px] mt-0.5 ${fu.completedAt?"text-green-600":overdue?"text-red-600 font-semibold":"text-amber-700"}`}>{fu.completedAt ? `✔ Done ${new Date(fu.completedAt).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}` : `${overdue?"⚠ Overdue — ":""}${d.toLocaleDateString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}`}</div>
                      {fu.notes && <div className="text-[11px] text-gray-500 mt-0.5">{fu.notes}</div>}
                    </div>
                    {!fu.completedAt && <button type="button" disabled={busy} onClick={() => completeFollowUp(fu.id)} className="text-xs px-2.5 py-1 rounded border border-green-300 bg-white text-green-700 hover:bg-green-50 shrink-0">✔ Mark Done</button>}
                  </div>
                </div>
              ); })}
            </div>
          )}
          {tab === "applications" && (
            <div className="space-y-2">
              {(!c.applications || c.applications.length === 0) && <div className="text-sm text-gray-400 text-center py-6">No applications recorded.</div>}
              {c.applications?.map(ap => (
                <div key={ap.id} className="card p-3 border border-[#e5e7eb] dark:border-slate-700">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <div className="font-semibold text-sm text-gray-900 dark:text-slate-100">{ap.positionApplied}</div>
                      <div className="text-xs text-gray-500">{ap.source}{ap.locationPreference ? ` · ${ap.locationPreference}` : ""}{ap.experience ? ` · ${ap.experience}` : ""}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-gray-400">{new Date(ap.submittedAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})} · {new Date(ap.submittedAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium dark:bg-slate-700 dark:text-slate-300">{statusLabel(ap.statusAtApply)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === "resumes" && (
            <div className="space-y-4">
              <div className="card p-4"><div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mb-3">📎 Upload Resume — PDF, DOC, image, or phone photo</div><HRResumeUploadWidget candidates={[]} preselectedCandidateId={c.id} /></div>
              {c.resumes.length === 0 ? <div className="text-sm text-gray-400 text-center py-6">No resumes uploaded yet.</div> : (
                <div className="space-y-2">{c.resumes.map(r => (
                  <div key={r.id} className="card p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0 text-lg">{r.mimeType.startsWith("image/") ? "🖼️" : "📄"}</div>
                    <div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate">{r.filename}</span>{r.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">Active</span>}</div><div className="text-[11px] text-gray-400 mt-0.5">{new Date(r.createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</div></div>
                    <a href={`/api/hr/candidates/${c.id}/resume?resumeId=${r.id}${r.mimeType.startsWith("image/") ? "" : "&download=1"}`} target="_blank" rel="noopener noreferrer" className="text-[11px] px-2.5 py-1 rounded-lg border border-blue-300 text-blue-700 bg-white hover:bg-blue-50 shrink-0">{r.mimeType.startsWith("image/") ? "View" : "Download"}</a>
                  </div>
                ))}</div>
              )}
            </div>
          )}
        </div>

        {/* Right panels */}
        <div className="space-y-4">
          <HRCandidateVoice
            candidateId={c.id}
            canGuide={voicePerms?.canGuide ?? false}
            canEscalate={voicePerms?.canEscalate ?? false}
            canReview={voicePerms?.canReview ?? false}
          />
          <Panel title="Candidate Information">
            <Row label="Phone"><InlineField candidateId={c.id} field="phone" value={c.phone} type="tel" /></Row>
            <Row label="WhatsApp"><InlineField candidateId={c.id} field="whatsappPhone" value={c.whatsappPhone} type="tel" /></Row>
            <Row label="Email"><InlineField candidateId={c.id} field="email" value={c.email} type="email" /></Row>
            <Row label="Location"><InlineField candidateId={c.id} field="location" value={c.location} /></Row>
            <Row label="City"><InlineField candidateId={c.id} field="city" value={c.city} /></Row>
            <Row label="Company"><InlineField candidateId={c.id} field="currentCompany" value={c.currentCompany} /></Row>
            <Row label="Profile"><InlineField candidateId={c.id} field="currentProfile" value={c.currentProfile} /></Row>
            <Row label="Position"><InlineField candidateId={c.id} field="positionApplied" value={c.positionApplied} type="select" options={POSITION_OPTS} /></Row>
            <Row label="Experience"><InlineField candidateId={c.id} field="experience" value={c.experience} /></Row>
            <Row label="RE Exp."><InlineField candidateId={c.id} field="realEstateExperience" value={c.realEstateExperience} /></Row>
          </Panel>

          <Panel title="Salary & Notice">
            <Row label="Current ₹"><InlineField candidateId={c.id} field="currentSalary" value={c.currentSalary} type="number" format={v=>fmtSalary(Number(v))} /></Row>
            <Row label="Expected ₹"><InlineField candidateId={c.id} field="expectedSalary" value={c.expectedSalary} type="number" format={v=>fmtSalary(Number(v))} /></Row>
            <Row label="Notice"><InlineField candidateId={c.id} field="noticePeriod" value={c.noticePeriod} type="select" options={NOTICE_OPTS} /></Row>
          </Panel>

          <Panel title="Interview & Follow-Up">
            <Row label="Next Action"><InlineField candidateId={c.id} field="nextAction" value={c.nextAction} /></Row>
            <Row label="Follow-Up"><span className="text-sm text-gray-700 dark:text-slate-200">{nextFU ? new Date(nextFU.dueAt).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "—"}</span></Row>
            <Row label="Interview"><span className="text-sm text-gray-700 dark:text-slate-200">{nextIV ? new Date(nextIV.scheduledAt).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "—"}</span></Row>
            <Row label="Type"><span className="text-sm text-gray-700 dark:text-slate-200">{nextIV ? fmt(nextIV.type) : "—"}</span></Row>
            <Row label="Confirm"><span className="text-sm text-gray-700 dark:text-slate-200">{nextIV ? fmt(nextIV.confirmationStatus) : "—"}</span></Row>
            <Row label="Joining"><InlineField candidateId={c.id} field="joiningDate" value={c.joiningDate} type="date" format={v => new Date(v as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} /></Row>
          </Panel>

          <Panel title="Resume">
            {activeResume ? (
              <div className="flex items-center gap-2">
                <a href={`/api/hr/candidates/${c.id}/resume?resumeId=${activeResume.id}`} target="_blank" rel="noopener noreferrer" className="text-xs px-2.5 py-1 rounded-lg border border-blue-300 text-blue-700 bg-white hover:bg-blue-50">View Resume</a>
                <button type="button" onClick={()=>setTab("resumes")} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Replace</button>
              </div>
            ) : (
              <button type="button" onClick={()=>setTab("resumes")} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Upload Resume</button>
            )}
          </Panel>

          <Panel title="Ownership">
            <Row label="Source"><InlineField candidateId={c.id} field="source" value={c.source} type="select" options={SOURCE_OPTS} /></Row>
            <Row label="Primary"><InlineField candidateId={c.id} field="primaryOwnerId" value={c.primaryOwnerId} type="select" options={ownerOpts} format={ownerName} /></Row>
            <Row label="Secondary"><InlineField candidateId={c.id} field="secondaryOwnerId" value={c.secondaryOwnerId} type="select" options={ownerOpts} format={ownerName} /></Row>
          </Panel>

          <Panel title="Candidate Fit">
            <Row label="Experience"><InlineField candidateId={c.id} field="fitExperience" value={c.fitExperience} type="select" options={FIT_OPTS} /></Row>
            <Row label="Communication"><InlineField candidateId={c.id} field="fitCommunication" value={c.fitCommunication} type="select" options={FIT_OPTS} /></Row>
            <Row label="Stability"><InlineField candidateId={c.id} field="fitStability" value={c.fitStability} type="select" options={FIT_OPTS} /></Row>
            <Row label="Salary Fit"><InlineField candidateId={c.id} field="fitSalary" value={c.fitSalary} type="select" options={FIT_OPTS} /></Row>
            <Row label="Notice Fit"><InlineField candidateId={c.id} field="fitNotice" value={c.fitNotice} type="select" options={FIT_OPTS} /></Row>
            <Row label="Joining Prob."><InlineField candidateId={c.id} field="joiningProbability" value={c.joiningProbability} type="select" options={PROB_OPTS} /></Row>
            <div className="pt-1.5"><div className="text-[11px] text-gray-400 mb-1">Interview Feedback</div><InlineField candidateId={c.id} field="interviewFeedback" value={c.interviewFeedback} type="textarea" placeholder="add feedback" /></div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
