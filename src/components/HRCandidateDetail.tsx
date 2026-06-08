"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HRCandidateStatus, HRActivityType, HRFollowUpType, HRInterviewType } from "@prisma/client";

// ─── Type definitions ─────────────────────────────────────────────────────────
interface User { id: string; name: string; }
interface Activity { id: string; type: string; notes: string|null; createdAt: string; oldStatus:string|null; newStatus:string|null; user:{name:string}|null; }
interface Interview { id: string; type: string; scheduledAt: string; confirmationStatus: string; attendanceStatus: string; result: string|null; notes: string|null; noShowReason: string|null; interviewer: {name:string}|null; }
interface FollowUp { id: string; type: string; dueAt: string; completedAt: string|null; notes: string|null; autoCreated: boolean; user: {name:string}|null; }
interface Resume { id: string; filename: string; url: string; isActive: boolean; createdAt: string; }
interface Candidate {
  id: string; name: string; phone: string|null; altPhone: string|null; whatsappPhone: string|null;
  email: string|null; location: string|null; currentCompany: string|null; currentProfile: string|null;
  experience: string|null; currentSalary: number|null; expectedSalary: number|null; noticePeriod: string|null;
  source: string|null; status: HRCandidateStatus; remarks: string|null; tags: string|null;
  nextAction: string|null; nextActionDate: string|null;
  primaryOwner: {id:string;name:string;avatarColor:string}|null;
  secondaryOwner: {id:string;name:string;avatarColor:string}|null;
  activities: Activity[]; interviews: Interview[]; followUps: FollowUp[]; resumes: Resume[];
}
interface Props {
  candidate: Candidate;
  agents: User[];
  me: { id: string; name: string; role: string };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const ACTIVE_STATUSES: HRCandidateStatus[] = ["NEW","NOT_CALLED","PIPELINE","VIRTUAL_INTERVIEW_SCHEDULED","HR_INTERVIEW_COMPLETED","FINAL_INTERVIEW_SCHEDULED","FINAL_INTERVIEW_COMPLETED","SHORTLISTED","OFFER_RELEASED","JOINED","HOLD"];
const CLOSED_STATUSES: HRCandidateStatus[] = ["NOT_INTERESTED","NOT_SUITABLE","HIGH_SALARY","OTHER_PROFILE","REJECTED","OFFER_DECLINED","WRONG_NUMBER","SWITCH_OFF","NEVER_RESPONSE","NOT_RESPONDING"];

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

const STATUS_COLOR: Record<string, string> = {
  NEW:"bg-blue-100 text-blue-800",PIPELINE:"bg-emerald-100 text-emerald-800",
  VIRTUAL_INTERVIEW_SCHEDULED:"bg-indigo-100 text-indigo-800",
  HR_INTERVIEW_COMPLETED:"bg-cyan-100 text-cyan-800",
  FINAL_INTERVIEW_SCHEDULED:"bg-purple-100 text-purple-800",
  FINAL_INTERVIEW_COMPLETED:"bg-violet-100 text-violet-800",
  SHORTLISTED:"bg-teal-100 text-teal-800",OFFER_RELEASED:"bg-amber-100 text-amber-800",
  JOINED:"bg-green-100 text-green-800",HOLD:"bg-orange-100 text-orange-800",
  NOT_INTERESTED:"bg-red-100 text-red-700",REJECTED:"bg-red-200 text-red-800",
  NOT_SUITABLE:"bg-red-100 text-red-700",HIGH_SALARY:"bg-pink-100 text-pink-700",
  OFFER_DECLINED:"bg-orange-200 text-orange-800",
};

const ACT_LABEL: Record<string, string> = {
  CALL_CONNECTED:"📞 Call — Connected",CALL_NOT_ANSWERED:"📵 Call — No Answer",
  CALL_BUSY:"⏳ Call — Busy",CALL_SWITCHED_OFF:"📴 Call — Switched Off",
  CALL_WRONG_NUMBER:"🚫 Wrong Number",CALL_LATER:"🔁 Call Later",
  WHATSAPP_SENT:"💬 WhatsApp Sent",WHATSAPP_RECEIVED:"💬 WhatsApp Reply",
  EMAIL_LOGGED:"📧 Email Logged",INTERVIEW_SCHEDULED:"🎯 Interview Scheduled",
  INTERVIEW_ATTENDED:"✅ Interview Attended",INTERVIEW_NO_SHOW:"⚠️ No Show",
  INTERVIEW_RESCHEDULED:"🔄 Interview Rescheduled",OFFER_RELEASED:"📄 Offer Released",
  OFFER_DECLINED:"❌ Offer Declined",CANDIDATE_JOINED:"🎉 Joined",
  FOLLOWUP_CREATED:"📅 Follow-up Set",FOLLOWUP_COMPLETED:"✔ Follow-up Done",
  STATUS_CHANGED:"🔄 Status Changed",NOTE_ADDED:"📝 Note",
};

function fmt(s: string) { return s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()); }
function fmtDate(s: string) { return new Date(s).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
function fmtSalary(n: number|null) { if(!n) return "—"; return n>=100000?`₹${(n/100000).toFixed(1)}L`:`₹${(n/1000).toFixed(0)}K`; }

// ─── Component ────────────────────────────────────────────────────────────────
export default function HRCandidateDetail({ candidate: init, agents, me }: Props) {
  const router = useRouter();
  const [, startT] = useTransition();
  const [c, setC] = useState(init);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"timeline"|"interviews"|"followups"|"profile">("timeline");

  // Action panel state
  const [panel, setPanel] = useState<"none"|"call"|"wa"|"followup"|"interview"|"status"|"note">("none");
  const [callNotes, setCallNotes] = useState(""); const [callNext, setCallNext] = useState(""); const [callNextDate, setCallNextDate] = useState("");
  const [waNotes, setWaNotes] = useState("");
  const [fuType, setFuType] = useState<HRFollowUpType>("CALL_BACK"); const [fuDate, setFuDate] = useState(""); const [fuNotes, setFuNotes] = useState("");
  const [ivType, setIvType] = useState<HRInterviewType>("HR"); const [ivDate, setIvDate] = useState(""); const [ivInterviewer, setIvInterviewer] = useState(me.id); const [ivNotes, setIvNotes] = useState("");
  const [newStatus, setNewStatus] = useState<HRCandidateStatus>(c.status); const [statusNote, setStatusNote] = useState("");
  const [noteText, setNoteText] = useState("");

  const inp = "w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1a33]/20 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100";

  async function post(path: string, body: object) {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/candidates/${c.id}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    } finally { setBusy(false); }
  }

  async function patch(path: string, body: object) {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/candidates/${c.id}${path}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    } finally { setBusy(false); }
  }

  async function logCall(outcome: HRActivityType) {
    await post("/log", { type: outcome, notes: callNotes || null, nextAction: callNext||null, nextActionDate: callNextDate||null });
    setPanel("none"); setCallNotes(""); setCallNext(""); setCallNextDate("");
    startT(() => router.refresh());
  }

  async function logWA(type: "WHATSAPP_SENT"|"WHATSAPP_RECEIVED") {
    await post("/log", { type, notes: waNotes || null });
    setPanel("none"); setWaNotes("");
    startT(() => router.refresh());
  }

  async function createFollowUp() {
    if (!fuDate) return;
    await post("/followup", { type: fuType, dueAt: fuDate, notes: fuNotes||null });
    setPanel("none"); setFuDate(""); setFuNotes("");
    startT(() => router.refresh());
  }

  async function scheduleInterview() {
    if (!ivDate) return;
    await post("/interview", { type: ivType, scheduledAt: ivDate, interviewerId: ivInterviewer, notes: ivNotes||null });
    setPanel("none"); setIvDate(""); setIvNotes("");
    startT(() => router.refresh());
  }

  async function updateStatus() {
    await patch("", { status: newStatus, statusNote: statusNote||null });
    setPanel("none"); setStatusNote("");
    startT(() => router.refresh());
  }

  async function addNote() {
    if (!noteText.trim()) return;
    await post("/log", { type: "NOTE_ADDED", notes: noteText });
    setPanel("none"); setNoteText("");
    startT(() => router.refresh());
  }

  async function completeFollowUp(fuId: string) {
    setBusy(true);
    await fetch(`/api/hr/candidates/${c.id}/followup`, {
      method: "PATCH", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ followUpId: fuId }),
    });
    setBusy(false);
    startT(() => router.refresh());
  }

  const now = new Date();
  const pendingFollowUps = c.followUps.filter(f => !f.completedAt).sort((a,b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const upcomingInterviews = c.interviews.filter(i => i.attendanceStatus === "SCHEDULED").sort((a,b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const waPhone = c.whatsappPhone ?? c.phone ?? "";

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="card p-4 sm:p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{c.name}</h1>
            <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
              {c.currentProfile && <span>{c.currentProfile}</span>}
              {c.currentCompany && <span>· {c.currentCompany}</span>}
              {c.experience && <span>· {c.experience}</span>}
            </div>
            <div className="flex gap-2 mt-2 flex-wrap text-xs text-gray-600">
              {c.phone && <a href={`tel:${c.phone}`} className="hover:text-blue-600">📞 {c.phone}</a>}
              {c.altPhone && <a href={`tel:${c.altPhone}`} className="hover:text-blue-600">📱 {c.altPhone}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="hover:text-blue-600">✉️ {c.email}</a>}
              {c.location && <span>📍 {c.location}</span>}
            </div>
            <div className="flex gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
              {c.currentSalary && <span>Current: {fmtSalary(c.currentSalary)}</span>}
              {c.expectedSalary && <span>Expected: <b className="text-gray-700">{fmtSalary(c.expectedSalary)}</b></span>}
              {c.noticePeriod && <span>Notice: {c.noticePeriod}</span>}
              {c.source && <span>Source: {c.source}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${STATUS_COLOR[c.status] ?? "bg-gray-100 text-gray-600"}`}>
              {fmt(c.status)}
            </span>
            {c.primaryOwner && <span className="text-[11px] text-gray-500">Owner: {c.primaryOwner.name}</span>}
          </div>
        </div>

        {/* Quick action bar */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {c.phone && <a href={`tel:${c.phone}`} className="btn text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 gap-1.5">📞 Call</a>}
          {waPhone && <a href={`https://wa.me/${waPhone.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" className="btn text-sm border border-green-300 text-green-700 hover:bg-green-50 gap-1.5">💬 WhatsApp</a>}
          <button type="button" onClick={() => setPanel(p => p==="call"?"none":"call")} className="btn text-sm border border-blue-300 text-blue-700 hover:bg-blue-50">📞 Log Call</button>
          <button type="button" onClick={() => setPanel(p => p==="wa"?"none":"wa")} className="btn text-sm border border-green-300 text-green-700 hover:bg-green-50">💬 Log WA</button>
          <button type="button" onClick={() => setPanel(p => p==="followup"?"none":"followup")} className="btn text-sm border border-amber-300 text-amber-700 hover:bg-amber-50">📅 Follow-up</button>
          <button type="button" onClick={() => setPanel(p => p==="interview"?"none":"interview")} className="btn text-sm border border-purple-300 text-purple-700 hover:bg-purple-50">🎯 Interview</button>
          <button type="button" onClick={() => setPanel(p => p==="status"?"none":"status")} className="btn text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">🔄 Status</button>
          <button type="button" onClick={() => setPanel(p => p==="note"?"none":"note")} className="btn text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">📝 Note</button>
        </div>

        {/* ── Action panels ── */}
        {panel === "call" && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-blue-800">Log Call — select outcome:</div>
            <div className="flex flex-wrap gap-2">
              {CALL_OUTCOMES.map(o => (
                <button key={o.type} type="button" disabled={busy}
                  onClick={() => logCall(o.type)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium ${o.color} hover:opacity-80 transition`}>
                  {o.label}
                </button>
              ))}
            </div>
            <textarea value={callNotes} onChange={e=>setCallNotes(e.target.value)} placeholder="Notes (optional)…" rows={2} className={inp} />
            <div className="flex gap-2">
              <input className={`${inp} flex-1`} placeholder="Next action" value={callNext} onChange={e=>setCallNext(e.target.value)} />
              <input className={`${inp} flex-1`} type="datetime-local" value={callNextDate} onChange={e=>setCallNextDate(e.target.value)} />
            </div>
          </div>
        )}

        {panel === "wa" && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-green-800">Log WhatsApp</div>
            <textarea value={waNotes} onChange={e=>setWaNotes(e.target.value)} placeholder="What was discussed / sent…" rows={2} className={inp} />
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => logWA("WHATSAPP_SENT")} className="btn text-sm bg-green-600 text-white hover:bg-green-700">We Sent</button>
              <button type="button" disabled={busy} onClick={() => logWA("WHATSAPP_RECEIVED")} className="btn text-sm bg-teal-600 text-white hover:bg-teal-700">Client Replied</button>
              <button type="button" onClick={() => setPanel("none")} className="btn text-sm border border-gray-300 text-gray-600">Cancel</button>
            </div>
          </div>
        )}

        {panel === "followup" && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-amber-800">Set Follow-Up</div>
            <div className="grid grid-cols-2 gap-2">
              <select className={inp} value={fuType} onChange={e=>setFuType(e.target.value as HRFollowUpType)}>
                {FOLLOWUP_TYPES.map(t=><option key={t} value={t}>{fmt(t)}</option>)}
              </select>
              <input className={inp} type="datetime-local" value={fuDate} onChange={e=>setFuDate(e.target.value)} required />
            </div>
            <input className={inp} placeholder="Quick-set: +30m  +1h  +2h  +1d" value={fuNotes} onChange={e=>setFuNotes(e.target.value)} />
            {/* Quick presets */}
            <div className="flex gap-1.5 flex-wrap text-[11px]">
              {[["30 min","30"],["1 hour","60"],["2 hours","120"],["Tomorrow","1440"]].map(([label,mins])=>(
                <button key={mins} type="button" onClick={() => {
                  const d = new Date(Date.now() + parseInt(mins)*60000);
                  setFuDate(d.toISOString().slice(0,16));
                }} className="px-2 py-0.5 rounded border border-amber-300 bg-white text-amber-700 hover:bg-amber-100">{label}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !fuDate} onClick={createFollowUp} className="btn text-sm bg-amber-500 text-white hover:bg-amber-600">Save Follow-Up</button>
              <button type="button" onClick={()=>setPanel("none")} className="btn text-sm border border-gray-300 text-gray-600">Cancel</button>
            </div>
          </div>
        )}

        {panel === "interview" && (
          <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-purple-800">Schedule Interview</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <select className={inp} value={ivType} onChange={e=>setIvType(e.target.value as HRInterviewType)}>
                {INTERVIEW_TYPES.map(t=><option key={t} value={t}>{fmt(t)}</option>)}
              </select>
              <input className={inp} type="datetime-local" value={ivDate} onChange={e=>setIvDate(e.target.value)} required />
              <select className={inp} value={ivInterviewer} onChange={e=>setIvInterviewer(e.target.value)}>
                {agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <textarea value={ivNotes} onChange={e=>setIvNotes(e.target.value)} placeholder="Notes / interview format…" rows={2} className={inp} />
            <div className="text-[11px] text-purple-700">✅ Confirmation follow-up + morning reminder will be auto-created.</div>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !ivDate} onClick={scheduleInterview} className="btn text-sm bg-purple-600 text-white hover:bg-purple-700">Schedule</button>
              <button type="button" onClick={()=>setPanel("none")} className="btn text-sm border border-gray-300 text-gray-600">Cancel</button>
            </div>
          </div>
        )}

        {panel === "status" && (
          <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-gray-700">Update Status</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Active</div>
                {ACTIVE_STATUSES.map(s=>(
                  <button key={s} type="button"
                    onClick={()=>setNewStatus(s)}
                    className={`block w-full text-left px-2 py-1 rounded text-xs mb-0.5 ${newStatus===s?"bg-blue-100 text-blue-800 font-semibold":"hover:bg-gray-100 text-gray-700"}`}>
                    {fmt(s)}
                  </button>
                ))}
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Closed</div>
                {CLOSED_STATUSES.map(s=>(
                  <button key={s} type="button"
                    onClick={()=>setNewStatus(s)}
                    className={`block w-full text-left px-2 py-1 rounded text-xs mb-0.5 ${newStatus===s?"bg-red-100 text-red-800 font-semibold":"hover:bg-gray-100 text-gray-700"}`}>
                    {fmt(s)}
                  </button>
                ))}
              </div>
            </div>
            <input className={inp} placeholder="Reason / note (optional)" value={statusNote} onChange={e=>setStatusNote(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={updateStatus} className="btn text-sm bg-[#0b1a33] text-white hover:bg-[#1a2d4d]">Update Status</button>
              <button type="button" onClick={()=>setPanel("none")} className="btn text-sm border border-gray-300 text-gray-600">Cancel</button>
            </div>
          </div>
        )}

        {panel === "note" && (
          <div className="mt-3 p-3 bg-amber-50/60 border border-amber-200 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-amber-800">Add Note</div>
            <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Internal note…" rows={3} className={inp} />
            <div className="flex gap-2">
              <button type="button" disabled={busy||!noteText.trim()} onClick={addNote} className="btn text-sm bg-amber-500 text-white hover:bg-amber-600">Save Note</button>
              <button type="button" onClick={()=>setPanel("none")} className="btn text-sm border border-gray-300 text-gray-600">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Pending follow-ups banner */}
      {pendingFollowUps.length > 0 && (
        <div className="card p-3 border-l-4 border-amber-400 bg-amber-50">
          <div className="text-xs font-semibold text-amber-800 mb-2">📅 Pending Follow-Ups ({pendingFollowUps.length})</div>
          <div className="space-y-1.5">
            {pendingFollowUps.slice(0,3).map(fu => {
              const d = new Date(fu.dueAt);
              const overdue = d < now;
              return (
                <div key={fu.id} className="flex items-center justify-between gap-2">
                  <div className="text-xs">
                    <span className={overdue?"text-red-600 font-semibold":"text-amber-700"}>
                      {overdue?"⚠ Overdue — ":""}{d.toLocaleDateString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                    </span>
                    <span className="text-gray-500 ml-1.5">{fmt(fu.type)}</span>
                    {fu.notes && <span className="text-gray-400 ml-1">· {fu.notes}</span>}
                  </div>
                  <button type="button" disabled={busy} onClick={() => completeFollowUp(fu.id)}
                    className="text-[10px] px-2 py-0.5 rounded border border-green-300 bg-white text-green-700 hover:bg-green-50 shrink-0">
                    ✔ Done
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming interviews banner */}
      {upcomingInterviews.length > 0 && (
        <div className="card p-3 border-l-4 border-purple-400 bg-purple-50">
          <div className="text-xs font-semibold text-purple-800 mb-1.5">🎯 Upcoming Interviews</div>
          {upcomingInterviews.map(iv => (
            <div key={iv.id} className="text-xs text-purple-700">
              <b>{fmt(iv.type)}</b> on {fmtDate(iv.scheduledAt)}
              {iv.interviewer && <span className="text-purple-500"> · {iv.interviewer.name}</span>}
              <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] ${iv.confirmationStatus==="CONFIRMED"?"bg-green-100 text-green-700":"bg-amber-100 text-amber-700"}`}>
                {fmt(iv.confirmationStatus)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-slate-700 flex gap-0">
        {([["timeline","Timeline"],["interviews","Interviews"],["followups","Follow-Ups"],["profile","Profile"]] as const).map(([t,label])=>(
          <button key={t} type="button" onClick={()=>setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${tab===t?"border-[#0b1a33] text-[#0b1a33] dark:border-white dark:text-white":"border-transparent text-gray-500 hover:text-gray-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {tab === "timeline" && (
        <div className="space-y-2">
          {c.activities.length === 0 && <div className="text-sm text-gray-400 text-center py-6">No activity logged yet.</div>}
          {c.activities.map(a => (
            <div key={a.id} className="flex gap-3 text-sm">
              <div className="text-xs text-gray-400 w-28 shrink-0 pt-0.5">
                {new Date(a.createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}<br/>
                <span className="text-[10px]">{new Date(a.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span>
              </div>
              <div className="flex-1 bg-gray-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-gray-800 dark:text-slate-200">{ACT_LABEL[a.type] ?? fmt(a.type)}</span>
                  {a.user && <span className="text-[10px] text-gray-400">· {a.user.name}</span>}
                  {a.newStatus && a.oldStatus && a.oldStatus !== a.newStatus && (
                    <span className="text-[10px] text-gray-400">· {fmt(a.oldStatus)} → {fmt(a.newStatus)}</span>
                  )}
                </div>
                {a.notes && <div className="text-xs text-gray-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{a.notes}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Interviews */}
      {tab === "interviews" && (
        <div className="space-y-3">
          {c.interviews.length === 0 && <div className="text-sm text-gray-400 text-center py-6">No interviews scheduled yet.</div>}
          {c.interviews.map(iv => (
            <div key={iv.id} className="card p-4 border border-[#e5e7eb]">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold text-sm">{fmt(iv.type)} Interview</div>
                  <div className="text-xs text-gray-500">{fmtDate(iv.scheduledAt)}</div>
                  {iv.interviewer && <div className="text-xs text-gray-500">Interviewer: {iv.interviewer.name}</div>}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${iv.confirmationStatus==="CONFIRMED"?"bg-green-100 text-green-700":"bg-amber-100 text-amber-700"}`}>{fmt(iv.confirmationStatus)}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${iv.attendanceStatus==="ATTENDED"?"bg-green-100 text-green-700":iv.attendanceStatus==="NO_SHOW"?"bg-red-100 text-red-700":"bg-gray-100 text-gray-600"}`}>{fmt(iv.attendanceStatus)}</span>
                </div>
              </div>
              {iv.notes && <div className="text-xs text-gray-600 mt-2">{iv.notes}</div>}
              {iv.result && <div className="text-xs text-gray-600 mt-1">Result: <b>{iv.result}</b></div>}
            </div>
          ))}
        </div>
      )}

      {/* Follow-ups */}
      {tab === "followups" && (
        <div className="space-y-2">
          {c.followUps.length === 0 && <div className="text-sm text-gray-400 text-center py-6">No follow-ups created yet.</div>}
          {c.followUps.map(fu => {
            const d = new Date(fu.dueAt);
            const overdue = !fu.completedAt && d < now;
            return (
              <div key={fu.id} className={`card p-3 border ${fu.completedAt?"border-green-200 bg-green-50/30 opacity-70":"overdue"===String(overdue)?"border-red-200 bg-red-50/30":"border-amber-200 bg-amber-50/30"}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <span className="text-xs font-semibold">{fmt(fu.type)}</span>
                    {fu.autoCreated && <span className="text-[10px] ml-1.5 text-gray-400">· auto</span>}
                    <div className={`text-[11px] mt-0.5 ${fu.completedAt?"text-green-600":overdue?"text-red-600 font-semibold":"text-amber-700"}`}>
                      {fu.completedAt ? `✔ Done ${new Date(fu.completedAt).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}` : `${overdue?"⚠ Overdue — ":""}${d.toLocaleDateString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}`}
                    </div>
                    {fu.notes && <div className="text-[11px] text-gray-500 mt-0.5">{fu.notes}</div>}
                  </div>
                  {!fu.completedAt && (
                    <button type="button" disabled={busy} onClick={() => completeFollowUp(fu.id)}
                      className="text-xs px-2.5 py-1 rounded border border-green-300 bg-white text-green-700 hover:bg-green-50 shrink-0">
                      ✔ Mark Done
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Profile */}
      {tab === "profile" && (
        <div className="card p-4 space-y-3">
          {[
            ["Name", c.name], ["Phone", c.phone], ["Alt Phone", c.altPhone],
            ["WhatsApp", c.whatsappPhone], ["Email", c.email], ["Location", c.location],
            ["Company", c.currentCompany], ["Profile / Role", c.currentProfile],
            ["Experience", c.experience], ["Current Salary", fmtSalary(c.currentSalary)],
            ["Expected Salary", fmtSalary(c.expectedSalary)], ["Notice Period", c.noticePeriod],
            ["Source", c.source], ["Tags", c.tags], ["Remarks", c.remarks],
            ["Primary Owner", c.primaryOwner?.name], ["Secondary Owner", c.secondaryOwner?.name],
          ].map(([label, val]) => val ? (
            <div key={label} className="flex gap-3 text-sm border-b border-gray-100 dark:border-slate-700 pb-2">
              <span className="w-36 shrink-0 text-gray-500 text-xs font-medium">{label}</span>
              <span className="text-gray-800 dark:text-slate-200 whitespace-pre-wrap">{val}</span>
            </div>
          ) : null)}
        </div>
      )}
    </div>
  );
}
