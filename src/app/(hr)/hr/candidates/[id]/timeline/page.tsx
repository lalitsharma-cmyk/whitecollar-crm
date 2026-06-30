import { requireHrPage, canTouchCandidate } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import { getHrUsers } from "@/lib/hrUsers";
import { notFound } from "next/navigation";
import { statusLabel, displayStatus } from "@/lib/hrStatus";
import Link from "next/link";
import {
  Phone, PhoneOff, PhoneMissed, PhoneCall, MessageSquare, Mail, PhoneForwarded, Ban, Clock,
  Target, CheckCircle2, AlertTriangle, RefreshCw, FileSignature, XCircle, PartyPopper,
  CalendarPlus, CalendarCheck, RotateCcw, StickyNote, Mic, Activity as ActivityIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";

type IconCmp = typeof Phone;
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
function fmt(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }
function actMeta(t: string) { return ACT_META[t] ?? { label: fmt(t), icon: ActivityIcon, tint: "text-slate-600 bg-slate-100 dark:bg-slate-800" }; }
const fmtDayLong = (s: Date) => s.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
const fmtTime = (s: Date) => s.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const fmtDur = (n: number | null) => { if (!n || n <= 0) return ""; const m = Math.floor(n / 60); return `${m}:${String(n % 60).padStart(2, "0")}`; };

export default async function CandidateTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { me } = await requireHrPage();
  const { id } = await params;

  const [candidate, agents] = await Promise.all([
    prisma.hRCandidate.findUnique({
      where: { id },
      select: {
        id: true, name: true, status: true, originalStatus: true, phone: true,
        deletedAt: true,
        primaryOwnerId: true, secondaryOwnerId: true,
        primaryOwner: { select: { name: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: { name: true } } } },
        interviews: { orderBy: { scheduledAt: "desc" }, include: { interviewer: { select: { name: true } } } },
        voiceMessages: {
          orderBy: { createdAt: "desc" },
          select: { id: true, kind: true, createdById: true, title: true, textNote: true, transcript: true, durationSec: true, createdAt: true },
        },
      },
    }),
    getHrUsers(),
  ]);
  if (!candidate) notFound();
  if (candidate.deletedAt) notFound(); // soft-deleted (recycle-bin) → 404
  if (!canTouchCandidate(me, candidate)) notFound();

  const userName = (uid: string) => agents.find(a => a.id === uid)?.name ?? "Someone";

  // ── Unified entries: activities + interviews + voice, newest first ──
  type Entry = { id: string; at: Date; icon: IconCmp; tint: string; title: string; by: string | null; detail: string | null; meta: string | null };
  const entries: Entry[] = [];
  for (const a of candidate.activities) {
    const m = actMeta(a.type);
    const sc = a.oldStatus && a.newStatus && a.oldStatus !== a.newStatus ? `${statusLabel(a.oldStatus)} → ${statusLabel(a.newStatus)}` : null;
    entries.push({ id: `act-${a.id}`, at: a.createdAt, icon: m.icon, tint: m.tint, title: m.label, by: a.user?.name ?? null, detail: a.notes, meta: sc });
  }
  for (const iv of candidate.interviews) {
    entries.push({
      id: `iv-${iv.id}`, at: iv.scheduledAt, icon: Target, tint: "text-purple-600 bg-purple-50 dark:bg-purple-900/30",
      title: `${fmt(iv.type)} Interview`, by: iv.interviewer?.name ?? null, detail: iv.notes,
      meta: [fmt(iv.confirmationStatus), fmt(iv.attendanceStatus), iv.recommendation ? `Reco: ${fmt(iv.recommendation)}` : null].filter(Boolean).join(" · "),
    });
  }
  for (const v of candidate.voiceMessages) {
    const isGuide = v.kind === "GUIDANCE";
    entries.push({
      id: `voice-${v.id}`, at: v.createdAt, icon: isGuide ? Mic : AlertTriangle,
      tint: isGuide ? "text-[#0b1a33] bg-blue-50 dark:bg-blue-900/30" : "text-amber-600 bg-amber-50 dark:bg-amber-900/30",
      title: isGuide ? "Voice Guidance" : v.kind === "ESCALATION_REPLY" ? "Escalation Reply" : "Escalation Raised",
      by: userName(v.createdById), detail: v.transcript || v.textNote || v.title || "(voice message)",
      meta: v.durationSec ? fmtDur(v.durationSec) : null,
    });
  }
  entries.sort((a, b) => +b.at - +a.at);

  // Group by IST day. Day groups stay newest-first (entries are sorted desc),
  // but items WITHIN each day read morning→evening (ascending) so a single day's
  // conversation flows chronologically top-to-bottom.
  const groups: { day: string; items: Entry[] }[] = [];
  for (const e of entries) {
    const day = fmtDayLong(e.at);
    const g = groups.find(x => x.day === day);
    if (g) g.items.push(e); else groups.push({ day, items: [e] });
  }
  for (const g of groups) g.items.sort((a, b) => +a.at - +b.at);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/hr/candidates/${candidate.id}`} className="text-sm text-blue-600 hover:underline">← {candidate.name}</Link>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300">{displayStatus(candidate)}</span>
            {candidate.primaryOwner?.name && <span className="text-[11px] text-gray-400">Owner: {candidate.primaryOwner.name.split(" ")[0]}</span>}
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mt-1">Conversation Timeline</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">{entries.length} events · every call, WhatsApp, interview, voice, status change &amp; remark</p>
        </div>
        {candidate.phone && (
          <div className="flex gap-2 shrink-0">
            <a href={`tel:${candidate.phone}`} className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50"><Phone size={14} />Call</a>
            <a href={`https://wa.me/${candidate.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-50"><MessageSquare size={14} />WA</a>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <ActivityIcon size={32} className="mx-auto mb-2 opacity-50" />
          <div className="text-sm">No activity logged yet.</div>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(g => (
            <div key={g.day}>
              <div className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-2">{g.day}</div>
              <div className="space-y-2">
                {g.items.map(e => { const Ic = e.icon; return (
                  <div key={e.id} className="flex gap-2.5 text-sm">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${e.tint}`}><Ic size={14} /></div>
                    <div className="flex-1 min-w-0 bg-white dark:bg-slate-900 rounded-lg border border-gray-100 dark:border-slate-800 px-3 py-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800 dark:text-slate-200">{e.title}</span>
                        <span className="text-[10px] text-gray-400">{fmtTime(e.at)}{e.by ? ` · ${e.by.split(" ")[0]}` : ""}</span>
                      </div>
                      {e.meta && <div className="text-[11px] text-gray-500 mt-0.5">{e.meta}</div>}
                      {e.detail && <div className="text-xs text-gray-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{e.detail}</div>}
                    </div>
                  </div>
                ); })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
