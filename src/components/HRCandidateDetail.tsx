"use client";
import { useState, useTransition, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import HRResumeUploadWidget from "@/components/HRResumeUploadWidget";
import HRCandidateVoice from "@/components/HRCandidateVoice";
import HRWhatsAppTemplatePicker, { type HRTemplateContext } from "@/components/HRWhatsAppTemplatePicker";
import { ACTIVE_STATUS_DEFS, CLOSED_STATUS_DEFS, statusColor, statusLabel, displayStatus } from "@/lib/hrStatus";
import type { HRCandidateStatus, HRActivityType, HRFollowUpType, HRInterviewType } from "@prisma/client";
import {
  Phone, PhoneOff, PhoneMissed, PhoneCall, MessageSquare, Mail, MapPin, Pencil, Check, X,
  CalendarClock, CalendarPlus, ClipboardList, FileText, Paperclip, Clock, ChevronDown, ChevronRight,
  PhoneForwarded, Voicemail, Ban, RotateCcw, Target, CheckCircle2, AlertTriangle, RefreshCw,
  FileSignature, XCircle, PartyPopper, CalendarCheck, StickyNote, History, User as UserIcon,
  Mic, Trash2, ClipboardCheck, Building2, Briefcase, Wallet, Award, Activity as ActivityIcon,
  Keyboard, Send,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────
interface User { id: string; name: string; }
interface Activity { id: string; type: string; notes: string|null; createdAt: string; oldStatus:string|null; newStatus:string|null; user:{name:string}|null; }
interface Interview { id: string; type: string; scheduledAt: string; confirmationStatus: string; attendanceStatus: string; result: string|null; recommendation: string|null; notes: string|null; noShowReason: string|null; interviewer: {name:string}|null; }
interface FollowUp { id: string; type: string; dueAt: string; completedAt: string|null; notes: string|null; autoCreated: boolean; user: {name:string}|null; }
interface Resume { id: string; filename: string; url: string; mimeType: string; isActive: boolean; createdAt: string; }
interface Application { id: string; positionApplied: string; source: string; locationPreference: string|null; experience: string|null; statusAtApply: string; submittedAt: string; }
interface VoiceMessage { id: string; kind: string; createdById: string; title: string|null; textNote: string|null; transcript: string|null; durationSec: number|null; escalationId: string|null; createdAt: string; }
interface Escalation { id: string; reason: string; status: string; raisedById: string; resolvedAt: string|null; createdAt: string; }
interface Candidate {
  id: string; name: string; phone: string|null; altPhone: string|null; whatsappPhone: string|null;
  email: string|null; location: string|null; city: string|null; currentCompany: string|null; currentProfile: string|null;
  positionApplied: string|null; experience: string|null; realEstateExperience: string|null;
  currentSalary: number|null; expectedSalary: number|null; noticePeriod: string|null;
  source: string|null; status: HRCandidateStatus; originalStatus: string|null; remarks: string|null; rawRemarks: string|null; tags: string|null;
  nextAction: string|null; nextActionDate: string|null; joiningDate: string|null;
  fitExperience: string|null; fitCommunication: string|null; fitStability: string|null; fitSalary: string|null; fitNotice: string|null;
  interviewFeedback: string|null; joiningProbability: string|null;
  primaryOwnerId: string|null; secondaryOwnerId: string|null;
  primaryOwner: {id:string;name:string;avatarColor:string}|null;
  secondaryOwner: {id:string;name:string;avatarColor:string}|null;
  activities: Activity[]; interviews: Interview[]; followUps: FollowUp[]; resumes: Resume[]; applications?: Application[];
  voiceMessages?: VoiceMessage[]; escalations?: Escalation[];
}
interface VoicePerms { canGuide: boolean; canEscalate: boolean; canReview: boolean; }
interface Props { candidate: Candidate; agents: User[]; me: { id: string; name: string; role: string }; voicePerms?: VoicePerms; }

// ─── Constants ──────────────────────────────────────────────────────────────
type IconCmp = typeof Phone;
const CALL_OUTCOMES: { type: HRActivityType; label: string; icon: IconCmp; color: string }[] = [
  { type: "CALL_CONNECTED",    label: "Connected",    icon: PhoneCall,      color: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { type: "CALL_NOT_ANSWERED", label: "No Answer",    icon: PhoneMissed,    color: "bg-red-100 text-red-700 border-red-300" },
  { type: "CALL_BUSY",         label: "Busy",         icon: Clock,          color: "bg-orange-100 text-orange-700 border-orange-300" },
  { type: "CALL_SWITCHED_OFF", label: "Switched Off", icon: PhoneOff,       color: "bg-gray-100 text-gray-600 border-gray-300" },
  { type: "CALL_WRONG_NUMBER", label: "Wrong Number", icon: Ban,            color: "bg-red-200 text-red-800 border-red-400" },
  { type: "CALL_LATER",        label: "Call Later",   icon: PhoneForwarded, color: "bg-blue-100 text-blue-700 border-blue-300" },
];
const FOLLOWUP_TYPES: HRFollowUpType[] = ["CALL_BACK","INTERVIEW_CONFIRMATION","REMINDER","WHATSAPP_FOLLOWUP","SALARY_DISCUSSION","OFFER_DISCUSSION","JOINING_FOLLOWUP","NO_SHOW_RECOVERY","CUSTOM"];
const INTERVIEW_TYPES: HRInterviewType[] = ["VIRTUAL","HR","FINAL","FACE_TO_FACE"];
const SOURCE_OPTS  = ["Naukri","Indeed","Referral","Walk-in","LinkedIn","Database","Consultant","Email","Whatsapp","Other"].map(s=>[s,s] as [string,string]);
const NOTICE_OPTS  = ["Immediate","7 days","15 days","30 days","45 days","60 days","90 days","Serving Notice"].map(s=>[s,s] as [string,string]);
const POSITION_OPTS= ["Sales Executive","BDE","BDM","Team Leader","Manager","HR","Marketing","Other"].map(s=>[s,s] as [string,string]);
const FIT_OPTS: [string,string][]  = [["Good","Good"],["Average","Average"],["Weak","Weak"]];
const PROB_OPTS: [string,string][] = [["High","High"],["Medium","Medium"],["Low","Low"]];
const RECO_OPTS: [string,string][] = [["SELECTED","Selected"],["REJECTED","Rejected"],["HOLD","Hold"]];
const WA_TEMPLATES: { label: string; text: string }[] = [
  { label: "Intro", text: "Hi {name}, this is {recruiter} from White Collar Realty regarding a job opportunity. Is now a good time to talk?" },
  { label: "Interview", text: "Hi {name}, confirming your interview with White Collar Realty. Please reply to confirm your availability." },
  { label: "Follow-up", text: "Hi {name}, following up on your application with White Collar Realty — are you still interested in the role?" },
  { label: "Offer", text: "Hi {name}, great news — we'd like to discuss an offer with you. When can we connect?" },
  { label: "Docs", text: "Hi {name}, please share your latest resume and a convenient time for a quick call." },
];

// Timeline entry icon + label per activity type. No emoji — Lucide only.
const ACT_META: Record<string, { label: string; icon: IconCmp; tint: string }> = {
  CALL_CONNECTED:     { label: "Call — Connected",      icon: PhoneCall,     tint: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30" },
  CALL_NOT_ANSWERED:  { label: "Call — No Answer",      icon: PhoneMissed,   tint: "text-red-600 bg-red-50 dark:bg-red-900/30" },
  CALL_BUSY:          { label: "Call — Busy",           icon: Clock,         tint: "text-orange-600 bg-orange-50 dark:bg-orange-900/30" },
  CALL_SWITCHED_OFF:  { label: "Call — Switched Off",   icon: PhoneOff,      tint: "text-gray-500 bg-gray-100 dark:bg-slate-800" },
  CALL_WRONG_NUMBER:  { label: "Wrong Number",          icon: Ban,           tint: "text-red-700 bg-red-50 dark:bg-red-900/30" },
  CALL_LATER:         { label: "Call Later",            icon: PhoneForwarded,tint: "text-blue-600 bg-blue-50 dark:bg-blue-900/30" },
  WHATSAPP_SENT:      { label: "WhatsApp Sent",         icon: MessageSquare, tint: "text-green-600 bg-green-50 dark:bg-green-900/30" },
  WHATSAPP_RECEIVED:  { label: "WhatsApp Reply",        icon: MessageSquare, tint: "text-teal-600 bg-teal-50 dark:bg-teal-900/30" },
  EMAIL_LOGGED:       { label: "Email Logged",          icon: Mail,          tint: "text-blue-600 bg-blue-50 dark:bg-blue-900/30" },
  INTERVIEW_SCHEDULED:{ label: "Interview Scheduled",   icon: Target,        tint: "text-purple-600 bg-purple-50 dark:bg-purple-900/30" },
  INTERVIEW_ATTENDED: { label: "Interview Result",      icon: CheckCircle2,  tint: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30" },
  INTERVIEW_NO_SHOW:  { label: "No Show",               icon: AlertTriangle, tint: "text-amber-600 bg-amber-50 dark:bg-amber-900/30" },
  INTERVIEW_RESCHEDULED:{ label: "Interview Rescheduled",icon: RefreshCw,    tint: "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30" },
  OFFER_RELEASED:     { label: "Offer Released",        icon: FileSignature, tint: "text-amber-600 bg-amber-50 dark:bg-amber-900/30" },
  OFFER_DECLINED:     { label: "Offer Declined",        icon: XCircle,       tint: "text-orange-600 bg-orange-50 dark:bg-orange-900/30" },
  CANDIDATE_JOINED:   { label: "Joined",                icon: PartyPopper,   tint: "text-green-600 bg-green-50 dark:bg-green-900/30" },
  FOLLOWUP_CREATED:   { label: "Follow-up Set",         icon: CalendarPlus,  tint: "text-amber-600 bg-amber-50 dark:bg-amber-900/30" },
  FOLLOWUP_COMPLETED: { label: "Follow-up Done",        icon: CalendarCheck, tint: "text-green-600 bg-green-50 dark:bg-green-900/30" },
  STATUS_CHANGED:     { label: "Status Changed",        icon: RotateCcw,     tint: "text-slate-600 bg-slate-100 dark:bg-slate-800" },
  NOTE_ADDED:         { label: "Note / Remark",         icon: StickyNote,    tint: "text-amber-600 bg-amber-50 dark:bg-amber-900/30" },
};
function actMeta(t: string) { return ACT_META[t] ?? { label: fmt(t), icon: ActivityIcon, tint: "text-slate-600 bg-slate-100 dark:bg-slate-800" }; }

function fmt(s: string) { return s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()); }
function fmtDate(s: string) { return new Date(s).toLocaleString("en-IN",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Kolkata"}); }
function fmtDayTime(s: string) { return new Date(s).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Kolkata"}); }
function fmtTime(s: string) { return new Date(s).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Kolkata"}); }
function fmtDayLong(s: string) { return new Date(s).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Kolkata"}); }
function fmtSalary(n: number|null) { if(!n) return ""; return n>=100000?`₹${(n/100000).toFixed(1)}L`:`₹${(n/1000).toFixed(0)}K`; }
function fmtDur(s: number|null) { if(!s||s<=0) return ""; const m=Math.floor(s/60); return `${m}:${String(s%60).padStart(2,"0")}`; }
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
  const mini = "w-full border border-gray-200 rounded px-2 py-1 text-xs dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100";

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
        className="group text-left text-sm text-gray-800 dark:text-slate-100 hover:bg-blue-50/60 dark:hover:bg-slate-800 rounded px-1 -mx-1 w-full truncate flex items-center">
        <span className={empty ? "text-gray-300 dark:text-slate-600 italic" : ""}>{empty ? "add" : (format ? format(value as string | number) : String(value))}</span>
        <Pencil size={10} className="opacity-0 group-hover:opacity-100 text-blue-500 ml-1 shrink-0" />
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
      <button type="button" disabled={saving} onClick={save} className="text-green-600 px-1 shrink-0"><Check size={14} /></button>
      <button type="button" onClick={() => setEditing(false)} className="text-gray-400 px-1 shrink-0"><X size={14} /></button>
    </div>
  );
}

// ─── Card primitives (density v1) ─────────────────────────────────────────────
function Card({ title, icon: Icon, action, children, className = "" }: { title?: string; icon?: IconCmp; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card p-4 ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">
            {Icon && <Icon size={13} />}{title}
          </div>
          {action}
        </div>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1 border-b border-gray-50 dark:border-slate-800/60 last:border-0">
      <span className="text-[11px] text-gray-400 dark:text-slate-500 shrink-0 w-24">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
function FitPill({ value }: { value: string | null }) {
  if (!value) return <span className="text-gray-300 dark:text-slate-600 italic text-xs">add</span>;
  const cls = value === "Good" || value === "High" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    : value === "Average" || value === "Medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  return <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded-full ${cls}`}>{value}</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function HRCandidateDetail({ candidate: c, agents, me, voicePerms }: Props) {
  const router = useRouter();
  const [, startT] = useTransition();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"timeline"|"interviews"|"followups"|"resumes"|"applications">("timeline");
  const [mobilePane, setMobilePane] = useState<"activity"|"info">("activity");
  const [panel, setPanel] = useState<"none"|"call"|"wa"|"followup"|"interview"|"status"|"note">("none");
  const [rawOpen, setRawOpen] = useState(false);
  const [resultFor, setResultFor] = useState<string|null>(null);
  const [resReco, setResReco] = useState(""); const [resResult, setResResult] = useState(""); const [resNotes, setResNotes] = useState("");

  const [callNotes, setCallNotes] = useState(""); const [callNext, setCallNext] = useState(""); const [callNextDate, setCallNextDate] = useState("");
  const [waNotes, setWaNotes] = useState("");
  const [fuType, setFuType] = useState<HRFollowUpType>("CALL_BACK"); const [fuDate, setFuDate] = useState(""); const [fuNotes, setFuNotes] = useState("");
  const [ivType, setIvType] = useState<HRInterviewType>("HR"); const [ivDate, setIvDate] = useState(""); const [ivInterviewer, setIvInterviewer] = useState(me.id); const [ivNotes, setIvNotes] = useState("");
  const [newStatus, setNewStatus] = useState<HRCandidateStatus>(c.status); const [statusNote, setStatusNote] = useState("");
  const [noteText, setNoteText] = useState("");
  // WhatsApp quick-send template picker (overlay) + shortcuts help + non-blocking
  // interview conflict warning (set when the interview API returns { conflict }).
  const [waPickerOpen, setWaPickerOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [ivConflict, setIvConflict] = useState<string|null>(null);
  // Refs so keyboard shortcuts can focus the first field of a just-opened panel.
  const callNotesRef = useRef<HTMLTextAreaElement>(null);
  const noteTextRef = useRef<HTMLTextAreaElement>(null);
  // WhatsApp target number (declared early so the keyboard-shortcut effect can
  // depend on it without a temporal-dead-zone error).
  const waPhone = c.whatsappPhone ?? c.phone ?? "";

  useEffect(() => {
    const doParam = new URLSearchParams(window.location.search).get("do");
    if (doParam === "interview") setPanel("interview");
    else if (doParam === "followup") setPanel("followup");
    else if (doParam === "note") setPanel("note");
    else if (doParam === "resume") setTab("resumes");
  }, []);

  // ── Keyboard shortcuts (guarded against firing while typing) ──
  // c = log call · w = WhatsApp quick-send · f = new follow-up · e = edit
  // (status) · i = schedule interview · n = add note · ? = shortcuts help.
  const focusSoon = useCallback((ref: React.RefObject<HTMLTextAreaElement | null>) => {
    setTimeout(() => ref.current?.focus(), 40);
  }, []);
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      // Don't hijack when the user is typing or using modifier combos.
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const el = ev.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      switch (ev.key) {
        case "c": case "C": ev.preventDefault(); setPanel(p => p === "call" ? "none" : "call"); focusSoon(callNotesRef); break;
        case "w": case "W": if (waPhone) { ev.preventDefault(); setWaPickerOpen(true); } break;
        case "f": case "F": ev.preventDefault(); setPanel(p => p === "followup" ? "none" : "followup"); break;
        case "i": case "I": ev.preventDefault(); setPanel(p => p === "interview" ? "none" : "interview"); break;
        case "n": case "N": ev.preventDefault(); setPanel(p => p === "note" ? "none" : "note"); focusSoon(noteTextRef); break;
        case "e": case "E": ev.preventDefault(); setPanel(p => p === "status" ? "none" : "status"); break;
        case "?": ev.preventDefault(); setShowShortcuts(s => !s); break;
        case "Escape": setShowShortcuts(false); setWaPickerOpen(false); break;
        default: break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [waPhone, focusSoon]);

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
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/candidates/${c.id}/interview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: ivType, scheduledAt: ivDate, interviewerId: ivInterviewer, notes: ivNotes||null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Failed");
      // The interview still SAVED even when a conflict is reported — show a
      // non-blocking amber warning rather than failing the action.
      if (data?.conflict) {
        const cf = data.conflict;
        setIvConflict(typeof cf === "string" ? cf : (cf?.message ?? cf?.with ?? "Another interview overlaps this time slot."));
      } else {
        setIvConflict(null);
      }
    } finally { setBusy(false); }
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
  async function deleteInterview(ivId: string) {
    if (!window.confirm("Delete this interview? Its open auto-created confirmation/reminder follow-ups will also be cleared.")) return;
    setBusy(true);
    try {
      await fetch(`/api/hr/candidates/${c.id}/interview?interviewId=${encodeURIComponent(ivId)}`, { method: "DELETE" });
    } finally { setBusy(false); }
    startT(() => router.refresh());
  }
  async function recordResult(ivId: string) {
    if (!resReco && !resResult.trim() && !resNotes.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/hr/candidates/${c.id}/interview`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId: ivId, action: "result", recommendation: resReco || undefined, result: resResult || undefined, notes: resNotes || undefined }),
      });
    } finally { setBusy(false); }
    setResultFor(null); setResReco(""); setResResult(""); setResNotes(""); startT(() => router.refresh());
  }

  const now = new Date();
  const pendingFollowUps = c.followUps.filter(f => !f.completedAt).sort((a,b) => +new Date(a.dueAt) - +new Date(b.dueAt));
  const upcomingInterviews = c.interviews.filter(i => i.attendanceStatus === "SCHEDULED" || i.attendanceStatus === "RESCHEDULED").sort((a,b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
  const nextFU = pendingFollowUps[0];
  const nextIV = upcomingInterviews[0] ?? c.interviews[0];
  const activeResume = c.resumes.find(r => r.isActive) ?? c.resumes[0];
  const ownerOpts = agents.map(a => [a.id, a.name] as [string, string]);
  const ownerName = (id: string | number) => agents.find(a => a.id === String(id))?.name ?? "—";
  const userName = (id: string) => agents.find(a => a.id === id)?.name ?? "Someone";
  const fillTpl = (s: string) => s.replace(/\{name\}/g, c.name.split(" ")[0]).replace(/\{recruiter\}/g, me.name.split(" ")[0]);
  const lastAct = c.activities[0];

  // Candidate context for the WhatsApp template picker's variable substitution.
  const waCtx: HRTemplateContext = {
    name: c.name,
    firstName: c.name.split(" ")[0],
    phone: c.phone,
    whatsappPhone: c.whatsappPhone,
    email: c.email,
    position: c.positionApplied,
    company: c.currentCompany,
    city: c.city,
    location: c.location,
    recruiter: me.name,
    recruiterFirst: me.name.split(" ")[0],
  };

  // Quick-send: open wa.me with the rendered text AND log the WhatsApp activity
  // (keeps the existing manual "Log WA" flow working too). The picker hands us
  // the final rendered string; we open WhatsApp then POST the same /log entry.
  async function quickSendWA(renderedText: string) {
    if (waPhone) {
      window.open(`https://wa.me/${waPhone.replace(/\D/g,"")}?text=${encodeURIComponent(renderedText)}`, "_blank", "noopener,noreferrer");
    }
    await post("/log", { type: "WHATSAPP_SENT", notes: renderedText || null });
    startT(() => router.refresh());
  }
  const activeStatusDefs = me.role === "AGENT" ? ACTIVE_STATUS_DEFS.filter(s => s.key !== "OFFER_RELEASED") : ACTIVE_STATUS_DEFS;

  // ── Unified conversation timeline: activities + interviews + voice, newest first ──
  type Entry = { id: string; at: string; icon: IconCmp; tint: string; title: string; by: string|null; detail: string|null; meta: string|null };
  const timeline = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const a of c.activities) {
      const m = actMeta(a.type);
      const statusChange = a.oldStatus && a.newStatus && a.oldStatus !== a.newStatus ? `${statusLabel(a.oldStatus)} → ${statusLabel(a.newStatus)}` : null;
      out.push({ id: `act-${a.id}`, at: a.createdAt, icon: m.icon, tint: m.tint, title: m.label, by: a.user?.name ?? null, detail: a.notes, meta: statusChange });
    }
    for (const iv of c.interviews) {
      // Scheduled marker (the schedule itself; result/no-show land via activities).
      out.push({
        id: `iv-${iv.id}`, at: iv.scheduledAt, icon: Target, tint: "text-purple-600 bg-purple-50 dark:bg-purple-900/30",
        title: `${fmt(iv.type)} Interview`, by: iv.interviewer?.name ?? null,
        detail: iv.notes,
        meta: [fmt(iv.confirmationStatus), fmt(iv.attendanceStatus), iv.recommendation ? `Reco: ${fmt(iv.recommendation)}` : null].filter(Boolean).join(" · "),
      });
    }
    for (const v of (c.voiceMessages ?? [])) {
      const isGuide = v.kind === "GUIDANCE";
      out.push({
        id: `voice-${v.id}`, at: v.createdAt, icon: isGuide ? Mic : AlertTriangle,
        tint: isGuide ? "text-[#0b1a33] bg-blue-50 dark:bg-blue-900/30" : "text-amber-600 bg-amber-50 dark:bg-amber-900/30",
        title: isGuide ? "Voice Guidance" : v.kind === "ESCALATION_REPLY" ? "Escalation Reply" : "Escalation Raised",
        by: userName(v.createdById),
        detail: v.transcript || v.textNote || v.title || "(voice message)",
        meta: v.durationSec ? fmtDur(v.durationSec) : null,
      });
    }
    return out.sort((a, b) => +new Date(b.at) - +new Date(a.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.activities, c.interviews, c.voiceMessages]);

  // Group timeline by IST day (newest first).
  const timelineGroups = useMemo(() => {
    const groups: { day: string; items: Entry[] }[] = [];
    for (const e of timeline) {
      const day = fmtDayLong(e.at);
      const g = groups.find(x => x.day === day);
      if (g) g.items.push(e); else groups.push({ day, items: [e] });
    }
    return groups;
  }, [timeline]);

  const btn = "btn text-sm border rounded-lg gap-1.5 inline-flex items-center";

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-4">
      {/* ── Top summary card ── */}
      <div className="card p-4 sm:p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <div className="text-xl font-bold text-gray-900 dark:text-white"><InlineField candidateId={c.id} field="name" value={c.name} /></div>
            <div className="text-sm text-gray-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
              {c.positionApplied && <span className="text-[#0b1a33] dark:text-blue-300 font-medium inline-flex items-center gap-1"><Briefcase size={12} />Applied: {c.positionApplied}</span>}
              {c.currentProfile && <span>{c.currentProfile}</span>}
              {c.currentCompany && <span className="inline-flex items-center gap-1"><Building2 size={12} />{c.currentCompany}</span>}
            </div>
            <div className="flex gap-3 mt-1.5 text-xs text-gray-500 dark:text-slate-400 flex-wrap">
              {c.phone && <a href={`tel:${c.phone}`} className="hover:text-blue-600 inline-flex items-center gap-1"><Phone size={12} />{c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="hover:text-blue-600 inline-flex items-center gap-1"><Mail size={12} />{c.email}</a>}
              {c.location && <span className="inline-flex items-center gap-1"><MapPin size={12} />{c.location}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <button type="button" onClick={() => setPanel(p => p==="status"?"none":"status")} title="Change status"
              className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold ${statusColor(c.status)} hover:opacity-80`}>
              {displayStatus(c)} <ChevronDown size={12} />
            </button>
            <Link href={`/hr/candidates/${c.id}/timeline`} className="text-[11px] text-blue-600 hover:underline">Full timeline →</Link>
            {lastAct?.user && <span className="text-[10px] text-gray-400 inline-flex items-center gap-1"><Pencil size={9} />{lastAct.user.name.split(" ")[0]} · {timeAgo(lastAct.createdAt)}</span>}
          </div>
        </div>

        {/* Quick contact + action buttons */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {c.phone && <a href={`tel:${c.phone}`} className={`${btn} border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800`}><Phone size={14} />Call</a>}
          {waPhone && <a href={`https://wa.me/${waPhone.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" className={`${btn} border-green-300 text-green-700 hover:bg-green-50`}><MessageSquare size={14} />WhatsApp</a>}
          {waPhone && <button type="button" onClick={() => setWaPickerOpen(true)} className={`${btn} border-green-300 text-green-700 hover:bg-green-50`}><Send size={14} />Quick WA</button>}
          {waPhone && <button type="button" onClick={() => setPanel(p => p==="wa"?"none":"wa")} className={`${btn} border-green-300 text-green-700 hover:bg-green-50`}><MessageSquare size={14} />Log WA</button>}
          {c.email && <a href={`mailto:${c.email}`} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-50`}><Mail size={14} />Email</a>}
          <button type="button" onClick={() => setPanel(p => p==="call"?"none":"call")} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-50`}><PhoneCall size={14} />Log Call</button>
          <button type="button" onClick={() => setPanel(p => p==="note"?"none":"note")} className={`${btn} border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800`}><StickyNote size={14} />Add Note</button>
          <button type="button" onClick={() => setPanel(p => p==="interview"?"none":"interview")} className={`${btn} border-purple-300 text-purple-700 hover:bg-purple-50`}><Target size={14} />Schedule Interview</button>
          <button type="button" onClick={() => setPanel(p => p==="followup"?"none":"followup")} className={`${btn} border-amber-300 text-amber-700 hover:bg-amber-50`}><CalendarPlus size={14} />Add Follow-Up</button>
          <button type="button" onClick={() => setTab("resumes")} className={`${btn} border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800`}><Paperclip size={14} />Upload Resume</button>
          {/* Keyboard-shortcuts hint — opens the help overlay; also bound to "?". */}
          <button type="button" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts (?)"
            className="hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-400 dark:text-slate-500 hover:bg-gray-50 dark:hover:bg-slate-800 ml-auto">
            <Keyboard size={13} />Shortcuts (?)
          </button>
        </div>

        {/* Action panels */}
        {panel === "call" && (
          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-blue-800 dark:text-blue-300">Log Call — outcome:</div>
            <div className="flex flex-wrap gap-2">
              {CALL_OUTCOMES.map(o => { const Ic=o.icon; return <button key={o.type} type="button" disabled={busy} onClick={() => logCall(o.type)} className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border font-medium ${o.color} hover:opacity-80`}><Ic size={13} />{o.label}</button>; })}
            </div>
            <textarea ref={callNotesRef} value={callNotes} onChange={e=>setCallNotes(e.target.value)} placeholder="Notes…" rows={2} className={inp} />
            <div className="flex gap-2">
              <input className={`${inp} flex-1`} placeholder="Next action" value={callNext} onChange={e=>setCallNext(e.target.value)} />
              <input className={`${inp} flex-1`} type="datetime-local" value={callNextDate} onChange={e=>setCallNextDate(e.target.value)} />
            </div>
          </div>
        )}
        {panel === "wa" && (
          <div className="mt-3 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-lg space-y-2">
            <div className="text-[11px] text-green-800 dark:text-green-300 font-semibold">Templates — tap to open WhatsApp &amp; pre-fill the log:</div>
            <div className="flex flex-wrap gap-1.5">
              {WA_TEMPLATES.map(t => (
                <a key={t.label} href={`https://wa.me/${waPhone.replace(/\D/g,"")}?text=${encodeURIComponent(fillTpl(t.text))}`}
                  target="_blank" rel="noopener noreferrer" onClick={() => setWaNotes(fillTpl(t.text))}
                  className="text-[11px] px-2 py-1 rounded-full border border-green-300 bg-white dark:bg-slate-800 text-green-700 dark:text-green-300 hover:bg-green-100">{t.label}</a>
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
          <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select className={inp} value={fuType} onChange={e=>setFuType(e.target.value as HRFollowUpType)}>{FOLLOWUP_TYPES.map(t=><option key={t} value={t}>{fmt(t)}</option>)}</select>
              <input className={inp} type="datetime-local" value={fuDate} onChange={e=>setFuDate(e.target.value)} />
            </div>
            <input className={inp} placeholder="Note (optional)" value={fuNotes} onChange={e=>setFuNotes(e.target.value)} />
            <div className="flex gap-1.5 flex-wrap text-[11px]">
              {[["30 min","30"],["1 hour","60"],["2 hours","120"],["Tomorrow","1440"]].map(([label,mins])=>(
                <button key={mins} type="button" onClick={() => setFuDate(new Date(Date.now()+parseInt(mins)*60000).toISOString().slice(0,16))} className="px-2 py-0.5 rounded border border-amber-300 bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-300 hover:bg-amber-100">{label}</button>
              ))}
            </div>
            <button type="button" disabled={busy || !fuDate} onClick={createFollowUp} className="btn text-sm bg-amber-500 text-white hover:bg-amber-600">Save Follow-Up</button>
          </div>
        )}
        {panel === "interview" && (
          <div className="mt-3 p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900 rounded-lg space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <select className={inp} value={ivType} onChange={e=>setIvType(e.target.value as HRInterviewType)}>{INTERVIEW_TYPES.map(t=><option key={t} value={t}>{fmt(t)}</option>)}</select>
              <input className={inp} type="datetime-local" value={ivDate} onChange={e=>setIvDate(e.target.value)} />
              <select className={inp} value={ivInterviewer} onChange={e=>setIvInterviewer(e.target.value)}>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </div>
            <textarea value={ivNotes} onChange={e=>setIvNotes(e.target.value)} placeholder="Notes / format…" rows={2} className={inp} />
            <div className="text-[11px] text-purple-700 dark:text-purple-300 inline-flex items-center gap-1"><CheckCircle2 size={12} />Confirmation follow-up + morning reminder auto-created.</div>
            <button type="button" disabled={busy || !ivDate} onClick={scheduleInterview} className="btn text-sm bg-purple-600 text-white hover:bg-purple-700">Schedule</button>
          </div>
        )}
        {panel === "status" && (
          <div className="mt-3 p-3 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-lg space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 mb-1 uppercase">Active</div>
                {activeStatusDefs.map(({key,label})=><button key={key} type="button" onClick={()=>setNewStatus(key)} className={`block w-full text-left px-2 py-1 rounded text-xs mb-0.5 ${newStatus===key?"bg-blue-100 text-blue-800 font-semibold":"hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300"}`}>{label}</button>)}
              </div>
              <div><div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 mb-1 uppercase">Closed</div>
                {CLOSED_STATUS_DEFS.map(({key,label})=><button key={key} type="button" onClick={()=>setNewStatus(key)} className={`block w-full text-left px-2 py-1 rounded text-xs mb-0.5 ${newStatus===key?"bg-red-100 text-red-800 font-semibold":"hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300"}`}>{label}</button>)}
              </div>
            </div>
            <input className={inp} placeholder="Reason / note (optional)" value={statusNote} onChange={e=>setStatusNote(e.target.value)} />
            <button type="button" disabled={busy} onClick={updateStatus} className="btn text-sm bg-[#0b1a33] text-white hover:bg-[#1a2d4d]">Update Status</button>
          </div>
        )}
        {panel === "note" && (
          <div className="mt-3 p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg space-y-2">
            <textarea ref={noteTextRef} value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Add a remark — it becomes a timeline entry…" rows={3} className={inp} />
            <button type="button" disabled={busy||!noteText.trim()} onClick={addNote} className="btn text-sm bg-amber-500 text-white hover:bg-amber-600">Save Note</button>
          </div>
        )}

        {/* Non-blocking interview conflict warning — the interview still SAVED. */}
        {ivConflict && (
          <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs text-amber-800 dark:text-amber-200">
              <span className="font-semibold">Scheduling conflict — </span>the interview was still saved, but the slot overlaps another booking: {ivConflict}
            </div>
            <button type="button" onClick={() => setIvConflict(null)} className="text-amber-500 hover:text-amber-700 shrink-0" aria-label="Dismiss"><X size={14} /></button>
          </div>
        )}
      </div>

      {/* ── Mobile pane switcher (cards stack on small screens) ── */}
      <div className="lg:hidden flex rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden text-sm font-medium">
        <button type="button" onClick={()=>setMobilePane("activity")} className={`flex-1 py-2 ${mobilePane==="activity"?"bg-[#0b1a33] text-white":"text-gray-600 dark:text-slate-300"}`}>Activity</button>
        <button type="button" onClick={()=>setMobilePane("info")} className={`flex-1 py-2 ${mobilePane==="info"?"bg-[#0b1a33] text-white":"text-gray-600 dark:text-slate-300"}`}>Details</button>
      </div>

      {/* ── 2-column body ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Main column */}
        <div className={`lg:col-span-2 space-y-4 ${mobilePane==="activity"?"":"hidden"} lg:block`}>
          {pendingFollowUps.length > 0 && (
            <div className="card p-3 border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-950/20">
              <div className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2 inline-flex items-center gap-1"><CalendarClock size={13} />Pending Follow-Ups ({pendingFollowUps.length})</div>
              <div className="space-y-1.5">
                {pendingFollowUps.slice(0,3).map(fu => { const d=new Date(fu.dueAt); const overdue=d<now; return (
                  <div key={fu.id} className="flex items-center justify-between gap-2">
                    <div className="text-xs"><span className={overdue?"text-red-600 font-semibold inline-flex items-center gap-0.5":"text-amber-700 dark:text-amber-300"}>{overdue&&<AlertTriangle size={11} />}{overdue?"Overdue — ":""}{fmtDayTime(fu.dueAt)}</span><span className="text-gray-500 dark:text-slate-400 ml-1.5">{fmt(fu.type)}</span>{fu.notes && <span className="text-gray-400 ml-1">· {fu.notes}</span>}</div>
                    <button type="button" disabled={busy} onClick={() => completeFollowUp(fu.id)} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-green-300 bg-white dark:bg-slate-800 text-green-700 dark:text-green-300 hover:bg-green-50 shrink-0"><Check size={11} />Done</button>
                  </div>
                ); })}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-slate-700 flex gap-0 overflow-x-auto">
            {([["timeline","Conversation"],["interviews",`Interviews${c.interviews.length?` (${c.interviews.length})`:""}`],["followups","Follow-Ups"],["resumes","Resumes"],...(c.applications?.length?[["applications",`Applications (${c.applications.length})`]]:[])] as [typeof tab,string][]).map(([t,label])=>(
              <button key={t} type="button" onClick={()=>setTab(t)} className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab===t?"border-[#0b1a33] text-[#0b1a33] dark:border-white dark:text-white":"border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-slate-300"}`}>{label}</button>
            ))}
          </div>

          {/* ── UNIFIED CONVERSATION TIMELINE ── */}
          {tab === "timeline" && (
            <div className="space-y-5">
              {timeline.length === 0 && <div className="text-sm text-gray-400 text-center py-8">No activity, interviews or voice messages yet.</div>}
              {timelineGroups.map(g => (
                <div key={g.day}>
                  <div className="text-[11px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-2">{g.day}</div>
                  <div className="space-y-2">
                    {g.items.map(e => { const Ic=e.icon; return (
                      <div key={e.id} className="flex gap-2.5 text-sm">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${e.tint}`}><Ic size={14} /></div>
                        <div className="flex-1 min-w-0 bg-gray-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-gray-800 dark:text-slate-100">{e.title}</span>
                            <span className="text-[10px] text-gray-400">{fmtTime(e.at)}</span>
                            {e.by && <span className="text-[10px] text-gray-400">· {e.by.split(" ")[0]}</span>}
                            {e.meta && <span className="text-[10px] text-gray-400">· {e.meta}</span>}
                          </div>
                          {e.detail && <div className="text-xs text-gray-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{e.detail}</div>}
                        </div>
                      </div>
                    ); })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Interviews (result display + record-result + delete) ── */}
          {tab === "interviews" && (
            <div className="space-y-3">
              {c.interviews.length === 0 && <div className="text-sm text-gray-400 text-center py-6">No interviews yet.</div>}
              {c.interviews.map(iv => (
                <div key={iv.id} className="card p-4 border border-[#e5e7eb] dark:border-slate-700">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <div className="font-semibold text-sm inline-flex items-center gap-1.5"><Target size={14} className="text-purple-600" />{fmt(iv.type)} Interview</div>
                      <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{fmtDate(iv.scheduledAt)}</div>
                      {iv.interviewer && <div className="text-xs text-gray-500 dark:text-slate-400">Interviewer: {iv.interviewer.name}</div>}
                    </div>
                    <div className="flex gap-1.5 flex-wrap items-start">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${iv.confirmationStatus==="CONFIRMED"?"bg-green-100 text-green-700":"bg-amber-100 text-amber-700"}`}>{fmt(iv.confirmationStatus)}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${iv.attendanceStatus==="ATTENDED"?"bg-green-100 text-green-700":iv.attendanceStatus==="NO_SHOW"?"bg-red-100 text-red-700":"bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300"}`}>{fmt(iv.attendanceStatus)}</span>
                    </div>
                  </div>

                  {/* Result / recommendation display */}
                  {(iv.recommendation || iv.result) && (
                    <div className="mt-2 rounded-lg bg-gray-50 dark:bg-slate-800/50 px-3 py-2 text-xs space-y-1">
                      {iv.recommendation && (
                        <div className="flex items-center gap-1.5">
                          <Award size={13} className="text-gray-400" />
                          <span className="text-gray-500 dark:text-slate-400">Recommendation:</span>
                          <span className={`font-semibold px-1.5 py-0.5 rounded-full text-[10px] ${iv.recommendation==="SELECTED"?"bg-emerald-100 text-emerald-700":iv.recommendation==="REJECTED"?"bg-red-100 text-red-700":"bg-orange-100 text-orange-700"}`}>{fmt(iv.recommendation)}</span>
                        </div>
                      )}
                      {iv.result && <div className="text-gray-600 dark:text-slate-300"><span className="text-gray-400">Result:</span> {iv.result}</div>}
                    </div>
                  )}
                  {iv.notes && <div className="text-xs text-gray-600 dark:text-slate-300 mt-2 whitespace-pre-wrap">{iv.notes}</div>}
                  {iv.noShowReason && <div className="text-xs text-red-600 mt-1">No-show: {iv.noShowReason}</div>}

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                    <button type="button" onClick={() => { setResultFor(resultFor===iv.id?null:iv.id); setResReco(iv.recommendation??""); setResResult(iv.result??""); setResNotes(""); }}
                      className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"><ClipboardCheck size={13} />{iv.recommendation||iv.result?"Update Result":"Record Result"}</button>
                    <button type="button" disabled={busy} onClick={() => deleteInterview(iv.id)} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 size={13} />Delete</button>
                  </div>

                  {/* Inline record-result form */}
                  {resultFor === iv.id && (
                    <div className="mt-2.5 p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select className={inp} value={resReco} onChange={e=>setResReco(e.target.value)}>
                          <option value="">Recommendation…</option>
                          {RECO_OPTS.map(([k,l])=><option key={k} value={k}>{l}</option>)}
                        </select>
                        <input className={inp} placeholder="Result (e.g. Strong, 7/10)" value={resResult} onChange={e=>setResResult(e.target.value)} />
                      </div>
                      <textarea className={inp} rows={2} placeholder="Feedback notes…" value={resNotes} onChange={e=>setResNotes(e.target.value)} />
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={()=>recordResult(iv.id)} className="btn text-sm bg-emerald-600 text-white hover:bg-emerald-700">Save Result</button>
                        <button type="button" onClick={()=>setResultFor(null)} className="text-xs text-gray-500 hover:text-gray-700 underline">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "followups" && (
            <div className="space-y-2">
              {c.followUps.length === 0 && <div className="text-sm text-gray-400 text-center py-6">No follow-ups yet.</div>}
              {c.followUps.map(fu => { const d=new Date(fu.dueAt); const overdue=!fu.completedAt&&d<now; return (
                <div key={fu.id} className={`card p-3 border ${fu.completedAt?"border-green-200 bg-green-50/30 dark:bg-green-950/10 opacity-70":overdue?"border-red-200 bg-red-50/30 dark:bg-red-950/10":"border-amber-200 bg-amber-50/30 dark:bg-amber-950/10"}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <span className="text-xs font-semibold">{fmt(fu.type)}</span>{fu.autoCreated && <span className="text-[10px] ml-1.5 text-gray-400">· auto</span>}
                      <div className={`text-[11px] mt-0.5 inline-flex items-center gap-0.5 ${fu.completedAt?"text-green-600":overdue?"text-red-600 font-semibold":"text-amber-700 dark:text-amber-300"}`}>{fu.completedAt ? <><Check size={11} />Done {new Date(fu.completedAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",timeZone:"Asia/Kolkata"})}</> : <>{overdue&&<AlertTriangle size={11} />}{overdue?"Overdue — ":""}{fmtDayTime(fu.dueAt)}</>}</div>
                      {fu.notes && <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{fu.notes}</div>}
                    </div>
                    {!fu.completedAt && <button type="button" disabled={busy} onClick={() => completeFollowUp(fu.id)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-green-300 bg-white dark:bg-slate-800 text-green-700 dark:text-green-300 hover:bg-green-50 shrink-0"><Check size={12} />Mark Done</button>}
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
                      <div className="text-xs text-gray-500 dark:text-slate-400">{ap.source}{ap.locationPreference ? ` · ${ap.locationPreference}` : ""}{ap.experience ? ` · ${ap.experience}` : ""}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-gray-400">{fmtDate(ap.submittedAt)}</div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium dark:bg-slate-700 dark:text-slate-300">{statusLabel(ap.statusAtApply)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === "resumes" && (
            <div className="space-y-4">
              <div className="card p-4"><div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mb-3 inline-flex items-center gap-1.5"><Paperclip size={13} />Upload Resume — PDF, DOC, image, or phone photo</div><HRResumeUploadWidget candidates={[]} preselectedCandidateId={c.id} /></div>
              {c.resumes.length === 0 ? <div className="text-sm text-gray-400 text-center py-6">No resumes uploaded yet.</div> : (
                <div className="space-y-2">{c.resumes.map(r => (
                  <div key={r.id} className="card p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0 text-red-500"><FileText size={18} /></div>
                    <div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate">{r.filename}</span>{r.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">Active</span>}</div><div className="text-[11px] text-gray-400 mt-0.5">{new Date(r.createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric",timeZone:"Asia/Kolkata"})}</div></div>
                    <a href={`/api/hr/candidates/${c.id}/resume?resumeId=${r.id}${r.mimeType.startsWith("image/") ? "" : "&download=1"}`} target="_blank" rel="noopener noreferrer" className="text-[11px] px-2.5 py-1 rounded-lg border border-blue-300 text-blue-700 bg-white dark:bg-slate-800 hover:bg-blue-50 shrink-0">{r.mimeType.startsWith("image/") ? "View" : "Download"}</a>
                  </div>
                ))}</div>
              )}
            </div>
          )}
        </div>

        {/* Right panels (Details / info) */}
        <div className={`space-y-4 ${mobilePane==="info"?"":"hidden"} lg:block`}>
          <HRCandidateVoice
            candidateId={c.id}
            canGuide={voicePerms?.canGuide ?? false}
            canEscalate={voicePerms?.canEscalate ?? false}
            canReview={voicePerms?.canReview ?? false}
          />

          <Card title="Candidate Information" icon={UserIcon}>
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
          </Card>

          <Card title="Salary & Notice" icon={Wallet}>
            <Row label="Current ₹"><InlineField candidateId={c.id} field="currentSalary" value={c.currentSalary} type="number" format={v=>fmtSalary(Number(v))} /></Row>
            <Row label="Expected ₹"><InlineField candidateId={c.id} field="expectedSalary" value={c.expectedSalary} type="number" format={v=>fmtSalary(Number(v))} /></Row>
            <Row label="Notice"><InlineField candidateId={c.id} field="noticePeriod" value={c.noticePeriod} type="select" options={NOTICE_OPTS} /></Row>
          </Card>

          <Card title="Candidate Fit" icon={Award}>
            <Row label="Experience"><FitInline candidateId={c.id} field="fitExperience" value={c.fitExperience} /></Row>
            <Row label="Communication"><FitInline candidateId={c.id} field="fitCommunication" value={c.fitCommunication} /></Row>
            <Row label="Stability"><FitInline candidateId={c.id} field="fitStability" value={c.fitStability} /></Row>
            <Row label="Salary Fit"><FitInline candidateId={c.id} field="fitSalary" value={c.fitSalary} /></Row>
            <Row label="Notice Fit"><FitInline candidateId={c.id} field="fitNotice" value={c.fitNotice} /></Row>
            <Row label="Joining Prob."><FitInline candidateId={c.id} field="joiningProbability" value={c.joiningProbability} options={PROB_OPTS} /></Row>
            <div className="pt-1.5"><div className="text-[11px] text-gray-400 mb-1">Interview Feedback</div><InlineField candidateId={c.id} field="interviewFeedback" value={c.interviewFeedback} type="textarea" placeholder="add feedback" /></div>
          </Card>

          <Card title="Interview & Follow-Up" icon={CalendarClock}>
            <Row label="Next Action"><InlineField candidateId={c.id} field="nextAction" value={c.nextAction} /></Row>
            <Row label="Follow-Up"><span className="text-sm text-gray-700 dark:text-slate-200">{nextFU ? fmtDayTime(nextFU.dueAt) : "—"}</span></Row>
            <Row label="Interview"><span className="text-sm text-gray-700 dark:text-slate-200">{nextIV ? fmtDayTime(nextIV.scheduledAt) : "—"}</span></Row>
            <Row label="Type"><span className="text-sm text-gray-700 dark:text-slate-200">{nextIV ? fmt(nextIV.type) : "—"}</span></Row>
            <Row label="Confirm"><span className="text-sm text-gray-700 dark:text-slate-200">{nextIV ? fmt(nextIV.confirmationStatus) : "—"}</span></Row>
            <Row label="Joining"><InlineField candidateId={c.id} field="joiningDate" value={c.joiningDate} type="date" format={v => new Date(v as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} /></Row>
          </Card>

          <Card title="Resume" icon={Paperclip}>
            {activeResume ? (
              <div className="flex items-center gap-2">
                <a href={`/api/hr/candidates/${c.id}/resume?resumeId=${activeResume.id}`} target="_blank" rel="noopener noreferrer" className="text-xs px-2.5 py-1 rounded-lg border border-blue-300 text-blue-700 bg-white dark:bg-slate-800 hover:bg-blue-50">View Resume</a>
                <button type="button" onClick={()=>setTab("resumes")} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800">Replace</button>
              </div>
            ) : (
              <button type="button" onClick={()=>setTab("resumes")} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800">Upload Resume</button>
            )}
          </Card>

          <Card title="Ownership" icon={UserIcon}>
            <Row label="Source"><InlineField candidateId={c.id} field="source" value={c.source} type="select" options={SOURCE_OPTS} /></Row>
            <Row label="Primary"><InlineField candidateId={c.id} field="primaryOwnerId" value={c.primaryOwnerId} type="select" options={ownerOpts} format={ownerName} /></Row>
            <Row label="Secondary"><InlineField candidateId={c.id} field="secondaryOwnerId" value={c.secondaryOwnerId} type="select" options={ownerOpts} format={ownerName} /></Row>
            {lastAct?.user && <Row label="Last touch"><span className="text-sm text-gray-700 dark:text-slate-200">{lastAct.user.name.split(" ")[0]} · {timeAgo(lastAct.createdAt)}</span></Row>}
          </Card>

          {/* ── RAW HISTORY (collapsible, read-only, verbatim import) ── */}
          {c.rawRemarks && c.rawRemarks.trim() && (
            <div className="card p-4">
              <button type="button" onClick={()=>setRawOpen(o=>!o)} className="w-full flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                <span className="inline-flex items-center gap-1.5"><History size={13} />Raw History</span>
                {rawOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {rawOpen && (
                <div className="mt-2">
                  <div className="text-[10px] text-gray-400 mb-1.5">Imported conversation history — verbatim, read-only.</div>
                  <pre className="text-xs text-gray-600 dark:text-slate-300 whitespace-pre-wrap font-sans bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 max-h-72 overflow-auto">{c.rawRemarks}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── WhatsApp quick-send template picker (overlay) ── */}
      <HRWhatsAppTemplatePicker
        open={waPickerOpen}
        onClose={() => setWaPickerOpen(false)}
        ctx={waCtx}
        waPhone={waPhone}
        onSend={(text) => quickSendWA(text)}
      />

      {/* ── Keyboard shortcuts help overlay ── */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowShortcuts(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-xs w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
              <div className="font-semibold text-sm text-gray-900 dark:text-white inline-flex items-center gap-2"><Keyboard size={16} />Keyboard shortcuts</div>
              <button type="button" onClick={() => setShowShortcuts(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-2 text-sm">
              {([
                ["c", "Log a call"],
                ["w", "WhatsApp quick-send"],
                ["f", "New follow-up"],
                ["i", "Schedule interview"],
                ["n", "Add note"],
                ["e", "Edit status"],
                ["?", "Show / hide this help"],
              ] as [string, string][]).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <span className="text-gray-600 dark:text-slate-300">{label}</span>
                  <kbd className="px-2 py-0.5 rounded border border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-slate-200 text-xs font-mono font-semibold uppercase">{k}</kbd>
                </div>
              ))}
              <div className="text-[11px] text-gray-400 dark:text-slate-500 pt-1">Shortcuts pause while typing in a field.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Fit / probability inline editor — shows a colored pill when not editing.
function FitInline({ candidateId, field, value, options = FIT_OPTS }: { candidateId: string; field: string; value: string|null; options?: [string,string][] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? "");
  async function save(v: string) {
    await fetch(`/api/hr/candidates/${candidateId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: v || null }) });
    setEditing(false); router.refresh();
  }
  if (!editing) {
    return <button type="button" onClick={()=>{ setVal(value??""); setEditing(true); }} className="text-left w-full"><FitPill value={value} /></button>;
  }
  return (
    <div className="flex items-center gap-1">
      <select autoFocus value={val} onChange={e=>{ setVal(e.target.value); save(e.target.value); }} className="w-full border border-gray-200 rounded px-2 py-1 text-xs dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
        <option value="">—</option>
        {options.map(([k,l])=><option key={k} value={k}>{l}</option>)}
      </select>
      <button type="button" onClick={()=>setEditing(false)} className="text-gray-400 px-1"><X size={13} /></button>
    </div>
  );
}
