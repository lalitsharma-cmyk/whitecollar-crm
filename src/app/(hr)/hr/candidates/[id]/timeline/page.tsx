import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ACT_LABEL: Record<string, string> = {
  CALL_CONNECTED: "📞 Call — Connected", CALL_NOT_ANSWERED: "📵 Call — No Answer", CALL_BUSY: "⏳ Call — Busy",
  CALL_SWITCHED_OFF: "📴 Call — Switched Off", CALL_WRONG_NUMBER: "🚫 Wrong Number", CALL_LATER: "🔁 Call Later",
  WHATSAPP_SENT: "💬 WhatsApp Sent", WHATSAPP_RECEIVED: "💬 WhatsApp Reply", EMAIL_LOGGED: "📧 Email Logged",
  INTERVIEW_SCHEDULED: "🎯 Interview Scheduled", INTERVIEW_ATTENDED: "✅ Interview Attended", INTERVIEW_NO_SHOW: "⚠️ No Show",
  INTERVIEW_RESCHEDULED: "🔄 Interview Rescheduled", OFFER_RELEASED: "📄 Offer Released", OFFER_DECLINED: "❌ Offer Declined",
  CANDIDATE_JOINED: "🎉 Joined", FOLLOWUP_CREATED: "📅 Follow-up Set", FOLLOWUP_COMPLETED: "✔ Follow-up Done",
  STATUS_CHANGED: "🔄 Status Changed", NOTE_ADDED: "📝 Note / Remark",
};
function fmt(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

export default async function CandidateTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const candidate = await prisma.hRCandidate.findUnique({
    where: { id },
    select: {
      id: true, name: true, status: true, phone: true,
      primaryOwner: { select: { name: true } },
      activities: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
    },
  });
  if (!candidate) notFound();

  // Group activities by IST day, newest first.
  const groups: { day: string; items: typeof candidate.activities }[] = [];
  for (const a of candidate.activities) {
    const day = new Date(a.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
    const g = groups.find(x => x.day === day);
    if (g) g.items.push(a); else groups.push({ day, items: [a] });
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/hr/candidates/${candidate.id}`} className="text-sm text-blue-600 hover:underline">← {candidate.name}</Link>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300">{fmt(candidate.status)}</span>
            {candidate.primaryOwner?.name && <span className="text-[11px] text-gray-400">Owner: {candidate.primaryOwner.name.split(" ")[0]}</span>}
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mt-1">Candidate Timeline</h1>
          <p className="text-sm text-gray-500">{candidate.activities.length} events · every call, WhatsApp, interview, status change &amp; remark</p>
        </div>
        {candidate.phone && (
          <div className="flex gap-2 shrink-0">
            <a href={`tel:${candidate.phone}`} className="text-sm px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50">📞 Call</a>
            <a href={`https://wa.me/${candidate.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
              className="text-sm px-3 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-50">💬 WA</a>
          </div>
        )}
      </div>

      {candidate.activities.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-2">🗒️</div>
          <div className="text-sm">No activity logged yet.</div>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(g => (
            <div key={g.day}>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">{g.day}</div>
              <div className="relative pl-5 border-l-2 border-gray-100 dark:border-slate-800 space-y-2.5">
                {g.items.map(a => (
                  <div key={a.id} className="relative">
                    <span className="absolute -left-[27px] top-1.5 w-3 h-3 rounded-full bg-[#1a2e4a] border-2 border-white dark:border-slate-900" />
                    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-100 dark:border-slate-800 px-3 py-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800 dark:text-slate-200">{ACT_LABEL[a.type] ?? fmt(a.type)}</span>
                        <span className="text-[10px] text-gray-400">
                          {new Date(a.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                          {a.user?.name ? ` · ${a.user.name.split(" ")[0]}` : ""}
                        </span>
                      </div>
                      {a.oldStatus && a.newStatus && a.oldStatus !== a.newStatus && (
                        <div className="text-[11px] text-gray-500 mt-0.5">{fmt(a.oldStatus)} → {fmt(a.newStatus)}</div>
                      )}
                      {a.notes && <div className="text-xs text-gray-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{a.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
