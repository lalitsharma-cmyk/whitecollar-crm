"use client";
import { StickyNote, PhoneCall, CalendarClock, UserCircle2, FileText, GitBranch } from "lucide-react";

// ── Hover preview card for an HR candidate row ───────────────────────────────
// Surfaces the at-a-glance facts a recruiter wants WITHOUT opening the full
// profile (spec #10): Last Note, Last Call Date, Last Follow-up, Recruiter,
// Resume Available, Current Stage. All data is derived cheaply from fields the
// list query already loads — no extra round-trip. Rendered on row hover by
// HRCandidateTable; it positions this fixed-card next to the cursor row.

export interface PreviewData {
  name: string;
  lastNote: string | null;        // most recent NOTE_ADDED activity text
  lastCallDate: string | null;    // most recent CALL_* activity timestamp (ISO)
  lastFollowUp: string | null;    // next/last follow-up due date (ISO)
  lastFollowUpOverdue: boolean;
  recruiter: string | null;       // primary owner name
  hasResume: boolean;
  currentStage: string;           // displayStatus()
  statusClass: string;            // hrStatus statusColor() classes
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Row({ icon, label, children, tone }: { icon: React.ReactNode; label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="mt-0.5 text-gray-400 dark:text-slate-500 shrink-0">{icon}</span>
      <span className="text-gray-400 dark:text-slate-500 w-20 shrink-0 uppercase tracking-wide text-[9px] font-semibold mt-px">{label}</span>
      <span className={`min-w-0 flex-1 ${tone ?? "text-gray-700 dark:text-slate-200"}`}>{children}</span>
    </div>
  );
}

export default function HRCandidateRowPreview({ data }: { data: PreviewData }) {
  return (
    <div className="w-72 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-gray-100 dark:border-slate-800">
        <span className="font-semibold text-sm text-[#1a2e4a] dark:text-blue-300 truncate">{data.name}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${data.statusClass}`}>{data.currentStage}</span>
      </div>
      <Row icon={<GitBranch className="w-3.5 h-3.5" />} label="Stage">{data.currentStage}</Row>
      <Row icon={<StickyNote className="w-3.5 h-3.5" />} label="Last Note">
        {data.lastNote ? <span className="line-clamp-2 break-words">{data.lastNote}</span> : <span className="text-gray-400 italic">No notes yet</span>}
      </Row>
      <Row icon={<PhoneCall className="w-3.5 h-3.5" />} label="Last Call">{fmtDate(data.lastCallDate)}</Row>
      <Row
        icon={<CalendarClock className="w-3.5 h-3.5" />}
        label="Follow-up"
        tone={data.lastFollowUp ? (data.lastFollowUpOverdue ? "text-red-600 dark:text-red-400 font-semibold" : "text-amber-600 dark:text-amber-400") : undefined}
      >
        {data.lastFollowUp ? `${data.lastFollowUpOverdue ? "Overdue · " : ""}${fmtDate(data.lastFollowUp)}` : "—"}
      </Row>
      <Row icon={<UserCircle2 className="w-3.5 h-3.5" />} label="Recruiter">{data.recruiter ?? <span className="text-gray-400 italic">Unassigned</span>}</Row>
      <Row icon={<FileText className="w-3.5 h-3.5" />} label="Resume" tone={data.hasResume ? "text-emerald-600 dark:text-emerald-400 font-medium" : undefined}>
        {data.hasResume ? "Available" : <span className="text-gray-400">Not uploaded</span>}
      </Row>
    </div>
  );
}
