import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { statusColor, statusLabel, CLOSED_STATUS_KEYS } from "@/lib/hrStatus";
import HRRemindersCard, { type HRReminderEvent, type HREventType } from "@/components/HRRemindersCard";
import HRFollowUpTabs, { type FU } from "@/components/HRFollowUpTabs";

export const dynamic = "force-dynamic";

function istRange() {
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const start = new Date(todayIso + "T00:00:00+05:30");
  return { todayIso, start, end: new Date(start.getTime() + 24 * 3600_000) };
}
function fmt(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }
function fmtTime(d: Date) { return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }); }
function fmtDate(d: Date) { return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }); }

const FU_EVENT: Record<string, { type: HREventType; label: string }> = {
  CALL_BACK: { type: "FOLLOWUP", label: "Call" },
  INTERVIEW_CONFIRMATION: { type: "CONFIRM", label: "Confirm Interview" },
  REMINDER: { type: "FOLLOWUP", label: "Reminder" },
  WHATSAPP_FOLLOWUP: { type: "FOLLOWUP", label: "WhatsApp" },
  EMAIL_FOLLOWUP: { type: "FOLLOWUP", label: "Email" },
  SALARY_DISCUSSION: { type: "FOLLOWUP", label: "Salary Discussion" },
  OFFER_DISCUSSION: { type: "OFFER", label: "Offer Discussion" },
  JOINING_FOLLOWUP: { type: "OFFER", label: "Joining Follow-up" },
  NO_SHOW_RECOVERY: { type: "FOLLOWUP", label: "No-Show Recovery" },
  CUSTOM: { type: "FOLLOWUP", label: "Follow-up" },
};

export default async function HRDashboard() {
  const me = await requireUser();
  const { todayIso, start: todayStart, end: todayEnd } = istRange();
  const scope = me.role === "AGENT" ? { OR: [{ primaryOwnerId: me.id }, { secondaryOwnerId: me.id }] } : {};
  const now = new Date();
  const weekAgo = new Date(todayStart.getTime() - 7 * 24 * 3600_000);

  const [followUps, interviews, newCount, expectedList, noNextAction] = await Promise.all([
    prisma.hRFollowUp.findMany({
      where: { completedAt: null, candidate: scope },
      orderBy: { dueAt: "asc" }, take: 200,
      include: { candidate: { select: { id: true, name: true, phone: true, whatsappPhone: true, status: true, nextAction: true, primaryOwner: { select: { name: true } } } } },
    }),
    prisma.hRInterview.findMany({
      where: { candidate: scope, scheduledAt: { gte: weekAgo } },
      orderBy: { scheduledAt: "asc" }, take: 200,
      include: { candidate: { select: { id: true, name: true, phone: true, positionApplied: true, primaryOwner: { select: { name: true } } } }, interviewer: { select: { name: true } } },
    }),
    prisma.hRCandidate.count({ where: { status: "NEW", ...scope } }),
    prisma.hRCandidate.findMany({
      where: { AND: [scope, { OR: [{ status: "EXPECTED_JOINING" }, { joiningDate: { not: null } }] }] },
      orderBy: { joiningDate: "asc" }, take: 20,
      select: { id: true, name: true, positionApplied: true, joiningDate: true, status: true },
    }),
    prisma.hRCandidate.findMany({
      where: { AND: [scope, { nextActionDate: null, status: { notIn: CLOSED_STATUS_KEYS } }] },
      orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, name: true, phone: true, whatsappPhone: true, status: true, positionApplied: true, primaryOwner: { select: { name: true } } },
    }),
  ]);

  // ── Derive follow-up buckets ──
  const overdueFU = followUps.filter(f => new Date(f.dueAt) < todayStart);
  const todayFU = followUps.filter(f => { const d = new Date(f.dueAt); return d >= todayStart && d < todayEnd; });
  const upcomingFU = followUps.filter(f => new Date(f.dueAt) >= todayEnd).slice(0, 30);

  // Main action list — one row per candidate needing action today (overdue + due today, soonest first).
  const seen = new Set<string>();
  const actionItems = [...overdueFU, ...todayFU]
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))
    .filter(f => { if (seen.has(f.candidateId)) return false; seen.add(f.candidateId); return true; })
    .slice(0, 25);

  // ── Derive interview buckets ──
  const ivToday = interviews.filter(iv => { const d = new Date(iv.scheduledAt); return d >= todayStart && d < todayEnd && (iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED"); });
  const confirmPending = interviews.filter(iv => new Date(iv.scheduledAt) >= now && iv.confirmationStatus === "PENDING" && (iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED"));
  const noShowSeen = new Set<string>();
  const noShowList = interviews.filter(iv => iv.attendanceStatus === "NO_SHOW").reverse()
    .filter(iv => { if (noShowSeen.has(iv.candidateId)) return false; noShowSeen.add(iv.candidateId); return true; }).slice(0, 10);

  // ── Reminder events ──
  const reminderEvents: HRReminderEvent[] = [
    ...followUps.map(f => ({ id: f.id, candidateId: f.candidateId, candidateName: f.candidate.name, type: FU_EVENT[f.type]?.type ?? "FOLLOWUP", label: FU_EVENT[f.type]?.label ?? "Follow-up", timeIso: new Date(f.dueAt).toISOString(), ownerName: f.candidate.primaryOwner?.name ?? null })),
    ...interviews.filter(iv => iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED").map(iv => ({ id: iv.id, candidateId: iv.candidateId, candidateName: iv.candidate.name, type: "INTERVIEW" as HREventType, label: `${fmt(iv.type)} Interview`, timeIso: new Date(iv.scheduledAt).toISOString(), ownerName: iv.candidate.primaryOwner?.name ?? null })),
  ];

  const toFU = (f: typeof followUps[number]): FU => ({ id: f.id, candidateId: f.candidateId, candidateName: f.candidate.name, phone: f.candidate.phone, type: f.type, dueAt: new Date(f.dueAt).toISOString(), notes: f.notes });

  const metrics = [
    { label: "New Candidates", n: newCount, href: "/hr/candidates?status=NEW", emoji: "🆕", color: "border-blue-400 text-blue-700 bg-blue-50" },
    { label: "Calls Due Today", n: todayFU.length, href: "#action", emoji: "📞", color: "border-amber-400 text-amber-700 bg-amber-50" },
    { label: "Interviews Today", n: ivToday.length, href: "#interviews", emoji: "🎯", color: "border-indigo-400 text-indigo-700 bg-indigo-50" },
    { label: "Confirmations Pending", n: confirmPending.length, href: "#interviews", emoji: "✅", color: "border-orange-400 text-orange-700 bg-orange-50" },
    { label: "Overdue Follow-Ups", n: overdueFU.length, href: "#followups", emoji: "⚠️", color: "border-red-400 text-red-700 bg-red-50" },
    { label: "No-Shows", n: noShowList.length, href: "#noshow", emoji: "🚫", color: "border-rose-400 text-rose-700 bg-rose-50" },
    { label: "Expected Joinings", n: expectedList.length, href: "#joinings", emoji: "🤝", color: "border-green-400 text-green-700 bg-green-50" },
    { label: "No Next Action", n: noNextAction.length, href: "#nonext", emoji: "📭", color: "border-slate-400 text-slate-700 bg-slate-50" },
  ];

  const wa = (p: string | null, alt: string | null) => { const x = p ?? alt; return x ? `https://wa.me/${x.replace(/\D/g, "")}` : null; };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening"}, {me.name.split(" ")[0]} 👋
        </h1>
        <Link href="/hr/candidates/new" className="inline-flex items-center gap-2 bg-[#1a2e4a] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#243d60] transition">+ Add Candidate</Link>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* ── LEFT: action content ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Top summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {metrics.map(m => (
              <a key={m.label} href={m.href} className={`rounded-xl border-l-4 ${m.color} p-3 hover:shadow-md transition`}>
                <div className="text-2xl font-extrabold text-gray-800">{m.n}</div>
                <div className="text-[10px] text-gray-600 mt-0.5">{m.emoji} {m.label}</div>
              </a>
            ))}
          </div>

          {/* Main action list */}
          <section id="action" className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200">📋 Who to call now ({actionItems.length})</div>
            {actionItems.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-gray-400">Nothing due — you&apos;re all caught up 🎉</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                    {["Candidate", "Phone", "Status", "Next Action", "Due", "Owner", "Actions"].map(h => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {actionItems.map(f => {
                      const due = new Date(f.dueAt); const overdue = due < todayStart;
                      const waHref = wa(f.candidate.whatsappPhone, f.candidate.phone);
                      return (
                        <tr key={f.id} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/50">
                          <td className="px-3 py-2"><Link href={`/hr/candidates/${f.candidateId}`} className="font-semibold text-[#1a2e4a] dark:text-blue-400 hover:underline">{f.candidate.name}</Link></td>
                          <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{f.candidate.phone ?? "—"}</td>
                          <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor(f.candidate.status)}`}>{statusLabel(f.candidate.status)}</span></td>
                          <td className="px-3 py-2 text-xs text-gray-600 max-w-[140px] truncate">{f.candidate.nextAction ?? fmt(f.type)}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap"><span className={overdue ? "text-red-600 font-semibold" : "text-amber-600"}>{overdue ? "⚠ " : ""}{fmtTime(due)}</span></td>
                          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{f.candidate.primaryOwner?.name?.split(" ")[0] ?? "—"}</td>
                          <td className="px-3 py-2"><div className="flex items-center gap-1">
                            {f.candidate.phone && <a href={`tel:${f.candidate.phone}`} title="Call" className="px-1 py-0.5 rounded hover:bg-blue-50 text-blue-600">📞</a>}
                            {waHref && <a href={waHref} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="px-1 py-0.5 rounded hover:bg-green-50 text-green-600">💬</a>}
                            <Link href={`/hr/candidates/${f.candidateId}?do=interview`} title="Schedule" className="px-1 py-0.5 rounded hover:bg-purple-50 text-purple-600">📅</Link>
                            <Link href={`/hr/candidates/${f.candidateId}?do=note`} title="Note" className="px-1 py-0.5 rounded hover:bg-gray-100 text-gray-600">📝</Link>
                          </div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* No Next Action — fresh candidates needing a first follow-up */}
          <section id="nonext" className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200">📭 No Next Action — needs a first follow-up ({noNextAction.length})</div>
            {noNextAction.length === 0 ? <div className="px-4 py-5 text-center text-xs text-gray-400">Every active candidate has a next action 🎉</div> : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {noNextAction.map(c => {
                  const waHref = wa(c.whatsappPhone, c.phone);
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <Link href={`/hr/candidates/${c.id}`} className="text-sm font-semibold text-gray-800 dark:text-slate-100 hover:underline">{c.name}</Link>
                        <div className="text-[11px] text-gray-500">{[c.positionApplied, statusLabel(c.status)].filter(Boolean).join(" · ") || "—"}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {c.phone && <a href={`tel:${c.phone}`} className="text-[11px] px-2 py-1 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50">📞 Call</a>}
                        {waHref && <a href={waHref} target="_blank" rel="noopener noreferrer" className="text-[11px] px-2 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-50">💬 WA</a>}
                        <Link href={`/hr/candidates/${c.id}?do=followup`} className="text-[11px] px-2 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50">📅 Schedule</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Follow-up tabs */}
          <section id="followups"><HRFollowUpTabs today={todayFU.map(toFU)} overdue={overdueFU.map(toFU)} upcoming={upcomingFU.map(toFU)} /></section>

          {/* Today's interviews */}
          <section id="interviews" className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200">🎯 Today&apos;s Interviews ({ivToday.length})</div>
            {ivToday.length === 0 ? <div className="px-4 py-5 text-center text-xs text-gray-400">No interviews scheduled today.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  {["Candidate", "Position", "Time", "Interviewer", "Status"].map(h => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {ivToday.map(iv => (
                    <tr key={iv.id} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2"><Link href={`/hr/candidates/${iv.candidateId}`} className="font-medium text-[#1a2e4a] dark:text-blue-400 hover:underline">{iv.candidate.name}</Link></td>
                      <td className="px-3 py-2 text-xs text-gray-600">{iv.candidate.positionApplied ?? "—"}</td>
                      <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">{fmtTime(new Date(iv.scheduledAt))}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{iv.interviewer?.name?.split(" ")[0] ?? "—"}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${iv.confirmationStatus === "CONFIRMED" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{fmt(iv.confirmationStatus)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>

          {/* No-show recovery */}
          <section id="noshow" className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200">🚫 No-Show Recovery ({noShowList.length})</div>
            {noShowList.length === 0 ? <div className="px-4 py-5 text-center text-xs text-gray-400">No pending no-shows.</div> : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {noShowList.map(iv => {
                  const waHref = wa(iv.candidate.phone, null);
                  return (
                    <div key={iv.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <Link href={`/hr/candidates/${iv.candidateId}`} className="text-sm font-semibold text-gray-800 dark:text-slate-100 hover:underline">{iv.candidate.name}</Link>
                        <div className="text-[11px] text-gray-500">Missed {fmt(iv.type)} on {fmtDate(new Date(iv.scheduledAt))}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {iv.candidate.phone && <a href={`tel:${iv.candidate.phone}`} className="text-[11px] px-2 py-1 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50">📞 Call</a>}
                        {waHref && <a href={waHref} target="_blank" rel="noopener noreferrer" className="text-[11px] px-2 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-50">💬 WA</a>}
                        <Link href={`/hr/candidates/${iv.candidateId}?do=interview`} className="text-[11px] px-2 py-1 rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50">↻ Reschedule</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Expected joinings */}
          <section id="joinings" className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200">🤝 Expected Joinings ({expectedList.length})</div>
            {expectedList.length === 0 ? <div className="px-4 py-5 text-center text-xs text-gray-400">No expected joinings yet — set a joining date on offered candidates.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  {["Candidate", "Joining Date", "Position", "Offer Status"].map(h => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {expectedList.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2"><Link href={`/hr/candidates/${c.id}`} className="font-medium text-[#1a2e4a] dark:text-blue-400 hover:underline">{c.name}</Link></td>
                      <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">{c.joiningDate ? fmtDate(new Date(c.joiningDate)) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{c.positionApplied ?? "—"}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor(c.status)}`}>{statusLabel(c.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>
        </div>

        {/* ── RIGHT: sticky reminders ── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <HRRemindersCard events={reminderEvents} todayIso={todayIso} showOwner={me.role !== "AGENT"} />
        </div>
      </div>
    </div>
  );
}
