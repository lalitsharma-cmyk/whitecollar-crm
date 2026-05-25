import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { fmtIST, fmtISTParen, toISTLocalInput } from "@/lib/datetime";
import Link from "next/link";
import { fmtMoney } from "@/lib/money";
import { requireUser } from "@/lib/auth";
import LeadActionsClient from "@/components/LeadActionsClient";
import LeadProjectsClient from "@/components/LeadProjectsClient";
import LeadMeetingClient from "@/components/LeadMeetingClient";
import SiteVisitTracker from "@/components/SiteVisitTracker";
import AdvancedActivityLogger from "@/components/AdvancedActivityLogger";
import { getTravelRatePerKmInr } from "@/lib/settings";
import { runReconciler } from "@/lib/reconciler";
import { aggregateCalls, callBreakdownString } from "@/lib/callStats";
import { activityVisual } from "@/lib/activityIcon";
import InlineEdit from "@/components/InlineEdit";
import { acefoneEnabled } from "@/lib/acefone";
import { canTouchLead } from "@/lib/leadScope";
import SuggestedUnitsCard from "@/components/SuggestedUnitsCard";
import { bestUnitsForLead } from "@/lib/inventoryMatch";
import LeadAIActions from "@/components/LeadAIActions";
import RemarksCard from "@/components/RemarksCard";

export const dynamic = "force-dynamic";

const aedFmt = fmtMoney;

const moodClass: Record<string, string> = {
  EXCITED: "chip-won", INTERESTED: "chip-warm", NEUTRAL: "chip-new",
  HESITANT: "chip-warm", COLD: "chip-cold", CONFUSED: "chip-lost", ANGRY: "chip-hot",
};
const potClass: Record<string, string> = { HIGH: "chip-hot", MEDIUM: "chip-warm", LOW: "chip-cold", UNKNOWN: "chip-lost" };
const fundClass: Record<string, string> = { CASH_READY: "chip-won", BANK_APPROVED: "chip-warm", FINANCING_NEEDED: "chip-cold", NOT_DISCUSSED: "chip-lost" };

/** Visually mask a phone: keep + country code + first 2 digits + last 4 */
function maskPhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (digits.length < 8) return p;
  const last4 = digits.slice(-4);
  const first = digits.slice(0, Math.max(2, digits.length - 8));
  return `+${first} ··· ${last4}`;
}

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  // Run reconciler in the background — non-blocking
  runReconciler().catch(() => {});

  // ⚡ Parallelize all queries — was 3 sequential, now 1 round-trip via Promise.all
  const [lead, meetingActs, allProjects] = await Promise.all([
    prisma.lead.findUnique({
      where: { id },
      include: {
        owner: true,
        interestedUnits: { include: { unit: { include: { project: true } } } },
        discussed:       { include: { project: true }, orderBy: { discussedAt: "desc" } },
        activities: { orderBy: { createdAt: "desc" }, take: 25, include: { user: true } },
        callLogs:   { orderBy: { startedAt: "desc" }, take: 50, include: { user: true } },
        notes:      { orderBy: { createdAt: "desc" }, take: 10, include: { user: true } },
        assignments:{ orderBy: { assignedAt: "desc" }, take: 5, include: { user: true } },
      },
    }),
    prisma.activity.findMany({
      where: { leadId: id, type: { in: ["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({
      select: { id: true, name: true, city: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!lead) notFound();
  // Agents can only see leads they own. Redirect (307) to /leads instead of
  // notFound() because Next.js app-router notFound() renders the 404 UI but
  // returns HTTP 200 — confusing for auditors. Redirect is cleaner UX too:
  // agent lands back on their own list rather than a dead end.
  if (!(await canTouchLead(me, lead))) redirect("/leads");

  // Inventory matching — top 3 best-fit AVAILABLE units. Empty array if the
  // lead is missing budget/team or nothing matches; card hides itself in that case.
  const suggestedUnits = await bestUnitsForLead(id, 3);

  const lastBy = (t: string) => meetingActs.find(a => a.type === t)?.completedAt ?? meetingActs.find(a => a.type === t)?.scheduledAt ?? null;
  const meetingCounts = {
    officeMeetings:  { count: meetingActs.filter(a => a.type === "OFFICE_MEETING").length,  lastAt: lastBy("OFFICE_MEETING") },
    virtualMeetings: { count: meetingActs.filter(a => a.type === "VIRTUAL_MEETING").length, lastAt: lastBy("VIRTUAL_MEETING") },
    siteVisits:      { count: meetingActs.filter(a => a.type === "SITE_VISIT").length,      lastAt: lastBy("SITE_VISIT") },
  };

  // Find an in-progress visit (started but not ended) attended by me — so the
  // tracker resumes if the agent navigates away and back.
  const activeVisit = meetingActs.find(
    (a) => a.attendedByUserId === me.id && a.startedAt && !a.endedAt && a.status !== "DONE"
  );

  // Call stats aggregate (dialed / connected / not-picked etc.)
  const callStats = aggregateCalls(lead.callLogs);

  const aiClass = lead.aiScore === "HOT" ? "chip-hot" : lead.aiScore === "WARM" ? "chip-warm" : "chip-cold";
  const canReassign = me.role === "ADMIN" || me.role === "MANAGER";

  // Fetch active agents for the reassign dropdown
  const agents = canReassign
    ? await prisma.user.findMany({
        where: { active: true, role: { in: ["AGENT", "MANAGER"] } },
        orderBy: [{ team: "asc" }, { name: "asc" }],
      })
    : [];

  // SLA countdown — show timer if assigned recently and no call yet
  const callsCount = lead.callLogs.length;
  const slaMs = lead.slaFirstCallBy ? lead.slaFirstCallBy.getTime() - Date.now() : null;
  const slaActive = lead.ownerId && callsCount === 0 && slaMs !== null && slaMs > -3600_000;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        {/* NEEDS YOU BANNER */}
        {lead.needsManagerReview && (
          <div className="card p-4 border-l-4 border-amber-500 bg-amber-50">
            <div className="font-semibold text-amber-900">🚩 Needs manager attention</div>
            <div className="text-sm text-amber-800 mt-1">{lead.managerReviewReason ?? "Flagged for review"}{lead.flaggedAt && ` · since ${formatDistanceToNow(lead.flaggedAt, { addSuffix: true })}`}</div>
          </div>
        )}

        {/* DUPLICATE BANNER */}
        {(lead.duplicateCount ?? 0) > 0 && (
          <div className="card p-4 border-l-4 border-amber-500 bg-amber-50">
            <div className="font-semibold text-amber-900">🔁 This client has contacted us {lead.duplicateCount} extra {lead.duplicateCount === 1 ? "time" : "times"}</div>
            <div className="text-sm text-amber-800 mt-1">Last duplicate hit: {lead.lastDuplicateAt ? formatDistanceToNow(lead.lastDuplicateAt, { addSuffix: true }) : "—"}. Treat as high intent — they keep coming back.</div>
          </div>
        )}

        {/* SLA TIMER */}
        {slaActive && (
          <div className={`card p-4 border-l-4 ${slaMs > 5 * 60_000 ? "border-emerald-500 bg-emerald-50" : slaMs > 0 ? "border-amber-500 bg-amber-50" : "border-red-500 bg-red-50"}`}>
            <div className="text-sm font-semibold">
              {slaMs > 0
                ? `⏱  Call within ${Math.max(0, Math.floor(slaMs / 60_000))}m ${Math.max(0, Math.floor((slaMs % 60_000) / 1000))}s`
                : `🚨 Call SLA breached ${Math.floor(-slaMs / 60_000)}m ago`}
            </div>
            <div className="text-xs text-gray-600 mt-0.5">Logging a call clears this timer. Admin is auto-notified if you don't call.</div>
          </div>
        )}

        {/* Header */}
        <div className="card p-5">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold">{lead.name}{lead.altName && <span className="text-base font-medium text-gray-600"> & {lead.altName}</span>}</h2>
                {lead.aiScore && <span className={`chip ${aiClass}`}>{lead.aiScore} · {lead.aiScoreValue}</span>}
                <span className="chip chip-warm">{lead.status.replaceAll("_"," ")}</span>
                {lead.currentStatus && <span className="chip src">{lead.currentStatus}</span>}
                {lead.moodStatus && <span className={`chip ${moodClass[lead.moodStatus] ?? "src"}`}>😊 {lead.moodStatus}</span>}
                <span className={`chip ${lead.forwardedTeam === "India" ? "src-csv" : "src-wa"}`}>{lead.forwardedTeam ?? "—"}</span>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {lead.email && `${lead.email}`}
                {lead.company && ` · ${lead.company}`}
                {lead.city && ` · ${lead.city}, ${lead.country}`}
              </div>
              <LeadActionsClient
                leadId={lead.id}
                phone={lead.phone}
                altPhone={lead.altPhone}
                email={lead.email}
                currentOwnerId={lead.ownerId}
                canReassign={canReassign}
                agents={agents.map(a => ({ id: a.id, name: a.name, role: a.role, team: a.team, avatarColor: a.avatarColor }))}
                phoneMasked={maskPhone(lead.phone)}
                altPhoneMasked={maskPhone(lead.altPhone)}
                leadName={lead.name}
                agentName={me.name}
                acefoneEnabled={acefoneEnabled()}
                acefoneMappedForUser={!!me.acefoneAgentId}
              />
              <div className="mt-3">
                <SiteVisitTracker
                  leadId={lead.id}
                  leadName={lead.name}
                  activeVisit={activeVisit && activeVisit.startedAt && (activeVisit.type === "OFFICE_MEETING" || activeVisit.type === "SITE_VISIT") ? {
                    activityId: activeVisit.id,
                    type: activeVisit.type,
                    startedAt: activeVisit.startedAt.toISOString(),
                  } : null}
                />
              </div>
              <div className="mt-2">
                <AdvancedActivityLogger
                  leadId={lead.id}
                  team={(lead.forwardedTeam === "Dubai" || lead.forwardedTeam === "India") ? lead.forwardedTeam : null}
                  travelRatePerKm={await getTravelRatePerKmInr()}
                />
              </div>
            </div>
          </div>
        </div>

        {/* REMARKS — full conversation history from import sheet.
            Moved to the top of the left column + ALWAYS rendered (even when
            remarks is null/empty) so Lalit can't miss it. Compute the entry
            count + char count outside the JSX (the previous IIFE pattern was
            valid but obscured what was happening).
            The raw text uses runs of `,,,,` between call entries (MIS sheet
            convention); InlineEdit's textarea read-view splits those into
            paragraph breaks for readability. */}
        <RemarksCard leadId={lead.id} remarks={lead.remarks} />

        <div className="card p-5 border-l-4 border-[#c9a24b]">
          <div className="flex items-center gap-2 mb-2">
            <span className="ai-tag">WHO IS THE CLIENT</span>
            <span className="text-xs text-gray-500">— full situation, not keywords · click to edit</span>
          </div>
          <div className="text-sm text-gray-800 leading-relaxed">
            <InlineEdit leadId={lead.id} field="whoIsClient" type="textarea" value={lead.whoIsClient ?? ""}
              placeholder="e.g. NRI from Mumbai based in Dubai. Senior Director at consulting firm. Husband already owns at Burj Vista. Looking for parents who'll relocate next year. Wife is decision maker." />
          </div>
        </div>

        {/* BANT verdict — prominent, decision-driving */}
        <div className={`card p-4 border-l-4 ${
          lead.bantStatus === "QUALIFIES" ? "border-emerald-500 bg-emerald-50" :
          lead.bantStatus === "NOT_QUALIFIED" ? "border-red-500 bg-red-50" :
          "border-amber-400 bg-amber-50"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold tracking-widest text-gray-600">BANT VERDICT</span>
            <span className="text-[10px] text-gray-500">Budget · Authority · Need · Timeline</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <InlineEdit leadId={lead.id} field="bantStatus" type="select" value={lead.bantStatus}
              options={[
                {value:"UNDER_REVIEW",label:"🤔 Under review"},
                {value:"QUALIFIES",label:"✅ Qualifies"},
                {value:"NOT_QUALIFIED",label:"❌ Not qualified"},
              ]} />
            <div className="text-xs text-gray-600 flex-1 min-w-[200px]">
              Why: <InlineEdit leadId={lead.id} field="bantReason" value={lead.bantReason ?? ""} placeholder="One-line reason (e.g. 'budget too low for any of our inventory')" />
            </div>
          </div>
        </div>

        <div className="card p-5">
          <div className="font-semibold mb-3">Qualification <span className="text-[10px] text-gray-400 font-normal">(click any value to edit)</span></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-500">🏢 Company</div>
              <InlineEdit leadId={lead.id} field="company" value={lead.company ?? ""} placeholder="e.g. Emirates NBD, TCS" />
            </div>
            <div>
              <div className="text-xs text-gray-500">📱 Alt phone</div>
              <InlineEdit leadId={lead.id} field="altPhone" value={lead.altPhone ?? ""} placeholder="+91…" />
            </div>
            <div>
              <div className="text-xs text-gray-500">Potential</div>
              <InlineEdit leadId={lead.id} field="potential" type="select" value={lead.potential ?? ""}
                options={[{value:"HIGH",label:"High"},{value:"MEDIUM",label:"Medium"},{value:"LOW",label:"Low"},{value:"UNKNOWN",label:"Unknown"}]} />
            </div>
            <div>
              <div className="text-xs text-gray-500">Fund Readiness</div>
              <InlineEdit leadId={lead.id} field="fundReadiness" type="select" value={lead.fundReadiness ?? ""}
                options={[{value:"CASH_READY",label:"Cash Ready"},{value:"BANK_APPROVED",label:"Bank Approved"},{value:"FINANCING_NEEDED",label:"Financing Needed"},{value:"NOT_DISCUSSED",label:"Not Discussed"}]} />
            </div>
            <div>
              <div className="text-xs text-gray-500">When can invest</div>
              <InlineEdit leadId={lead.id} field="whenCanInvest" type="select" value={lead.whenCanInvest ?? ""}
                options={[{value:"IMMEDIATE",label:"Immediate"},{value:"THIRTY_DAYS",label:"30 days"},{value:"THREE_MONTHS",label:"3 months"},{value:"SIX_PLUS_MONTHS",label:"6+ months"},{value:"WINDOW_SHOPPING",label:"Just browsing"},{value:"UNKNOWN",label:"Unknown"}]} />
            </div>
            <div>
              <div className="text-xs text-gray-500">Mood</div>
              <InlineEdit leadId={lead.id} field="moodStatus" type="select" value={lead.moodStatus ?? ""}
                options={[{value:"EXCITED",label:"😀 Excited"},{value:"INTERESTED",label:"🙂 Interested"},{value:"NEUTRAL",label:"😐 Neutral"},{value:"HESITANT",label:"🤔 Hesitant"},{value:"COLD",label:"🧊 Cold"},{value:"CONFUSED",label:"😵 Confused"},{value:"ANGRY",label:"😠 Angry"}]} />
            </div>
            <div>
              <div className="text-xs text-gray-500">Categorization</div>
              {/* Dropdown with the values Lalit's team actually uses in the MIS sheet.
                  Free-text still allowed via the import path; UI nudges agents toward
                  the canonical set so the Categorization → AI-score mapping works. */}
              <InlineEdit leadId={lead.id} field="categorization" type="select" value={lead.categorization ?? ""}
                options={[
                  {value:"🔥 Highly Responsive — picks calls regularly",label:"🔥 Highly Responsive"},
                  {value:"🙂 Responsive",label:"🙂 Responsive"},
                  {value:"🤔 Sometimes responsive",label:"🤔 Sometimes responsive"},
                  {value:"🧊 Cold / not picking",label:"🧊 Cold / not picking"},
                  {value:"📵 Switched off / wrong number",label:"📵 Switched off / wrong number"},
                  {value:"❌ Not interested / dropped",label:"❌ Not interested / dropped"},
                  {value:"NRI Investor",label:"NRI Investor"},
                  {value:"NRI End-user",label:"NRI End-user"},
                  {value:"UAE Resident",label:"UAE Resident"},
                  {value:"First-time buyer",label:"First-time buyer"},
                ]} />
            </div>
            <div>
              <div className="text-xs text-gray-500">💼 Profession</div>
              <InlineEdit leadId={lead.id} field="profession" type="select" value={lead.profession ?? ""}
                options={[
                  {value:"JOB",label:"Job (salaried)"},
                  {value:"SELF_EMPLOYED",label:"Self-employed"},
                  {value:"BUSINESS_OWNER",label:"Business owner"},
                  {value:"INVESTOR",label:"Investor"},
                  {value:"RETIRED",label:"Retired"},
                  {value:"STUDENT",label:"Student"},
                  {value:"OTHER",label:"Other"},
                ]} />
            </div>
            <div>
              <div className="text-xs text-gray-500">🔗 LinkedIn</div>
              {lead.linkedInUrl && (
                <a href={lead.linkedInUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0b1a33] underline block truncate">View profile ↗</a>
              )}
              <InlineEdit leadId={lead.id} field="linkedInUrl" value={lead.linkedInUrl ?? ""} placeholder="https://linkedin.com/in/…" />
            </div>
            <div>
              <div className="text-xs text-gray-500">Configuration</div>
              <InlineEdit leadId={lead.id} field="configuration" value={lead.configuration ?? ""} placeholder="2BR / Villa / PH" />
            </div>
            <div>
              <div className="text-xs text-gray-500">Budget min</div>
              <InlineEdit leadId={lead.id} field="budgetMin" type="number" value={lead.budgetMin ?? ""} placeholder="e.g. 2500000" />
            </div>
            <div>
              <div className="text-xs text-gray-500">Stage</div>
              <InlineEdit leadId={lead.id} field="status" type="select" value={lead.status}
                options={[{value:"NEW",label:"New"},{value:"CONTACTED",label:"Contacted"},{value:"QUALIFIED",label:"Qualified"},{value:"SITE_VISIT",label:"Site Visit"},{value:"NEGOTIATION",label:"Negotiation"},{value:"BOOKING_DONE",label:"Booking Done"}]} />
            </div>
          </div>
        </div>

        <div className="card p-5">
          <div className="font-semibold mb-3">Scheduling & next action <span className="text-[10px] text-gray-400 font-normal">(click to edit)</span></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="p-3 border border-[#e5e7eb] rounded-lg">
              <div className="text-xs text-gray-500">📅 Meeting</div>
              <InlineEdit leadId={lead.id} field="meetingDate" type="date" value={toISTLocalInput(lead.meetingDate)} placeholder="Not scheduled" />
            </div>
            <div className="p-3 border border-[#e5e7eb] rounded-lg">
              <div className="text-xs text-gray-500">🏢 Site Visit</div>
              <InlineEdit leadId={lead.id} field="siteVisitDate" type="date" value={toISTLocalInput(lead.siteVisitDate)} placeholder="Not scheduled" />
            </div>
            <div className="p-3 border border-[#e5e7eb] rounded-lg">
              <div className="text-xs text-gray-500">🔁 Follow-up</div>
              <InlineEdit leadId={lead.id} field="followupDate" type="date" value={toISTLocalInput(lead.followupDate)} placeholder="Not scheduled" />
            </div>
            <div className="p-3 border border-[#e5e7eb] rounded-lg bg-amber-50 border-amber-200">
              <div className="text-xs text-amber-700">✅ To Do</div>
              <InlineEdit leadId={lead.id} field="todoNext" value={lead.todoNext ?? ""} placeholder="Decide what's next" />
            </div>
          </div>
        </div>

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
          <div className="space-y-3">
            {lead.activities.map((a) => {
              const v = activityVisual(a.type);
              return (
                <div key={a.id} className="flex gap-3 items-start">
                  <div className={`w-8 h-8 rounded-full ${v.dot} text-white flex items-center justify-center text-sm flex-none shadow-sm`}>{v.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm"><b>{a.title}</b> <span className="text-[10px] text-gray-400 ml-1">· {v.label}</span></div>
                    <div className="text-xs text-gray-500">{a.user?.name ?? "System"} · {fmtIST(a.createdAt)} IST</div>
                    {a.description && <div className="text-sm mt-1 text-gray-700 whitespace-pre-wrap">{a.description}</div>}
                  </div>
                </div>
              );
            })}
            {lead.activities.length === 0 && <div className="text-sm text-gray-500">No activity yet.</div>}
          </div>
        </div>
      </div>

      {/* Right rail */}
      <div className="space-y-4">
        {lead.address && (
          <div className="card p-5"><div className="font-semibold mb-2">📍 Address</div><p className="text-sm text-gray-700">{lead.address}</p></div>
        )}
        <div className="card p-5">
          <LeadMeetingClient leadId={lead.id} counts={meetingCounts} />
        </div>

        <div className="card p-5">
          <LeadProjectsClient
            leadId={lead.id}
            initial={lead.discussed.map(d => ({
              projectId: d.projectId,
              status: d.status,
              discussedAt: d.discussedAt.toISOString(),
              project: { name: d.project.name, city: d.project.city },
            }))}
            allProjects={allProjects}
          />
        </div>

        {/* Smart CMA — branded PDF with units + payment plan + ROI for the client */}
        <div className="card p-3 border-l-4 border-[#c9a24b] bg-amber-50/40">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <div className="font-semibold text-sm">📄 Smart CMA · client-ready PDF</div>
              <div className="text-[11px] text-gray-600">Cover · requirements · top-3 units · comparison · payment plan</div>
            </div>
            <a
              href={`/api/leads/${lead.id}/cma`}
              className="btn btn-primary text-xs flex-shrink-0"
              download
            >⬇ Download PDF</a>
          </div>
        </div>

        {suggestedUnits.length > 0 && (
          <SuggestedUnitsCard
            leadId={lead.id}
            units={suggestedUnits.map((u) => ({
              id: u.id,
              code: u.code,
              configuration: u.configuration,
              carpetArea: u.carpetArea,
              floor: u.floor,
              view: u.view,
              priceBase: u.priceBase,
              score: u.score,
              project: {
                id: u.project.id,
                name: u.project.name,
                city: u.project.city,
                country: u.project.country,
                area: u.project.area,
                heroColor: u.project.heroColor,
              },
            }))}
            alreadyAddedUnitIds={lead.interestedUnits.map((p) => p.unitId)}
          />
        )}

        <div className="card p-5">
          <div className="font-semibold mb-2">Interested properties (unit-level)</div>
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

        {/* Assignment history — admin/manager only. Agents shouldn't see who else
            owned the lead before them (avoids inter-agent friction + cherry-picking). */}
        {(me.role === "ADMIN" || me.role === "MANAGER") && (
          <div className="card p-5">
            <div className="font-semibold mb-2">Assignment history</div>
            <div className="space-y-2 text-sm">
              {lead.assignments.length === 0 && <div className="text-gray-500">Not assigned yet.</div>}
              {lead.assignments.map(a => (
                <div key={a.id} className="text-xs">
                  <b>{a.user.name}</b> · {a.reason ?? "—"}
                  <div className="text-gray-500">{fmtIST(a.assignedAt)} IST</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">📞 Call history</div>
            <div className="text-[10px] text-gray-500">{callStats.total} total</div>
          </div>
          {/* Breakdown badges */}
          <div className="grid grid-cols-4 gap-1 text-center text-xs mb-3">
            <div className="p-1.5 rounded bg-blue-50 border border-blue-200">
              <div className="text-base font-bold text-blue-700">{callStats.total}</div>
              <div className="text-[10px] text-gray-600">Dialed</div>
            </div>
            <div className="p-1.5 rounded bg-emerald-50 border border-emerald-200">
              <div className="text-base font-bold text-emerald-700">{callStats.connected}</div>
              <div className="text-[10px] text-gray-600">Connected</div>
            </div>
            <div className="p-1.5 rounded bg-red-50 border border-red-200">
              <div className="text-base font-bold text-red-700">{callStats.notPicked}</div>
              <div className="text-[10px] text-gray-600">Not picked</div>
            </div>
            <div className="p-1.5 rounded bg-amber-50 border border-amber-200">
              <div className="text-base font-bold text-amber-700">{callStats.callback}</div>
              <div className="text-[10px] text-gray-600">Callback</div>
            </div>
          </div>
          {callStats.notPickedStreak >= 2 && (
            <div className="text-xs bg-amber-50 border border-amber-300 rounded p-2 mb-3 text-amber-800">
              ⚠ <b>{callStats.notPickedStreak} not-picked in a row</b> — try different time slot or WhatsApp
            </div>
          )}
          {/* Chronological log — date · agent · outcome · remark */}
          <div className="space-y-2 text-sm max-h-[420px] overflow-y-auto pr-1">
            {lead.callLogs.map((c) => (
              <div key={c.id} className="border-l-2 border-[#e5e7eb] pl-3 py-1">
                <div className="text-[11px] text-gray-500">
                  <b>{c.user.name}</b> · {fmtISTParen(c.startedAt)} IST
                  {c.durationSec ? ` · ${Math.floor(c.durationSec/60)}m ${c.durationSec%60}s` : ""}
                  {c.ivrProvider && <span className="ml-1 chip src text-[9px]">{c.ivrProvider}</span>}
                </div>
                <div className="text-xs font-semibold">{c.outcome.replaceAll("_"," ")}</div>
                {c.notes && <div className="text-xs mt-0.5 text-gray-700 whitespace-pre-wrap">{c.notes}</div>}
                {c.recordingUrl && (
                  <div className="mt-1.5">
                    <audio controls preload="none" src={c.recordingUrl} className="w-full h-8" />
                    <a href={c.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#0b1a33] underline">Open recording in new tab ↗</a>
                  </div>
                )}
              </div>
            ))}
            {lead.callLogs.length === 0 && <div className="text-gray-500 text-xs">No calls yet.</div>}
          </div>
        </div>

        <Link href="/leads" className="text-xs text-[#0b1a33] font-semibold inline-block">← Back to leads</Link>
      </div>
    </div>
  );
}
