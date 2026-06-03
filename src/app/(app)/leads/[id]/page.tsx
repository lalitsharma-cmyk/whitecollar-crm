import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { fmtIST12, toISTLocalInput } from "@/lib/datetime";
import Link from "next/link";
import { fmtMoney } from "@/lib/money";
import { requireUser } from "@/lib/auth";
import LeadActionsClient from "@/components/LeadActionsClient";
import LeadProjectsClient from "@/components/LeadProjectsClient";
import LeadMeetingClient from "@/components/LeadMeetingClient";
import SiteVisitTracker from "@/components/SiteVisitTracker";
import SiteVisitChecklist from "@/components/SiteVisitChecklist";
// EOIWorkflowCard removed by Lalit (Round 3) — "Remove EOI for now".
// EOIPanel (Agent K's replacement) is built and available in src/components/EOIPanel.tsx
// for a future round when EOI is ready to surface again.
import AdvancedActivityLogger from "@/components/AdvancedActivityLogger";
import { getTravelRatePerKmInr } from "@/lib/settings";
import { runReconciler } from "@/lib/reconciler";
import { activityVisual } from "@/lib/activityIcon";
import InlineEdit from "@/components/InlineEdit";
import { acefoneEnabled } from "@/lib/acefone";
import { canTouchLead } from "@/lib/leadScope";
import { projectWhereForUser, teamToCountry } from "@/lib/propertyScope";
// CallHistoryCard removed — folded into ConversationStreamCard below.
import ConversationStreamCard from "@/components/ConversationStreamCard";
import StickyNoteWidget from "@/components/StickyNoteWidget";
import BuyingSignalsCard from "@/components/BuyingSignalsCard";
import NextBestActionCard from "@/components/NextBestActionCard";
import LeadScoreBreakdown from "@/components/LeadScoreBreakdown";
import { explainScore } from "@/lib/leadRescorer";
import { topScoreFactors } from "@/lib/scoreExplain";
import { aiEnabled } from "@/lib/ai";
import LeadNotesCard from "@/components/LeadNotesCard";
import VoiceNoteRecorder from "@/components/VoiceNoteRecorder";
import LeadReassignClient from "@/components/LeadReassignClient";
import RejectLeadModal from "@/components/RejectLeadModal";
import LeadMobileTabs from "@/components/LeadMobileTabs";
import LeadTagsEditor from "@/components/LeadTagsEditor";
// PrintButton removed — Lalit asked for the Print action to be dropped.
import BestCallTimeChip from "@/components/BestCallTimeChip";
import LeadJourneyBar from "@/components/LeadJourneyBar";
import { formatBudget } from "@/lib/budgetParse";
import LinkedContactsCard from "@/components/LinkedContactsCard";
import InvestorBanner from "@/components/InvestorBanner";
import CustomerIntelligenceCard from "@/components/CustomerIntelligenceCard";
import BANTSuggestions from "@/components/BANTSuggestions";
import type { BantSuggestions } from "@/lib/bantAutoFill";

export const dynamic = "force-dynamic";

const aedFmt = fmtMoney;

const moodClass: Record<string, string> = {
  EXCITED: "chip-won", INTERESTED: "chip-warm", NEUTRAL: "chip-new",
  HESITANT: "chip-warm", COLD: "chip-cold", CONFUSED: "chip-lost", ANGRY: "chip-hot",
};
const potClass: Record<string, string> = { HIGH: "chip-hot", MEDIUM: "chip-warm", LOW: "chip-cold", UNKNOWN: "chip-lost" };
function potentialLabel(p: string | null): string {
  if (p === "HIGH")   return "🔥 Hot";
  if (p === "MEDIUM") return "🌤 Warm";
  if (p === "LOW")    return "❄ Cold";
  return "—";
}
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

  // ⚡ Parallelize all queries — was 3 sequential, now 1 round-trip via Promise.all.
  // 4th query: get-or-create the agent's sticky note for this lead. We do it
  // here so the widget can render synchronously without an extra round-trip.
  const [lead, meetingActs, allProjects, stickyNote] = await Promise.all([
    prisma.lead.findUnique({
      where: { id },
      include: {
        owner: true,
        interestedUnits: { include: { unit: { include: { project: true } } } },
        discussed:       { include: { project: true }, orderBy: { discussedAt: "desc" } },
        activities: { orderBy: { createdAt: "desc" }, take: 25, include: { user: true } },
        callLogs:   { orderBy: { startedAt: "desc" }, take: 50, include: { user: true } },
        waMessages: { orderBy: { receivedAt: "desc" }, take: 20 },
        notes:      { orderBy: { createdAt: "desc" }, take: 10, include: { user: true } },
        assignments:{ orderBy: { assignedAt: "desc" }, take: 5, include: { user: true } },
      },
    }),
    prisma.activity.findMany({
      where: { leadId: id, type: { in: ["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({
      where: projectWhereForUser(me),
      select: { id: true, name: true, city: true, country: true },
      orderBy: { name: "asc" },
    }),
    // Sticky note — private to the calling agent. Upsert so a new row is
    // created on first render of a lead (empty body, just to anchor updatedAt).
    prisma.stickyNote.upsert({
      where: { leadId_userId: { leadId: id, userId: me.id } },
      create: { leadId: id, userId: me.id, body: "" },
      update: {},
    }),
  ]);
  if (!lead) notFound();
  // Agents can only see leads they own. Redirect (307) to /leads instead of
  // notFound() because Next.js app-router notFound() renders the 404 UI but
  // returns HTTP 200 — confusing for auditors. Redirect is cleaner UX too:
  // agent lands back on their own list rather than a dead end.
  if (!(await canTouchLead(me, lead))) redirect("/leads");

  // Parse BANT auto-fill suggestions stored as JSON on the Lead model.
  const bantSuggestions: BantSuggestions | null = (() => {
    try { return lead.bantSuggestionsJson ? JSON.parse(lead.bantSuggestionsJson) : null; }
    catch { return null; }
  })();

  // Investor-history quick counts for the banner (Agent V, Round 6).
  // Match the new lead against the existing pipeline on phone / email /
  // name+city. If matches exist, the banner surfaces "returning client".
  // Computed on the fly — no schema change.
  const { findMatchingLeads } = await import("@/lib/investorMatch");
  const investorMatches = await findMatchingLeads({
    name: lead.name, phone: lead.phone, email: lead.email,
    city: lead.city, excludeLeadId: lead.id,
  });
  const bookingsCount = investorMatches.filter(m => m.bookingDoneAt != null || m.status === "WON").length;
  const matchedLeadIds = investorMatches.map(m => m.id);

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

  const aiClass = lead.aiScore === "HOT" ? "chip-hot" : lead.aiScore === "WARM" ? "chip-warm" : "chip-cold";
  const canReassign = me.role === "ADMIN" || me.role === "MANAGER";

  // Rule-based breakdown of the AI score (no AI call) — mirrors the exact
  // arithmetic of the stateless rescorer so the displayed score matches
  // lead.aiScoreValue. Pure synchronous computation over already-loaded data.
  const scoreExplanation = explainScore({
    categorization: lead.categorization,
    bantStatus: lead.bantStatus,
    fundReadiness: lead.fundReadiness as string | null,
    potential: lead.potential as string | null,
    budgetMin: lead.budgetMin,
    budgetMax: lead.budgetMax,
    callLogs: lead.callLogs.map((c) => ({ outcome: c.outcome, startedAt: c.startedAt })),
    waMessages: lead.waMessages.map((m) => ({ direction: m.direction, receivedAt: m.receivedAt })),
    activities: lead.activities.map((a) => ({ type: a.type, status: a.status })),
    lastTouchedAt: lead.lastTouchedAt ?? lead.createdAt,
  });

  // Top 3–5 signed contributors for the compact "Why this score" strip. Pure
  // transform over the factors explainScore() already produced — no new weights.
  const topFactors = topScoreFactors(
    scoreExplanation.factors,
    { budgetMin: lead.budgetMin, budgetCurrency: lead.budgetCurrency },
    5,
  );
  // When an AI provider is configured the rescorer may override the stored
  // aiScoreValue/aiScore with the model's own number; the breakdown card uses
  // this flag to stay truthful about what it's explaining (see component).
  const aiScoringOn = aiEnabled();

  // Travel rate fetched once — used by the AdvancedActivityLogger which now
  // lives at the bottom of the RIGHT column (moved from header per Lalit's
  // ask: "Move this [Expo / Dubai site visit] button down.").
  const travelRatePerKmInr = await getTravelRatePerKmInr();

  // Currency used to format budget cells — "12M AED" for Dubai, "1.2 Cr" for
  // India. Falls back to AED when the field is null (Dubai default).
  const budgetCcy: "AED" | "INR" = lead.budgetCurrency === "INR" ? "INR" : "AED";

  // Fetch active agents for the reassign dropdown — filtered by the lead's team
  // so the picker only shows agents on the same team (+ Lalit always included).
  const agents = canReassign
    ? lead.forwardedTeam
      ? await prisma.user.findMany({
          where: {
            active: true,
            OR: [
              { role: { in: ["AGENT", "MANAGER"] }, team: lead.forwardedTeam },
              { email: "lalitsharma@whitecollarrealty.com" },
            ],
          },
          orderBy: { name: "asc" },
        })
      : await prisma.user.findMany({
          where: { active: true, role: { in: ["AGENT", "MANAGER"] } },
          orderBy: { name: "asc" },
        })
    : [];

  // SLA countdown — show timer if assigned recently and no call yet
  const callsCount = lead.callLogs.length;
  const slaMs = lead.slaFirstCallBy ? lead.slaFirstCallBy.getTime() - Date.now() : null;
  const slaActive = lead.ownerId && callsCount === 0 && slaMs !== null && slaMs > -3600_000;

  // Follow-up overdue — true when followupDate is in the past and the lead is
  // still active (not LOST or WON). Computed server-side so there's no flash.
  const followupOverdue = lead.followupDate &&
    lead.followupDate < new Date() &&
    lead.status !== "LOST" &&
    lead.status !== "WON";

  // ── JSX render consts — extracted so they can be rendered in DIFFERENT
  // positions on mobile vs desktop without duplicating ~100 lines of JSX.
  // Lalit's mobile asks:
  //   • "Qualification moving up wards in mobile" → BANT + Qual surface near
  //     the top of the left column on phones (lg:hidden), and stay at the
  //     top of the right column on desktop (hidden lg:block).
  //   • "move timeline at below" → Timeline lives in the left column on
  //     desktop, but renders at the very BOTTOM on mobile (after all the
  //     right-rail cards).
  // Each ref renders an independent React tree per call site, so the
  // InlineEdit components inside have their own state — safe to render twice.
  // ── BANT chip helper ──
  // Each chip turns GREEN when the underlying field has a meaningful value,
  // RED when explicitly NOT_QUALIFIED / NOT_DISCUSSED / UNKNOWN, and AMBER
  // (neutral) when the field is null/empty (not yet asked). Lalit's ask was
  // "remove why → green/red signals" so we drop the bantReason free-text row.
  const bantBudgetFilled = lead.budgetMin != null && lead.budgetMin > 0;
  const bantBudgetBad = lead.fundReadiness === "NOT_DISCUSSED";
  const bantAuthFilled = lead.authorityLevel != null && lead.authorityLevel !== "UNKNOWN";
  const bantAuthBad = lead.authorityLevel === "UNKNOWN";
  const bantNeedFilled = !!(lead.needSummary && lead.needSummary.trim());
  const bantTimeFilled = lead.whenCanInvest != null && lead.whenCanInvest !== "UNKNOWN";
  const bantTimeBad = lead.whenCanInvest === "UNKNOWN";

  // B-17 — at-a-glance qualification completeness. Lalit (Bucket B) wanted BANT
  // "visible at a glance". The four chips below already capture each value, so
  // rather than add a second redundant card we surface a single count of how
  // many of Budget / Authority / Need / Timeline are filled. (We intentionally
  // do NOT re-add the bantReason free-text row — Lalit asked to drop it in
  // favour of the green/red signals.)
  const bantFilledCount = [bantBudgetFilled, bantAuthFilled, bantNeedFilled, bantTimeFilled].filter(Boolean).length;

  // Tailwind colour map for a BANT chip. `good` overrides `bad` (i.e. if the
  // field has a filled value it's green even when the related signal is null).
  function bantChipClass(good: boolean, bad: boolean): string {
    if (good) return "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/30";
    if (bad) return "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/30";
    return "border-amber-200 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30";
  }

  // Client Summary — auto-assembled from structured fields, all inline-editable.
  // Replaces the removed "WHO IS THE CLIENT" free-text card.
  const lastDiscussionDate = lead.callLogs[0]?.startedAt ?? lead.lastTouchedAt ?? null;
  const lastDiscussionLabel = lastDiscussionDate
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "2-digit" }).format(new Date(lastDiscussionDate))
    : null;
  const clientSummaryCard = (
    <div data-lead-section="overview" className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold tracking-widest text-gray-600 dark:text-slate-300">CLIENT SUMMARY</span>
        <span className="text-[10px] text-gray-400 dark:text-slate-500">— click any value to edit</span>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 w-32 shrink-0">Client Type</span>
          <InlineEdit leadId={lead.id} field="clientType" type="select" value={lead.clientType ?? ""}
            options={[
              {value:"INVESTOR",label:"Investor"},
              {value:"END_USER",label:"End User"},
              {value:"BOTH",label:"Both"},
              {value:"UNCLEAR",label:"Unclear"},
            ]} placeholder="Not set" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 w-32 shrink-0">Budget</span>
          <InlineEdit leadId={lead.id} field="budgetMin" value={lead.budgetMin ?? ""}
            display={lead.budgetMin ? formatBudget(lead.budgetMin, budgetCcy) : undefined}
            parseAs="budget" placeholder="Not set"
            editHint={budgetCcy === "INR" ? "type 30L · 3Cr · 500K" : "type 2.5M · 500K"} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 w-32 shrink-0">Requirement</span>
          <InlineEdit leadId={lead.id} field="needSummary" value={lead.needSummary ?? ""} placeholder="Not set" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 w-32 shrink-0">Configuration</span>
          <InlineEdit leadId={lead.id} field="configuration" value={lead.configuration ?? ""} placeholder="2BR / Villa / PH" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 w-32 shrink-0">Decision Maker</span>
          <InlineEdit leadId={lead.id} field="authorityLevel" type="select" value={lead.authorityLevel ?? ""}
            options={[
              {value:"DECISION_MAKER",label:"✅ Decision maker"},
              {value:"INFLUENCER",label:"🤝 Influencer"},
              {value:"GATEKEEPER",label:"🚧 Gatekeeper"},
              {value:"UNKNOWN",label:"❓ Unknown"},
            ]} placeholder="Not set" />
        </div>
        {lastDiscussionLabel && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 w-32 shrink-0">Last Discussion</span>
            <span className="text-xs text-gray-600 dark:text-slate-300">{lastDiscussionLabel}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 w-32 shrink-0">Next Action</span>
          <InlineEdit leadId={lead.id} field="todoNext" value={lead.todoNext ?? ""} placeholder="Not set" />
        </div>
      </div>
    </div>
  );

  const bantCard = (
    <div data-lead-section="overview" className={`card p-4 border-l-4 ${
      lead.bantStatus === "QUALIFIES" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" :
      lead.bantStatus === "NOT_QUALIFIED" ? "border-red-500 bg-red-50 dark:bg-red-900/20" :
      "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
    }`}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold tracking-widest text-gray-600 dark:text-slate-300">BANT VERDICT</span>
          <span className="text-[10px] text-gray-500 dark:text-slate-400">Budget · Authority · Need · Timeline</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            bantFilledCount === 4 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-green-400" :
            bantFilledCount === 0 ? "bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400" :
            "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-yellow-300"
          }`}>
            {bantFilledCount}/4 captured
          </span>
        </div>
        <InlineEdit leadId={lead.id} field="bantStatus" type="select" value={lead.bantStatus}
          options={[
            {value:"UNDER_REVIEW",label:"🤔 Under review"},
            {value:"QUALIFIES",label:"✅ Qualifies"},
            {value:"NOT_QUALIFIED",label:"❌ Not qualified"},
          ]} />
      </div>
      {/* 4 chips — one per BANT letter. Click any value inside to edit. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* B — Budget. Backed by budgetMin + fundReadiness. */}
        <div className={`p-2.5 rounded border ${bantChipClass(bantBudgetFilled, bantBudgetBad)}`}>
          <div className="text-[10px] font-bold tracking-widest text-gray-600 dark:text-slate-300">💰 B · BUDGET</div>
          <div className="text-sm mt-0.5">
            <InlineEdit
              leadId={lead.id}
              field="budgetMin"
              value={lead.budgetMin ?? ""}
              display={lead.budgetMin ? formatBudget(lead.budgetMin, budgetCcy) : undefined}
              parseAs="budget"
              editHint={budgetCcy === "INR" ? "type 30L · 3Cr · 500K" : "type 2.5M · 500K"}
              placeholder={budgetCcy === "INR" ? "e.g. 3 Cr" : "e.g. 2.5M"}
            />
          </div>
          <div className="text-[10px] text-gray-600 dark:text-slate-300 mt-1">Fund: <InlineEdit leadId={lead.id} field="fundReadiness" type="select" value={lead.fundReadiness ?? ""}
            options={[
              {value:"IMMEDIATE_BUYER",   label:"🟢 Immediate Buyer"},
              {value:"SHORT_TERM_BUYER",  label:"🟡 Short-Term Buyer"},
              {value:"CONDITIONAL_BUYER", label:"🔵 Conditional Buyer"},
              {value:"FINANCED_BUYER",    label:"🟣 Financed Buyer"},
              {value:"FUTURE_BUYER",      label:"🔴 Future Buyer"},
              {value:"CASH_READY",        label:"💵 Cash Ready"},
              {value:"BANK_APPROVED",     label:"🏦 Bank Approved"},
              {value:"FINANCING_NEEDED",  label:"📋 Financing Needed"},
              {value:"NOT_DISCUSSED",     label:"— Not discussed"},
            ]} /></div>
        </div>
        {/* A — Authority. New field authorityLevel. */}
        <div className={`p-2.5 rounded border ${bantChipClass(bantAuthFilled, bantAuthBad)}`}>
          <div className="text-[10px] font-bold tracking-widest text-gray-600 dark:text-slate-300">👤 A · AUTHORITY</div>
          <div className="text-sm mt-0.5">
            <InlineEdit leadId={lead.id} field="authorityLevel" type="select" value={lead.authorityLevel ?? ""}
              options={[
                {value:"DECISION_MAKER",label:"✅ Decision maker"},
                {value:"INFLUENCER",label:"🤝 Influencer"},
                {value:"GATEKEEPER",label:"🚧 Gatekeeper"},
                {value:"UNKNOWN",label:"❓ Unknown"},
              ]} />
          </div>
        </div>
        {/* N — Need. New free-text needSummary. */}
        <div className={`p-2.5 rounded border ${bantChipClass(bantNeedFilled, false)}`}>
          <div className="text-[10px] font-bold tracking-widest text-gray-600 dark:text-slate-300">🎯 N · NEED</div>
          <div className="text-sm mt-0.5">
            <InlineEdit leadId={lead.id} field="needSummary" value={lead.needSummary ?? ""} placeholder="e.g. parents relocating, rental yield, kid's school" />
          </div>
        </div>
        {/* T — Timeline. Backed by whenCanInvest. */}
        <div className={`p-2.5 rounded border ${bantChipClass(bantTimeFilled, bantTimeBad)}`}>
          <div className="text-[10px] font-bold tracking-widest text-gray-600 dark:text-slate-300">⏱ T · TIMELINE</div>
          <div className="text-sm mt-0.5">
            <InlineEdit leadId={lead.id} field="whenCanInvest" type="select" value={lead.whenCanInvest ?? ""}
              options={[
                {value:"IMMEDIATE",       label:"⚡ On Spot / Immediate"},
                {value:"THIRTY_DAYS",     label:"📅 Within 1 Month"},
                {value:"THREE_MONTHS",    label:"✈ Will Visit Dubai First"},
                {value:"SIX_PLUS_MONTHS", label:"⏳ Not in 6 Months"},
                {value:"WINDOW_SHOPPING", label:"👀 Just Browsing"},
                {value:"UNKNOWN",         label:"❓ Not Sure"},
              ]} />
          </div>
        </div>
      </div>
      <BANTSuggestions
        leadId={lead.id}
        suggestions={bantSuggestions}
        currentBudget={lead.budgetMin}
        currentAuthority={lead.authorityLevel}
        currentNeed={lead.needSummary}
        currentTimeline={lead.whenCanInvest}
      />
    </div>
  );

  const qualificationCard = (
    <div data-lead-section="overview" className="card p-5">
      <div className="font-semibold mb-3 dark:text-slate-100">Qualification <span className="text-[10px] text-gray-400 dark:text-slate-500 font-normal">(click any value to edit)</span></div>
      {/* `min-w-0` on every grid cell so long values (LinkedIn URLs, long
          categorization labels) truncate within their column instead of
          overflowing into the neighbour. Lalit screenshot showed the
          LinkedIn URL bleeding into the Configuration column on mobile. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm [&>div]:min-w-0 [&>div]:overflow-hidden">
        {/* Row 1 (full width) — Profession + Company merged into ONE combined
            cell per Lalit's ask. Renders as 💼 {profession} @ {company} with
            two inline editors stacked. Replaces the previous standalone
            Company cell (which has been removed) and the standalone Profession
            cell. */}
        <div className="sm:col-span-2 p-2.5 rounded border border-[#e5e7eb] bg-gray-50 dark:bg-slate-700/50 dark:border-slate-600">
          <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">💼 Profession @ Company</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
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
              <InlineEdit leadId={lead.id} field="company" value={lead.company ?? ""} placeholder="@ company (e.g. Emirates NBD)" />
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">📱 Alt phone</div>
          <InlineEdit leadId={lead.id} field="altPhone" value={lead.altPhone ?? ""} placeholder="+91…" />
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">Potential</div>
          <InlineEdit leadId={lead.id} field="potential" type="select" value={lead.potential ?? ""}
            options={[{value:"HIGH",label:"🔥 Hot"},{value:"MEDIUM",label:"🌤 Warm"},{value:"LOW",label:"❄ Cold"},{value:"UNKNOWN",label:"— Unknown"}]} />
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">Mood</div>
          <InlineEdit leadId={lead.id} field="moodStatus" type="select" value={lead.moodStatus ?? ""}
            options={[{value:"EXCITED",label:"😀 Excited"},{value:"INTERESTED",label:"🙂 Interested"},{value:"NEUTRAL",label:"😐 Neutral"},{value:"HESITANT",label:"🤔 Hesitant"},{value:"COLD",label:"🧊 Cold"},{value:"CONFUSED",label:"😵 Confused"},{value:"ANGRY",label:"😠 Angry"}]} />
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">Categorization</div>
          <InlineEdit leadId={lead.id} field="categorization" type="select" value={lead.categorization ?? ""}
            options={[
              {value:"Highly Responsive",             label:"🟢 Highly Responsive"},
              {value:"Moderately Responsive",         label:"🟡 Moderately Responsive"},
              {value:"Irregular / Delayed Response",  label:"🟠 Irregular / Delayed"},
              {value:"Disappearing Act",              label:"🔴 Disappearing Act"},
              {value:"Non-Responsive",               label:"⚫ Non-Responsive"},
              // Legacy values — keep for backward compat
              {value:"🔥 Highly Responsive — picks calls regularly",label:"🔥 Highly Responsive (legacy)"},
              {value:"🙂 Responsive",label:"🙂 Responsive (legacy)"},
              {value:"🤔 Sometimes responsive",label:"🤔 Sometimes responsive (legacy)"},
              {value:"🧊 Cold / not picking",label:"🧊 Cold / not picking (legacy)"},
            ]} />
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">🔗 LinkedIn</div>
          {lead.linkedInUrl && (
            <a href={lead.linkedInUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0b1a33] underline block truncate">View profile ↗</a>
          )}
          <InlineEdit leadId={lead.id} field="linkedInUrl" value={lead.linkedInUrl ?? ""} placeholder="https://linkedin.com/in/…" />
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">Configuration</div>
          <InlineEdit leadId={lead.id} field="configuration" value={lead.configuration ?? ""} placeholder="2BR / Villa / PH" />
        </div>
        {/* Budget, fundReadiness, whenCanInvest moved into the BANT card —
            they're already shown there. */}
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">Stage</div>
          <InlineEdit leadId={lead.id} field="status" type="select" value={lead.status}
            options={[
              {value:"NEW",         label:"New"},
              {value:"CONTACTED",   label:"Contacted"},
              {value:"QUALIFIED",   label:"Qualified"},
              {value:"SITE_VISIT",  label:"Site Visit"},
              {value:"NEGOTIATION", label:"Negotiation"},
              {value:"EOI",         label:"EOI"},
              {value:"BOOKING_DONE",label:"Booking Done"},
              {value:"WON",         label:"Closed Won"},
              {value:"LOST",        label:"Closed Lost"},
            ]} />
        </div>
      </div>
    </div>
  );

  const timelineCard = (
    <div data-lead-section="timeline" className="card p-5">
      <div className="font-semibold mb-3">Timeline</div>
      <div className="space-y-3">
        {lead.activities.map((a) => {
          const v = activityVisual(a.type);
          return (
            <div key={a.id} className="flex gap-3 items-start">
              <div className={`w-8 h-8 rounded-full ${v.dot} text-white flex items-center justify-center text-sm flex-none shadow-sm`}>{v.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm dark:text-slate-200"><b>{a.title}</b> <span className="text-[10px] text-gray-400 dark:text-slate-500 ml-1">· {v.label}</span></div>
                <div className="text-xs text-gray-500 dark:text-slate-400">{a.user?.name ?? "System"} · {fmtIST12(a.createdAt)} IST</div>
                {a.description && <div className="text-sm mt-1 text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{a.description}</div>}
              </div>
            </div>
          );
        })}
        {lead.activities.length === 0 && <div className="text-sm text-gray-500 dark:text-slate-400">No activity yet.</div>}
      </div>
    </div>
  );

  return (
    /* pb-24 reserves space at the bottom on mobile only for the GLOBAL bottom
       nav (~56px + safe-area). The per-lead action bar is now in-flow inside
       the header card so no extra reservation needed for it. */
    <>
      {/* §9.4 — sticky mobile-only tab bar. Renders Overview / Timeline /
          Actions / Projects / Admin chips. Sets body[data-lead-tab] so
          globals.css can hide non-matching [data-lead-section] cards on
          phones. Desktop ignores this entirely. */}
      <LeadMobileTabs />
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-24 lg:pb-0">
      {/* Mobile back link removed — MobileShell now renders a global back
          button in the mobile header (chevron-left next to hamburger) so
          every non-root page has it, not just lead detail. */}
      <div className="lg:col-span-2 space-y-4">
        {/* INVESTOR BANNER — Agent V (Round 6). Surfaces "returning client"
            status above everything else. Hides itself when categorization
            !== "Investor" AND no matched leads exist (the component handles it). */}
        <InvestorBanner
          leadId={lead.id}
          categorization={lead.categorization}
          alreadyBought={lead.alreadyBought}
          matchedLeadIds={matchedLeadIds}
          bookingsCount={bookingsCount}
        />

        {/* NEEDS YOU BANNER */}
        {lead.needsManagerReview && (
          <div data-lead-section="overview" className="card p-4 border-l-4 border-amber-500 bg-amber-50">
            <div className="font-semibold text-amber-900">🚩 Needs manager attention</div>
            <div className="text-sm text-amber-800 mt-1">{lead.managerReviewReason ?? "Flagged for review"}{lead.flaggedAt && ` · since ${formatDistanceToNow(lead.flaggedAt, { addSuffix: true })}`}</div>
          </div>
        )}

        {/* DUPLICATE BANNER */}
        {(lead.duplicateCount ?? 0) > 0 && (
          <div data-lead-section="overview" className="card p-4 border-l-4 border-amber-500 bg-amber-50">
            <div className="font-semibold text-amber-900">🔁 This client has contacted us {lead.duplicateCount} extra {lead.duplicateCount === 1 ? "time" : "times"}</div>
            <div className="text-sm text-amber-800 mt-1">Last duplicate hit: {lead.lastDuplicateAt ? formatDistanceToNow(lead.lastDuplicateAt, { addSuffix: true }) : "—"}. Treat as high intent — they keep coming back.</div>
          </div>
        )}

        {/* SLA TIMER */}
        {slaActive && (
          <div data-lead-section="overview" className={`card p-4 border-l-4 ${slaMs > 5 * 60_000 ? "border-emerald-500 bg-emerald-50" : slaMs > 0 ? "border-amber-500 bg-amber-50" : "border-red-500 bg-red-50"}`}>
            <div className="text-sm font-semibold">
              {slaMs > 0
                ? `⏱  Call within ${Math.max(0, Math.floor(slaMs / 60_000))}m ${Math.max(0, Math.floor((slaMs % 60_000) / 1000))}s`
                : `🚨 Call SLA breached ${Math.floor(-slaMs / 60_000)}m ago`}
            </div>
            <div className="text-xs text-gray-600 dark:text-slate-300 mt-0.5">Logging a call clears this timer. Admin is auto-notified if you don't call.</div>
          </div>
        )}

        {/* FOLLOW-UP OVERDUE BANNER */}
        {followupOverdue && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3 text-sm">
            <span className="text-red-600 text-base">⚠️</span>
            <div>
              <span className="font-semibold text-red-700">Follow-up overdue</span>
              <span className="text-red-600 ml-2">
                — was due {lead.followupDate ? new Date(lead.followupDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : ""}
                . Log a call or reschedule.
              </span>
            </div>
          </div>
        )}

        {/* Header — special-case: visible on EVERY tab so the lead name +
            primary action bar (call / WhatsApp) is always reachable. We use
            multiple section values; the CSS hide rule uses ":not(...=)" with
            an exact match, so the trick is to give the header NO data
            attribute — that exempts it from the hide rules entirely. */}
        <div className="card p-5">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold">{lead.name}{lead.altName && <span className="text-base font-medium text-gray-600"> & {lead.altName}</span>}</h2>
                {lead.aiScore && <span className={`chip ${aiClass}`}>{lead.aiScore} · {lead.aiScoreValue}</span>}
                <span className="chip chip-warm">{lead.status.replaceAll("_"," ")}</span>
                {lead.currentStatus && <span className="chip src">{lead.currentStatus}</span>}
                {lead.originalSheetStatus && lead.originalSheetStatus !== lead.currentStatus && (
                  <span className="chip text-[10px] bg-gray-100 text-gray-500 border border-gray-300" title="Original sheet status">📋 {lead.originalSheetStatus}</span>
                )}
                {lead.categorization && (
                  <span className={`chip text-[10px] ${
                    lead.categorization.includes("Highly Responsive") ? "bg-emerald-100 text-emerald-800 border border-emerald-300" :
                    lead.categorization.includes("Moderately") ? "bg-yellow-100 text-yellow-800 border border-yellow-300" :
                    lead.categorization.includes("Irregular") ? "bg-orange-100 text-orange-800 border border-orange-300" :
                    lead.categorization.includes("Disappearing") ? "bg-red-100 text-red-800 border border-red-300" :
                    lead.categorization.includes("Non-Responsive") ? "bg-gray-100 text-gray-700 border border-gray-300" :
                    "src"
                  }`}>{lead.categorization}</span>
                )}
                {lead.moodStatus && <span className={`chip ${moodClass[lead.moodStatus] ?? "src"}`}>😊 {lead.moodStatus}</span>}
                <span className={`chip ${lead.forwardedTeam === "India" ? "src-csv" : "src-wa"}`}>{lead.forwardedTeam ?? "—"}</span>
              </div>
              {/* Header sub-line — email + company only. City/country now live
                  EXCLUSIVELY in the 📍 Address card on the right rail (Lalit's
                  ask: "2 places location gets display in lead detail. no use.")
                  and the trailing ", null" when country was missing is also
                  killed as a side effect ("What is null here?"). */}
              <div className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                {lead.email && `${lead.email}`}
                {lead.company && ` · ${lead.company}`}
              </div>
              {/* Tags — comma-separated free-form labels (NRI, Investor, HNI,
                  …) editable inline. Chips are coloured by stable hash so the
                  same tag always looks the same on every lead. */}
              <div className="text-sm mt-2 flex items-start flex-wrap gap-2">
                <span className="text-xs text-gray-500 dark:text-slate-400 font-semibold pt-0.5">Tags:</span>
                <LeadTagsEditor leadId={lead.id} initialTags={lead.tags} />
              </div>
              {/* Journey progress bar — shows pipeline stage at a glance */}
              <div className="mt-2 mb-1">
                <LeadJourneyBar status={lead.status} />
              </div>
              {/* Phone/WA action buttons + "best time to call" hint.
                  Wrapped in a flex-wrap container so the chip flows beside
                  the buttons on desktop and onto its own line on mobile —
                  doesn't disturb LeadActionsClient's own internal layout. */}
              <div className="flex items-center flex-wrap gap-2">
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
                  hideReassign={true}
                />
                <BestCallTimeChip leadId={lead.id} />
              </div>
              {/* Voice note recorder — moved to header so agents see all 4
                  actions (Call / WhatsApp / Log Call / Voice Note) together
                  without scrolling. */}
              <div className="mt-3 w-full">
                <VoiceNoteRecorder leadId={lead.id} />
              </div>
              {/* Print button removed — Lalit asked to drop it from the lead
                  header (no business reason to print a single lead). Component
                  file deleted too; @media print rules in globals.css stay so
                  the browser default Print menu still works if anyone wants it. */}
              {/* Expo / Dubai-site-visit button MOVED to the very bottom of the
                  right column (was here in the header). Reassign dropdown also
                  moved — now rendered standalone on the right rail. */}
            </div>
          </div>
        </div>

        {/* ⭐ CUSTOMER INTELLIGENCE — pre-assignment match result. Agents must
            see this BEFORE calling so they know if it's a returning contact,
            previous investor, or someone who's been through our funnel before.
            Fetches /api/leads/[id]/intelligence on mount (client component). */}
        <div data-lead-section="overview">
          <CustomerIntelligenceCard
            leadId={lead.id}
            leadName={lead.name}
            currentRole={me.role}
          />
        </div>

        {/* ⭐ NEXT BEST ACTION — single most important card on the page.
            Pure rules-based recommendation derived from status, eoiStage,
            siteVisitDate, last call outcome, and lastTouchedAt. Renders first
            (immediately after the header) so agents see THE action to take
            before any other context. No AI — synchronous, server-friendly. */}
        <div data-lead-section="overview">
          <NextBestActionCard lead={lead} />
        </div>

        {/* REMARKS — full conversation history from import sheet.
            Moved to the top of the left column + ALWAYS rendered (even when
            remarks is null/empty) so Lalit can't miss it. Compute the entry
            count + char count outside the JSX (the previous IIFE pattern was
            valid but obscured what was happening).
            The raw text uses runs of `,,,,` between call entries (MIS sheet
            convention); InlineEdit's textarea read-view splits those into
            paragraph breaks for readability. */}
        {/* AI Summary — TLDR of all conversations so the agent doesn't have
            to scroll the full Call History to remember what's going on. Lalit:
            "All important information and conversation should be in Summary."
            Always rendered (with placeholder when blank) so it can't be missed. */}
        {/* AI Client Summary card REMOVED — Lalit gave up on Gemini after the
            free tier returned NOT_FOUND for every model variant we tried
            (2.0-flash → limit:0, 1.5-flash → 404). The card was just empty
            visual noise without a working AI provider. Call History below is
            the structured source of truth instead. Code path stays in
            src/lib/ai.ts + the regenerate endpoint so it can be re-wired
            later (e.g. if billing is enabled or a different provider is
            added) — just not mounted on the page. */}

        {/* CONVERSATION STREAM — merged call + WhatsApp feed (Lalit's ask:
            one card that shows the full conversation flow in time order
            instead of two separate columns). Calls render green/red, WA
            renders blue/purple. Outcomes + recordings preserved per-row. */}
        <div data-lead-section="timeline">
          <ConversationStreamCard callLogs={lead.callLogs} waMessages={lead.waMessages} forwardedTeam={lead.forwardedTeam} />
        </div>

        {/* EOI / Booking workflow — REMOVED by Lalit in Round 3 ("Remove EOI for now").
            Both old EOIWorkflowCard + new Agent-K EOIPanel are off the page; bring
            either back when the EOI process is the next feature priority. */}

        {clientSummaryCard}

        {/* §6.5 / §9.4 — rules-based Buying Signals chip card.
            Pure synchronous computation over data already loaded above
            (discussed[], callLogs[], activities[], status, eoiStage, bantStatus,
            fundReadiness, followupDate, aiScore, lastTouchedAt, budgetMin).
            Card hides itself when nothing fires. No AI dependency. */}
        <div data-lead-section="overview">
          <BuyingSignalsCard lead={lead} />
        </div>

        {/* WHY THIS SCORE — rule-based breakdown of the AI score. No AI: the
            score is already a deterministic rule computation (see
            src/lib/leadRescorer.ts). explainScore() mirrors the same arithmetic
            step-by-step and the card narrates each factor. */}
        <div data-lead-section="overview">
          <LeadScoreBreakdown
            score={scoreExplanation.score}
            bucket={scoreExplanation.bucket}
            factors={scoreExplanation.factors}
            topFactors={topFactors}
            aiActive={aiScoringOn}
            storedScore={lead.aiScoreValue}
            storedBucket={lead.aiScore}
          />
        </div>

        {/* 📝 Notes — free-form per-lead notes (distinct from Timeline activity
            events and Call-History call rows). Authors can delete their own;
            ADMIN can delete any. No pin support — Note model has no `pinned`
            column. Newest-first (matches the orderBy on the page fetch). */}
        <div data-lead-section="overview">
          <LeadNotesCard
            leadId={lead.id}
            currentUserId={me.id}
            currentUserRole={me.role}
            initialNotes={lead.notes.map((n) => ({
              id: n.id,
              content: n.body,
              createdAt: n.createdAt.toISOString(),
              user: n.user ? { id: n.user.id, name: n.user.name, avatarColor: n.user.avatarColor } : null,
            }))}
          />
        </div>

        {/* AI Summary MOVED to the top of the left column (right after Call
            History). Lalit's ask: "all call records have not to be seen by
            agent all time. All important information and conversation should
            be in Summary." */}
        {/* MOBILE-ONLY: BANT + Qualification surface near the top of the page
            on phones (Lalit: "Qualification moving up wards in mobile"). On
            desktop they live in the right column (rendered there with the
            opposite hidden lg:block wrapper). */}
        <div className="lg:hidden space-y-4">
          {bantCard}
          {qualificationCard}
        </div>

        {/* DESKTOP-ONLY Timeline — on mobile, Timeline moves to the very
            bottom of the page (Lalit: "move timeline at below"). The mobile
            instance is rendered after the right column closes. */}
        <div data-lead-section="timeline" className="hidden lg:block">
          {timelineCard}
        </div>

        {/* REMARKS card REMOVED per Lalit: "Is Remarks and Call history all
            details same?" — yes, Call History already shows the parsed,
            structured per-call rows from this same data. The raw text dump was
            duplicative + harder to scan. The Lead.remarks field still stores
            the original import data (used by Smart CMA + AI summary); the agent
            just doesn't see two cards saying the same thing. */}
      </div>

      {/* Right rail
          Order per Lalit's layout request:
            1. Address
            2. Meeting counts (LeadMeetingClient)
            3. Start a Site Visit (SiteVisitTracker) — "below meeting counts, at last"
            4. Scheduling & next action — moved from left column
            5. Projects discussed
            ... rest unchanged
      */}
      <div className="space-y-4">
        {/* ── Routing info panel (small, read-only) ──
            Shows the team classification provenance so managers/admins can
            audit how this lead ended up on the current team. Visible to all
            roles (agents can see their own lead's team). Not editable here —
            use the admin queue / intake form to reassign team. */}
        <div data-lead-section="admin" className="card p-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-slate-500 font-semibold mb-2">Team Routing</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="text-gray-500 dark:text-slate-400 font-medium">Team</span>
            <span className={lead.forwardedTeam
              ? (lead.forwardedTeam === "India" ? "font-semibold text-emerald-700" : "font-semibold text-sky-700")
              : "text-amber-600 italic"
            }>
              {lead.forwardedTeam ?? "Awaiting team"}
            </span>
            {lead.routingMethod && (
              <>
                <span className="text-gray-500 dark:text-slate-400 font-medium">Method</span>
                <span className="text-gray-700 dark:text-slate-300">{lead.routingMethod.replace(/_/g, " ")}</span>
              </>
            )}
            {lead.routingSource && (
              <>
                <span className="text-gray-500 dark:text-slate-400 font-medium">Source</span>
                <span className="text-gray-700 dark:text-slate-300">{lead.routingSource}</span>
              </>
            )}
            {lead.routingReason && (
              <>
                <span className="text-gray-500 dark:text-slate-400 font-medium">Reason</span>
                <span className="text-gray-700 dark:text-slate-300">{lead.routingReason}</span>
              </>
            )}
            {!lead.routingMethod && !lead.routingSource && !lead.routingReason && (
              <span className="col-span-2 text-gray-400 dark:text-slate-500 italic text-[11px]">No routing metadata recorded</span>
            )}
          </div>
        </div>

        {/* 📌 Sticky note — pinned (position:sticky) at the top of the right
            rail. Private per agent (StickyNote model, unique on leadId+userId).
            Auto-saves on blur. Lalit's ask: "give every agent a private
            scratchpad on the lead that follows them as they scroll the page". */}
        <StickyNoteWidget
          leadId={lead.id}
          initialBody={stickyNote.body}
          initialUpdatedAt={stickyNote.updatedAt ? stickyNote.updatedAt.toISOString() : null}
        />

        {/* DESKTOP-ONLY BANT + Qualification (top of right column). The mobile
            copies live near the top of the LEFT column above. */}
        <div className="hidden lg:block space-y-4">
          {bantCard}
          {qualificationCard}
        </div>

        {/* 🛠 Lead admin — Reject + Reassign in ONE compact card, near the
            top of the right column. Lalit's ask: "Pur Reject lead option
            above. Right side corner is too clumsy" — moved up from the
            bottom so admins/managers can find them without scrolling. Reject
            is FIRST (the more decisive action), Reassign second. */}
        {(canReassign || lead.status !== "LOST") && (
          <div data-lead-section="admin" className="card p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold">🛠 Lead admin</div>
            {lead.status === "LOST" ? (
              <div className="text-xs text-gray-600 dark:text-slate-300">
                Already rejected{lead.rejectionReason ? ` — ${lead.rejectionReason.replace(/_/g, " ").toLowerCase()}` : ""}.
              </div>
            ) : (
              <RejectLeadModal leadId={lead.id} />
            )}
            {canReassign && (
              <LeadReassignClient
                leadId={lead.id}
                currentOwnerId={lead.ownerId}
                agents={agents.map(a => ({ id: a.id, name: a.name, role: a.role, team: a.team }))}
                leadTeam={lead.forwardedTeam}
              />
            )}
            {/* Copy Snapshot + Activity CSV affordances removed per Lalit's
                ask ("remove copy snapshot and CSV functionality"). The
                CopyLeadSnapshot component and /api/leads/[id]/activity-csv
                route were deleted along with this block. */}
          </div>
        )}

        {/* 📍 Address — the SINGLE place location appears on this page now.
            Combines lead.city / lead.country / lead.address.
            Duplicate-Delhi fix (Lalit's screenshot): when lead.address already
            CONTAINS the city, skip the city/country line — otherwise we render
            "Sector 42, Delhi" + "Delhi, India" stacked, which looks like a
            broken duplicate. If we have a usable address, render it alone and
            fall back to city/country only when address is empty. */}
        {(lead.address || lead.city || lead.country) && (
          <div data-lead-section="overview" className="card p-5">
            <div className="font-semibold mb-2">📍 Location</div>
            {lead.address ? (
              <p className="text-sm text-gray-700 dark:text-slate-300">{lead.address}</p>
            ) : (lead.city || lead.country) ? (
              <p className="text-sm text-gray-700 dark:text-slate-300">
                {[lead.city, lead.country].filter(Boolean).join(", ")}
              </p>
            ) : null}
          </div>
        )}

        {/* 🔗 Linked contacts — alt contact on file + other Leads sharing the
            last 8 digits of phone/altPhone (likely spouse / parent / sibling /
            same handset) + decision-maker hint when BANT QUALIFIES. Card hides
            itself if there's nothing to show. */}
        <div data-lead-section="overview">
          <LinkedContactsCard
            leadId={lead.id}
            leadName={lead.name}
            phone={lead.phone}
            altPhone={lead.altPhone}
            altName={lead.altName}
            bantStatus={lead.bantStatus}
          />
        </div>

        <div data-lead-section="overview" className="card p-5">
          <LeadMeetingClient leadId={lead.id} counts={meetingCounts} leadName={lead.name} />
        </div>

        {/* Site Visit Checklist — only renders when the lead is in SITE_VISIT
            stage OR there's a site visit booked in the future. Pure client-side
            with per-lead localStorage; no schema dependency. Lives directly
            above the Tracker so the prep flow reads top-to-bottom. */}
        {(lead.status === "SITE_VISIT" ||
          (lead.siteVisitDate && lead.siteVisitDate.getTime() > Date.now())) && (
          <div data-lead-section="actions">
            <SiteVisitChecklist leadId={lead.id} />
          </div>
        )}

        {/* Start a Site Visit — moved from header to right under meeting counts */}
        <div data-lead-section="actions">
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

        {/* EOI / Booking workflow MOVED to the LEFT / middle column —
            Lalit's ask: "EOI one should be in middle section — not in
            right corner". The card is wide (8-step stepper + many fields),
            so the wider left column gives it room to breathe. */}

        {/* Scheduling & next action — Followup + To-Do FIRST per Lalit's ask
            ("Followup and to do should be on top") since those are the daily
            agent actions. Meeting + Site Visit are second-row reference dates. */}
        <div data-lead-section="actions" className="card p-5">
          <div className="font-semibold mb-3 dark:text-slate-100">📅 Scheduling & next action <span className="text-[10px] text-gray-400 dark:text-slate-500 font-normal">(click to edit)</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="p-3 border border-emerald-200 rounded-lg bg-emerald-50">
              <div className="text-xs text-emerald-700 font-semibold">🔁 Follow-up</div>
              <InlineEdit leadId={lead.id} field="followupDate" type="date" value={toISTLocalInput(lead.followupDate)} placeholder="Not scheduled" />
            </div>
            {/* "✅ To Do" tile removed per Lalit's ask — the next-step UI lives
                in NextBestActionCard at the top of the left column. The
                todoNext Lead column is kept (used elsewhere). */}
            <div className="p-3 border border-[#e5e7eb] rounded-lg">
              <div className="text-xs text-gray-500 dark:text-slate-400">📅 Meeting</div>
              <InlineEdit leadId={lead.id} field="meetingDate" type="date" value={toISTLocalInput(lead.meetingDate)} placeholder="Not scheduled" />
            </div>
            <div className="p-3 border border-[#e5e7eb] rounded-lg">
              <div className="text-xs text-gray-500 dark:text-slate-400">🏢 Site Visit</div>
              <InlineEdit leadId={lead.id} field="siteVisitDate" type="date" value={toISTLocalInput(lead.siteVisitDate)} placeholder="Not scheduled" />
            </div>
          </div>
        </div>

        <div data-lead-section="projects" className="card p-5">
          <LeadProjectsClient
            leadId={lead.id}
            initial={lead.discussed.map(d => ({
              projectId: d.projectId,
              status: d.status,
              discussedAt: d.discussedAt.toISOString(),
              project: { name: d.project.name, city: d.project.city },
            }))}
            allProjects={allProjects}
            scopeCountry={(me.role === "ADMIN" || me.role === "MANAGER") ? null : teamToCountry(lead.forwardedTeam)}
          />
        </div>

        {/* Interested properties — MOVED to sit immediately under
            LeadProjectsClient (Lalit's ask: "this card belongs right under
            Projects discussed, not way down at the bottom"). Header carries a
            count chip so the agent sees "(N)" at a glance. */}
        <div data-lead-section="projects" className="card p-5">
          <div className="font-semibold mb-2 flex items-center gap-2 dark:text-slate-100">
            Interested properties
            <span className="chip src text-[10px]">({lead.interestedUnits.length})</span>
          </div>
          {lead.interestedUnits.length === 0 && <div className="text-sm text-gray-500 dark:text-slate-400">None attached yet.</div>}
          <div className="space-y-2 text-sm">
            {lead.interestedUnits.map((p) => (
              <div key={p.id} className="flex items-center justify-between border border-[#e5e7eb] dark:border-slate-600 rounded-lg p-2 dark:bg-slate-800">
                <div>
                  <div className="font-semibold dark:text-slate-100">{p.unit.project.name} {p.unit.configuration}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400">{p.unit.code} · {aedFmt(p.unit.priceBase, p.unit.project.country === "India" ? "INR" : "AED")}</div>
                </div>
                <span className={`chip ${p.type === "PRIMARY" ? "chip-hot" : p.type === "COMPARE" ? "chip-warm" : "chip-lost"}`}>{p.type}</span>
              </div>
            ))}
          </div>
        </div>


        {/* Assignment history — admin/manager only. Agents shouldn't see who else
            owned the lead before them (avoids inter-agent friction + cherry-picking). */}
        {(me.role === "ADMIN" || me.role === "MANAGER") && (
          <div data-lead-section="admin" className="card p-5">
            <div className="font-semibold mb-2 dark:text-slate-100">Assignment history</div>
            <div className="space-y-2 text-sm">
              {lead.assignments.length === 0 && <div className="text-gray-500 dark:text-slate-400">Not assigned yet.</div>}
              {lead.assignments.map(a => (
                <div key={a.id} className="text-xs dark:text-slate-200">
                  <b>{a.user.name}</b> · {a.reason ?? "—"}
                  <div className="text-gray-500 dark:text-slate-400">{fmtIST12(a.assignedAt)} IST</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Call history MOVED to the top of the left column (right under the header).
            Lalit asked for it up there so agents can read all past notes BEFORE
            dialling. The right rail now holds the secondary cards only. */}

        {/* BANT + Qualification cards MOVED to TOP of the right column per
            Lalit's ask: "Qualification card move above in right side". See the
            top of the right rail (just inside the opening div above). */}

        {/* Reassign + Reject moved UP into the "Lead admin" card at the top
            of this right column (just below Qualification). Was here at the
            bottom — too far to scroll. */}

        {/* Expo / Dubai-site-visit logger — Lalit's ask: "Move this button down"
            → put it at the absolute bottom of the right column. */}
        <div data-lead-section="actions" className="card p-4">
          <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-2">Log Expo / Site visit / Home visit</div>
          <AdvancedActivityLogger
            leadId={lead.id}
            team={(lead.forwardedTeam === "Dubai" || lead.forwardedTeam === "India") ? lead.forwardedTeam : null}
            travelRatePerKm={travelRatePerKmInr}
          />
        </div>

        <Link href="/leads" className="text-xs text-[#0b1a33] font-semibold inline-block">← Back to leads</Link>
      </div>

      {/* MOBILE-ONLY Timeline at the very bottom (Lalit: "move timeline at
          below"). Spans the full grid width so it's just one tall card under
          everything else. Desktop instance lives in the left column above. */}
      <div data-lead-section="timeline" className="lg:hidden lg:col-span-3">
        {timelineCard}
      </div>
    </div>
    </>
  );
}
