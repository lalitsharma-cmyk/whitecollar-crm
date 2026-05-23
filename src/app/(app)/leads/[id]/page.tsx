import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import Link from "next/link";

export const dynamic = "force-dynamic";

import { fmtMoney } from "@/lib/money";
const aedFmt = fmtMoney;

const moodClass: Record<string, string> = {
  EXCITED: "chip-won", INTERESTED: "chip-warm", NEUTRAL: "chip-new",
  HESITANT: "chip-warm", COLD: "chip-cold", CONFUSED: "chip-lost", ANGRY: "chip-hot",
};
const potClass: Record<string, string> = { HIGH: "chip-hot", MEDIUM: "chip-warm", LOW: "chip-cold", UNKNOWN: "chip-lost" };
const fundClass: Record<string, string> = { CASH_READY: "chip-won", BANK_APPROVED: "chip-warm", FINANCING_NEEDED: "chip-cold", NOT_DISCUSSED: "chip-lost" };

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      owner: true,
      interestedUnits: { include: { unit: { include: { project: true } } } },
      activities: { orderBy: { createdAt: "desc" }, take: 20, include: { user: true } },
      callLogs:   { orderBy: { startedAt: "desc" }, take: 10, include: { user: true } },
      notes:      { orderBy: { createdAt: "desc" }, take: 10, include: { user: true } },
    },
  });
  if (!lead) notFound();

  const aiClass = lead.aiScore === "HOT" ? "chip-hot" : lead.aiScore === "WARM" ? "chip-warm" : "chip-cold";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        {/* Header */}
        <div className="card p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold">{lead.name}</h2>
                {lead.aiScore && <span className={`chip ${aiClass}`}>{lead.aiScore} · {lead.aiScoreValue}</span>}
                <span className="chip chip-warm">{lead.status.replaceAll("_"," ")}</span>
                {lead.currentStatus && <span className="chip src">{lead.currentStatus}</span>}
                {lead.moodStatus && <span className={`chip ${moodClass[lead.moodStatus] ?? "src"}`}>😊 {lead.moodStatus}</span>}
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {lead.phone}
                {lead.email && ` · ${lead.email}`}
                {lead.company && ` · ${lead.company}`}
                {lead.city && ` · ${lead.city}, ${lead.country}`}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost">📞 Call</button>
              <button className="btn btn-ghost">💬 WhatsApp</button>
              <button className="btn btn-gold">Log Activity</button>
            </div>
          </div>
        </div>

        {/* WHO IS CLIENT — the depth field, prominently featured */}
        {lead.whoIsClient && (
          <div className="card p-5 border-l-4 border-[#c9a24b]">
            <div className="flex items-center gap-2 mb-2">
              <span className="ai-tag">WHO IS THE CLIENT</span>
              <span className="text-xs text-gray-500">— full situation, not keywords</span>
            </div>
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{lead.whoIsClient}</p>
          </div>
        )}

        {/* Qualification grid */}
        <div className="card p-5">
          <div className="font-semibold mb-3">Qualification</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-500">Potential</div>
              {lead.potential ? <span className={`chip ${potClass[lead.potential]} mt-1`}>{lead.potential}</span> : <span className="text-gray-400">—</span>}
            </div>
            <div>
              <div className="text-xs text-gray-500">Fund Readiness</div>
              {lead.fundReadiness ? <span className={`chip ${fundClass[lead.fundReadiness]} mt-1`}>{lead.fundReadiness.replaceAll("_"," ")}</span> : <span className="text-gray-400">—</span>}
            </div>
            <div>
              <div className="text-xs text-gray-500">When can invest</div>
              <div className="font-semibold">{lead.whenCanInvest ? lead.whenCanInvest.replaceAll("_"," ").toLowerCase() : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Categorization</div>
              <div className="font-semibold">{lead.categorization ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Budget</div>
              <div className="font-semibold">{lead.budgetMin ? `${aedFmt(lead.budgetMin, lead.budgetCurrency)} – ${aedFmt(lead.budgetMax ?? lead.budgetMin, lead.budgetCurrency)}` : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Configuration</div>
              <div className="font-semibold">{lead.configuration ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Source</div>
              <div className="font-semibold">{lead.source.replaceAll("_"," ")}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Owner</div>
              <div className="font-semibold">{lead.owner?.name ?? "—"}</div>
            </div>
          </div>
        </div>

        {/* Scheduling — Meeting / Site Visit / Follow-up / To Do */}
        <div className="card p-5">
          <div className="font-semibold mb-3">Scheduling & next action</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="p-3 border border-[#e5e7eb] rounded-lg">
              <div className="text-xs text-gray-500">📅 Meeting</div>
              <div className="font-semibold">{lead.meetingDate ? format(lead.meetingDate, "PPp") : "Not scheduled"}</div>
            </div>
            <div className="p-3 border border-[#e5e7eb] rounded-lg">
              <div className="text-xs text-gray-500">🏢 Site Visit</div>
              <div className="font-semibold">{lead.siteVisitDate ? format(lead.siteVisitDate, "PPp") : "Not scheduled"}</div>
            </div>
            <div className="p-3 border border-[#e5e7eb] rounded-lg">
              <div className="text-xs text-gray-500">🔁 Follow-up</div>
              <div className="font-semibold">{lead.followupDate ? format(lead.followupDate, "PPp") : "Not scheduled"}</div>
            </div>
            <div className="p-3 border border-[#e5e7eb] rounded-lg bg-amber-50 border-amber-200">
              <div className="text-xs text-amber-700">✅ To Do — Next action</div>
              <div className="font-semibold">{lead.todoNext ?? "Decide what's next"}</div>
            </div>
          </div>
        </div>

        {lead.remarks && (
          <div className="card p-5">
            <div className="font-semibold mb-2">Remarks</div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{lead.remarks}</p>
          </div>
        )}

        {lead.detailShared && (
          <div className="card p-5">
            <div className="font-semibold mb-2">📤 Detail shared with client</div>
            <p className="text-sm text-gray-700">{lead.detailShared}</p>
          </div>
        )}

        {lead.aiSummary && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold flex items-center gap-2">AI Summary <span className="ai-tag">AI</span></div>
              <span className="text-xs text-gray-500">Updated {lead.aiUpdatedAt ? formatDistanceToNow(lead.aiUpdatedAt, { addSuffix: true }) : "—"}</span>
            </div>
            <p className="text-sm text-gray-700">{lead.aiSummary}</p>
            {lead.aiNextAction && (
              <div className="mt-3 flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
                <span>⚡</span>
                <div><b>Next best action:</b> {lead.aiNextAction}</div>
              </div>
            )}
          </div>
        )}

        <div className="card p-5">
          <div className="font-semibold mb-3">Timeline</div>
          <div className="tl-line space-y-4">
            {lead.activities.map((a) => (
              <div key={a.id} className="relative">
                <span className="tl-dot" />
                <div className="text-sm"><b>{a.title}</b> · <span className="pill">{a.type}</span></div>
                <div className="text-xs text-gray-500">{a.user?.name ?? "System"} · {format(a.createdAt, "PPp")}</div>
                {a.description && <div className="text-sm mt-1 text-gray-700">{a.description}</div>}
              </div>
            ))}
            {lead.activities.length === 0 && <div className="text-sm text-gray-500">No activity yet.</div>}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="card p-5">
          <div className="font-semibold mb-3">Quick log</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <button className="btn btn-ghost justify-center">📞 Connected</button>
            <button className="btn btn-ghost justify-center">📵 Not picked</button>
            <button className="btn btn-ghost justify-center">🔁 Callback</button>
            <button className="btn btn-ghost justify-center">💬 WhatsApp</button>
            <button className="btn btn-ghost justify-center">🏢 Site visit</button>
            <button className="btn btn-ghost justify-center">📝 Note</button>
          </div>
        </div>

        {lead.address && (
          <div className="card p-5">
            <div className="font-semibold mb-2">📍 Address</div>
            <p className="text-sm text-gray-700">{lead.address}</p>
          </div>
        )}

        <div className="card p-5">
          <div className="font-semibold mb-2">Interested properties</div>
          {lead.interestedUnits.length === 0 && <div className="text-sm text-gray-500">None attached yet.</div>}
          <div className="space-y-2 text-sm">
            {lead.interestedUnits.map((p) => (
              <div key={p.id} className="flex items-center justify-between border border-[#e5e7eb] rounded-lg p-2">
                <div>
                  <div className="font-semibold">{p.unit.project.name} {p.unit.configuration}</div>
                  <div className="text-xs text-gray-500">{p.unit.code} · {aedFmt(p.unit.priceBase, p.unit.project.country === "India" ? "INR" : "AED")}</div>
                </div>
                <span className={`chip ${p.type === "PRIMARY" ? "chip-hot" : p.type === "COMPARE" ? "chip-warm" : "chip-lost"}`}>{p.type}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="font-semibold mb-2">Recent calls</div>
          <div className="space-y-2 text-sm">
            {lead.callLogs.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{c.outcome.replaceAll("_"," ")}</div>
                  <div className="text-xs text-gray-500">{c.user.name} · {format(c.startedAt, "PPp")}{c.durationSec ? ` · ${Math.floor(c.durationSec/60)}m ${c.durationSec%60}s` : ""}</div>
                </div>
                <span className="chip chip-new">{c.direction}</span>
              </div>
            ))}
            {lead.callLogs.length === 0 && <div className="text-gray-500">No calls yet.</div>}
          </div>
        </div>

        <Link href="/leads" className="text-xs text-[#0b1a33] font-semibold inline-block">← Back to leads</Link>
      </div>
    </div>
  );
}
