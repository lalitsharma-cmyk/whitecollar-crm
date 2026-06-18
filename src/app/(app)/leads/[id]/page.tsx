import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { fmtIST12, toISTLocalInput } from "@/lib/datetime";
import Link from "next/link";
import { fmtMoney } from "@/lib/money";
import { requireUser } from "@/lib/auth";
import LeadActionsClient from "@/components/LeadActionsClient";
import LeadProjectsClient from "@/components/LeadProjectsClient";
import LeadInterestNotesClient from "@/components/LeadInterestNotesClient";
import LeadMeetingClient from "@/components/LeadMeetingClient";
import LinkedInField from "@/components/LinkedInField";
import ContactField from "@/components/ContactField";
import DeletedLeadBanner from "@/components/DeletedLeadBanner";
import SiteVisitTracker from "@/components/SiteVisitTracker";
import SiteVisitChecklist from "@/components/SiteVisitChecklist";
// EOIWorkflowCard removed by Lalit (Round 3) — "Remove EOI for now".
// EOIPanel (Agent K's replacement) is built and available in src/components/EOIPanel.tsx
// for a future round when EOI is ready to surface again.
import AdvancedActivityLogger from "@/components/AdvancedActivityLogger";
import { getTravelRatePerKmInr } from "@/lib/settings";
import { runReconciler } from "@/lib/reconciler";
import InlineEdit from "@/components/InlineEdit";
import { acefoneEnabled } from "@/lib/acefone";
import { canTouchLead, leadScopeWhere } from "@/lib/leadScope";
import { parseRemarksTimeline, mergeSameMoment } from "@/lib/remarkParser";
import { projectWhereForUser, teamToCountry } from "@/lib/propertyScope";
import { inferCountryFromCityFuzzy } from "@/lib/cityCountry";
// CallHistoryCard removed — folded into ConversationStreamCard below.
import ConversationStreamCard from "@/components/ConversationStreamCard";
import StickyNoteWidget from "@/components/StickyNoteWidget";
import BuyingSignalsCard from "@/components/BuyingSignalsCard";
import VoiceNoteRecorder from "@/components/VoiceNoteRecorder";
import QuickNoteCard from "@/components/QuickNoteCard";
import LeadReassignClient from "@/components/LeadReassignClient";
import RejectLeadModal from "@/components/RejectLeadModal";
import LeadMobileTabs from "@/components/LeadMobileTabs";
// PrintButton removed — Lalit asked for the Print action to be dropped.
import BestCallTimeChip from "@/components/BestCallTimeChip";
import CallStatsBar from "@/components/CallStatsBar";
// LeadJourneyBar removed — stage pipeline bar replaced by currentStatus (Excel/MIS workflow)
import { displayBudget } from "@/lib/budgetParse";
import { selectableStatuses, statusColor, BOOKED_STATUSES, SUPPRESSED_STATUSES } from "@/lib/lead-statuses";
import LinkedContactsCard from "@/components/LinkedContactsCard";
import InvestorBanner from "@/components/InvestorBanner";
import StageDurationBadge from "@/components/StageDurationBadge";
import SchedulingField from "@/components/SchedulingField";
import AIComparisonWorkspace from "@/components/AIComparisonWorkspace";
import ChangeHistoryCard from "@/components/ChangeHistoryCard";
import ImportedFieldsCard from "@/components/ImportedFieldsCard";
import PreviousHistoryCard from "@/components/PreviousHistoryCard";
import { getCustomerHistory } from "@/lib/customerHistory";
import DuplicateIntentBanner from "@/components/DuplicateIntentBanner";
import { getDuplicateIntent } from "@/lib/duplicateIntent";
import { isAiPilotLead } from "@/lib/ai-openai";
import { getLatestClaudeAnalysis, claudeEnabled } from "@/lib/ai-claude";
import { getLatestGptIntelligence, gptIntelligenceEnabled } from "@/lib/ai-gpt-intelligence";
import { getLatestGeminiIntelligence, geminiIntelligenceEnabled } from "@/lib/ai-gemini-intelligence";

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

/** Format a phone number for WhatsApp wa.me links.
 *  Strips non-digits, then applies country-code rules:
 *  - 12 digits starting with 91  → Indian number, keep
 *  - 12 digits starting with 971 → UAE number, keep
 *  - 10 digits                   → assume India, prepend 91
 *  - anything else               → use digits as-is
 */
function formatPhoneForWA(p?: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 12 && (digits.startsWith("91") || digits.startsWith("971"))) {
    return digits;
  }
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/** Visually mask a phone: keep + country code + first 2 digits + last 4 */
function maskPhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (digits.length < 8) return p;
  const last4 = digits.slice(-4);
  const first = digits.slice(0, Math.max(2, digits.length - 8));
  return `+${first} ··· ${last4}`;
}

export default async function LeadDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  // Back target — return to the exact filtered list the caller came from (Leads,
  // Master Data, Revival, Archived…). Only accept safe internal paths (a single
  // leading slash) so ?back can never be used for an open-redirect.
  const backHref = sp.back && sp.back.startsWith("/") && !sp.back.startsWith("//") ? sp.back : "/leads";
  const me = await requireUser();
  // Run reconciler in the background — non-blocking
  runReconciler().catch(() => {});

  // ⚡ Parallelize all queries — was 3 sequential, now 1 round-trip via Promise.all.
  // 4th query: get-or-create the agent's sticky note for this lead. We do it
  // here so the widget can render synchronously without an extra round-trip.
  const [lead, meetingActs, allProjects, stickyNote, allActiveUsers] = await Promise.all([
    prisma.lead.findUnique({
      where: { id },
      include: {
        owner: true,
        interestedUnits: { include: { unit: { include: { project: true } } } },
        discussed:       { include: { project: true }, orderBy: { discussedAt: "desc" } },
        activities: { orderBy: { createdAt: "desc" }, take: 25, include: { user: true } },
        callLogs:   { orderBy: { startedAt: "desc" }, take: 50, include: { user: true } },
        waMessages: { orderBy: { receivedAt: "desc" }, take: 20 },
        notes:      { orderBy: { createdAt: "desc" }, take: 50, include: { user: true } },
        assignments:{ orderBy: { assignedAt: "desc" }, take: 5, include: { user: true } },
        importBatch: { select: { id: true, fileName: true, createdAt: true, importedBy: { select: { name: true } } } },
        fieldHistory: { orderBy: { changedAt: "desc" }, take: 60, include: { changedBy: { select: { name: true } } } },
      },
    }),
    prisma.activity.findMany({
      where: { leadId: id, type: { in: ["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT"] } },
      orderBy: { completedAt: "desc" },
      include: { user: { select: { name: true } } },
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
    // All active user names — passed to ConversationStreamCard for roster-based
    // agent attribution in imported remarks.
    prisma.user.findMany({ where: { active: true }, select: { name: true } }),
  ]);
  if (!lead) notFound();

  // §14 Module context rule: cold-call records must stay inside Revival Engine.
  // If someone navigates to /leads/:id for a cold-call lead, redirect them.
  if (lead.isColdCall) redirect(`/revival-engine/cold-data/${id}`);

  // Resolve owner names for any ownerId-change rows in the Change-History card.
  const ownerIdVals = [...new Set(lead.fieldHistory.filter((h) => h.field === "ownerId").flatMap((h) => [h.oldValue, h.newValue]).filter((v): v is string => !!v))];
  const ownerNameRows = ownerIdVals.length ? await prisma.user.findMany({ where: { id: { in: ownerIdVals } }, select: { id: true, name: true } }) : [];
  const ownerNames: Record<string, string> = Object.fromEntries(ownerNameRows.map((u) => [u.id, u.name]));

  // Confidentiality scope (AGENT → own leads, MANAGER → own team, ADMIN → all).
  // Passed into the history/intent/investor surfaces so an Agent/Manager never
  // sees another agent's/team's customer records. leadScopeWhere already bakes
  // in deletedAt:null, so recycle-bin rows stay excluded as before.
  const scope = await leadScopeWhere(me);

  // Previous History Found — same customer's earlier enquiries anywhere
  // (Leads / Revival / Master Data / Closed). null when there is no prior record.
  const customerHistory = await getCustomerHistory(lead.phone, lead.email, lead.id, scope).catch(() => null);
  const dupIntent = await getDuplicateIntent(lead.phone, lead.email, lead.id, scope).catch(() => null);

  // Auto-detection queries — run after notFound() guard.
  const [interestNotes, unmatchedMentions] = await Promise.all([
    prisma.leadInterestNote.findMany({ where: { leadId: id }, orderBy: { createdAt: "asc" } }),
    (me.role === "ADMIN" || me.role === "MANAGER")
      ? prisma.unmatchedMention.findMany({ where: { leadId: id, resolved: false, resolvedIgnored: false }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
  ]);

  // Agents can only see leads they own. Redirect (307) to /leads instead of
  // notFound() because Next.js app-router notFound() renders the 404 UI but
  // returns HTTP 200 — confusing for auditors. Redirect is cleaner UX too:
  // agent lands back on their own list rather than a dead end.
  if (!(await canTouchLead(me, lead))) redirect("/leads");

  // Soft-deleted leads live in the Super-Admin recycle bin. Anyone who is NOT the
  // Super Admin has no business viewing a deleted lead by direct URL → bounce them
  // back to the active list (it's already hidden from their lists/search). The
  // Super Admin still opens it, but with a clear "deleted" banner + Restore (below).
  if (lead.deletedAt && !me.isSuperAdmin) redirect("/leads");

  // Investor-history quick counts for the banner (Agent V, Round 6).
  // Match the new lead against the existing pipeline on phone / email /
  // name+city. If matches exist, the banner surfaces "returning client".
  // Computed on the fly — no schema change.
  const { findMatchingLeads } = await import("@/lib/investorMatch");
  const investorMatches = await findMatchingLeads({
    name: lead.name, phone: lead.phone, email: lead.email,
    city: lead.city, excludeLeadId: lead.id,
  });
  // CONFIDENTIALITY: findMatchingLeads returns RAW matches across ALL owners/teams.
  // Re-query through the viewer's scope (mirrors /api/leads/[id]/investor-history)
  // so the banner only reflects prior leads this viewer may access — an Agent never
  // sees another agent's bookings, a Manager never sees another team's. ADMIN scope
  // is {deletedAt:null} so admins still see everything. Counts are computed from the
  // SCOPED set only.
  const scopedInvestorMatches = investorMatches.length > 0
    ? await prisma.lead.findMany({
        where: { AND: [scope, { id: { in: investorMatches.map(m => m.id) } }] },
        select: { id: true, currentStatus: true, bookingDoneAt: true },
      })
    : [];
  const bookingsCount = scopedInvestorMatches.filter(m => m.bookingDoneAt != null || BOOKED_STATUSES.includes(m.currentStatus ?? "")).length;
  const matchedLeadIds = scopedInvestorMatches.map(m => m.id);

  // ── Meeting intelligence (spec: "counts auto-calculated from imported
  // remarks + CRM logged activities"). The card used to count ONLY structured
  // Activity rows, so imported leads — whose meetings live in the remarks text —
  // always showed 0. We now ALSO parse lead.remarks and detect Office / Virtual
  // / Site-Visit mentions via the shared remarkParser keyword rules, then merge
  // both sources into the counts and the history list.
  const remarkMeetingType: Record<string, "OFFICE_MEETING" | "VIRTUAL_MEETING" | "SITE_VISIT"> = {
    MEETING: "OFFICE_MEETING",
    VIRTUAL_MEETING: "VIRTUAL_MEETING",
    SITE_VISIT: "SITE_VISIT",
  };
  const detectedMeetings = (lead.remarks
    // Merge same-moment fragments FIRST (same as the Conversation card) so one
    // timestamped remark block that contains two visit phrases counts as ONE
    // meeting/visit, not two — keeps the count tiles in sync with Conversation History.
    ? mergeSameMoment(parseRemarksTimeline(lead.remarks, allActiveUsers.map(u => u.name), lead.createdAt))
    : []
  )
    .filter(e => e.eventType === "MEETING" || e.eventType === "VIRTUAL_MEETING" || e.eventType === "SITE_VISIT")
    .map((e, i) => ({
      id: `remark-${i}`,
      type: remarkMeetingType[e.eventType],
      completedAt: e.date ? e.date.toISOString() : null,
      startedAt: null as string | null,
      endedAt: null as string | null,
      description: e.text,
      isNoShow: false,
      loggedBy: e.agentName,
      source: "remark" as const,
    }));

  // Structured (CRM-logged) meeting activities, normalized to the same shape.
  const loggedMeetings = meetingActs.map(a => ({
    id: a.id,
    type: a.type as "OFFICE_MEETING" | "VIRTUAL_MEETING" | "SITE_VISIT",
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    startedAt: a.startedAt ? a.startedAt.toISOString() : null,
    endedAt: a.endedAt ? a.endedAt.toISOString() : null,
    description: a.description ?? null,
    isNoShow: a.isNoShow,
    loggedBy: a.user?.name ?? null,
    userId: a.userId ?? null,
    createdAt: a.createdAt ? a.createdAt.toISOString() : null,
    source: "logged" as const,
  }));

  // Merge both sources, newest first (null dates sink to the bottom).
  const allMeetings = [...loggedMeetings, ...detectedMeetings].sort((a, b) => {
    const ta = a.completedAt ? new Date(a.completedAt).getTime() : a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const tb = b.completedAt ? new Date(b.completedAt).getTime() : b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return tb - ta;
  });

  const meetingsOfType = (t: string) => allMeetings.filter(m => m.type === t);
  const lastAtOf = (t: string): string | null => {
    const dates = meetingsOfType(t)
      .map(m => m.completedAt ?? m.startedAt)
      .filter((d): d is string => !!d)
      .sort();
    return dates.length ? dates[dates.length - 1] : null;
  };
  const meetingCounts = {
    officeMeetings:  { count: meetingsOfType("OFFICE_MEETING").length,  lastAt: lastAtOf("OFFICE_MEETING") },
    virtualMeetings: { count: meetingsOfType("VIRTUAL_MEETING").length, lastAt: lastAtOf("VIRTUAL_MEETING") },
    siteVisits:      { count: meetingsOfType("SITE_VISIT").length,      lastAt: lastAtOf("SITE_VISIT") },
  };

  // Find an in-progress visit (started but not ended) attended by me — so the
  // tracker resumes if the agent navigates away and back.
  const activeVisit = meetingActs.find(
    (a) => a.attendedByUserId === me.id && a.startedAt && !a.endedAt && a.status !== "DONE"
  );

  const canReassign = me.role === "ADMIN" || me.role === "MANAGER";

  // Travel rate fetched once — used by the AdvancedActivityLogger which now
  // lives at the bottom of the RIGHT column (moved from header per Lalit's
  // ask: "Move this [Expo / Dubai site visit] button down.").
  const travelRatePerKmInr = await getTravelRatePerKmInr();

  const isPilotLead = isAiPilotLead(lead.ownerId);

  // AI Intelligence Workspace — Claude, GPT, Gemini (all parallel)
  const claudeEnabledFlag = claudeEnabled();
  const gptEnabledFlag = gptIntelligenceEnabled();
  const geminiEnabledFlag = geminiIntelligenceEnabled();
  const [latestClaudeAnalysis, latestGptAnalysis, latestGeminiAnalysis] = await Promise.all([
    (claudeEnabledFlag && isPilotLead) ? getLatestClaudeAnalysis(lead.id) : Promise.resolve(null),
    (gptEnabledFlag && isPilotLead) ? getLatestGptIntelligence(lead.id) : Promise.resolve(null),
    (geminiEnabledFlag && isPilotLead) ? getLatestGeminiIntelligence(lead.id) : Promise.resolve(null),
  ]);
  const toAnalysisState = (a: typeof latestClaudeAnalysis) => a ? {
    id: a.id,
    createdAt: a.createdAt.toISOString(),
    model: a.model,
    inputTokens: a.inputTokens,
    outputTokens: a.outputTokens,
    costMicroUsd: a.costMicroUsd,
    ok: a.ok,
    error: a.error,
    result: a.ok ? JSON.parse(a.resultJson) : null,
  } : null;
  const claudeInitialAnalysis = toAnalysisState(latestClaudeAnalysis);
  const gptInitialAnalysis = toAnalysisState(latestGptAnalysis);
  const geminiInitialAnalysis = toAnalysisState(latestGeminiAnalysis);

  // WhatsApp click-to-message link — only built when lead.phone is non-empty.
  const waPhone = formatPhoneForWA(lead.phone);
  const agentFirstName = me.name.split(" ")[0] ?? me.name;
  const waTeam = lead.forwardedTeam === "India" ? "India" : "Dubai";
  const waText = `Hi ${lead.name}, this is ${agentFirstName} from White Collar Realty. I wanted to follow up regarding your enquiry about properties in ${waTeam}. Is this a good time to talk?`;
  // Currency used to format budget cells — "12M AED" for Dubai, "1.2 Cr" for
  // India. Falls back to AED when the field is null (Dubai default).
  const budgetCcy: "AED" | "INR" = lead.budgetCurrency === "INR" ? "INR" : "AED";

  // Fetch active agents for the reassign dropdown — filtered by the lead's team
  // so the picker only shows agents on the same team (+ admins always included).
  const agents = canReassign
    ? lead.forwardedTeam
      ? await prisma.user.findMany({
          where: {
            active: true,
            OR: [
              { role: { in: ["AGENT", "MANAGER"] }, team: lead.forwardedTeam },
              { role: "ADMIN" },
            ],
          },
          orderBy: { name: "asc" },
        })
      : await prisma.user.findMany({
          where: { active: true, role: { in: ["AGENT", "MANAGER", "ADMIN"] } },
          orderBy: { name: "asc" },
        })
    : [];

  // Conversation-moderation overlays for this lead (Lalit-only feature). Cheap
  // indexed lookup; empty for the vast majority of leads.
  const remarkControls = lead.remarks
    ? await prisma.remarkVisibility.findMany({
        where: { leadId: lead.id },
        select: { remarkKey: true, deletedFromView: true, hiddenFromAll: true, hiddenFromUserIds: true, hiddenFromTeams: true },
      })
    : [];

  // Imported MIS remarks were stored as synthetic CallLog rows (attributedAgentName
  // set). They are Historical Notes, not real calls — exclude them from every call
  // count / stat on this page so only genuine dialled calls are reflected (and so
  // the first-call SLA still counts a remark-only lead as "not yet called").
  const realCallLogs = lead.callLogs.filter((c) => c.attributedAgentName == null);

  // SLA countdown — show timer if assigned recently and no call yet
  const callsCount = realCallLogs.length;
  const slaMs = lead.slaFirstCallBy ? lead.slaFirstCallBy.getTime() - Date.now() : null;
  const slaActive = lead.ownerId && callsCount === 0 && slaMs !== null && slaMs > -3600_000;

  // Follow-up overdue — true when followupDate is in the past and the lead is
  // still active (not LOST or WON). Computed server-side so there's no flash.
  const followupOverdue = lead.followupDate &&
    lead.followupDate < new Date() &&
    !SUPPRESSED_STATUSES.includes(lead.currentStatus ?? "");

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
  const bantAuthFilled = !!(lead.authorityPerson && lead.authorityPerson.trim() && lead.authorityPerson !== "Unknown")
    || (lead.authorityLevel != null && lead.authorityLevel !== "UNKNOWN");
  const bantAuthBad = lead.authorityPerson === "Unknown" || (!lead.authorityPerson && lead.authorityLevel === "UNKNOWN");
  // §1 — Need auto-fills from Configuration. When the agent has set a configuration
  // (e.g. "3BHK") but no explicit Need summary, surface the configuration as the
  // Need ("3 BHK") so the BANT Need chip is never blank when we already know what
  // the client wants. The chip editor pre-fills from this, so a save persists it.
  const configNeed = lead.configuration
    ? lead.configuration.replace(/^(\d+)\s*(BHK|BR|RK)$/i, "$1 $2")
    : "";
  const effectiveNeed = lead.needSummary && lead.needSummary.trim() ? lead.needSummary : configNeed;
  const bantNeedFilled = !!(effectiveNeed && effectiveNeed.trim());
  const bantTimeFilled = lead.whenCanInvest != null && lead.whenCanInvest !== "UNKNOWN";
  const bantTimeBad = lead.whenCanInvest === "UNKNOWN";

  // Per-letter BANT chip colour functions. Each letter gets its own colour when
  // filled so agents can tell Budget / Authority / Need / Timeline apart at a glance.
  // B = Budget → blue
  function bantBClass(good: boolean, bad: boolean): string {
    if (good) return "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20";
    if (bad) return "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20";
    return "border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800";
  }
  // A = Authority → purple
  function bantAClass(good: boolean, bad: boolean): string {
    if (good) return "border-purple-300 bg-purple-50 dark:border-purple-700 dark:bg-purple-900/20";
    if (bad) return "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20";
    return "border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800";
  }
  // N = Need → emerald/green
  function bantNClass(good: boolean): string {
    if (good) return "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20";
    return "border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800";
  }
  // T = Timeline → amber
  function bantTClass(good: boolean, bad: boolean): string {
    if (good) return "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20";
    if (bad) return "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20";
    return "border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800";
  }

  // Client Summary — auto-assembled from structured fields, all inline-editable.
  // Replaces the removed "WHO IS THE CLIENT" free-text card.
  const lastDiscussionDate = realCallLogs[0]?.startedAt ?? lead.lastTouchedAt ?? null;
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
            display={displayBudget(lead) === "—" ? undefined : displayBudget(lead)}
            parseAs="budget" placeholder="Not set"
            editHint={budgetCcy === "INR" ? "type 30L · 3Cr · 500K" : "type 2.5M · 500K"} />
        </div>
        {lastDiscussionLabel && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 w-32 shrink-0">Last Discussion</span>
            <span className="text-xs text-gray-600 dark:text-slate-300">{lastDiscussionLabel}</span>
          </div>
        )}
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
        <div className={`p-2.5 rounded border ${bantBClass(bantBudgetFilled, bantBudgetBad)}`}>
          <div className="text-[10px] font-bold tracking-widest text-gray-600 dark:text-slate-300">💰 B · BUDGET</div>
          <div className="text-sm mt-0.5">
            <InlineEdit
              leadId={lead.id}
              field="budgetMin"
              value={lead.budgetMin ?? ""}
              display={displayBudget(lead) === "—" ? undefined : displayBudget(lead)}
              parseAs="budget"
              editHint={budgetCcy === "INR" ? "type 30L · 3Cr · 500K" : "type 2.5M · 500K"}
              placeholder="Add value"
            />
          </div>
          <div className="text-[10px] text-gray-600 dark:text-slate-300 mt-1">Fund: <InlineEdit leadId={lead.id} field="fundReadiness" type="select" value={lead.fundReadiness ?? ""}
            options={[
              {value:"IMMEDIATE_BUYER",   label:"🟢 Immediate Buyer"},
              {value:"SHORT_TERM_BUYER",  label:"🟡 Short-Term Buyer"},
              {value:"CONDITIONAL_BUYER", label:"🔵 Conditional Buyer"},
              {value:"FINANCED_BUYER",    label:"🟣 Financed Buyer"},
              {value:"FUTURE_BUYER",      label:"🔴 Future Buyer"},
            ]} /></div>
        </div>
        {/* A — Authority. Who makes the final buying decision. */}
        <div className={`p-2.5 rounded border ${bantAClass(bantAuthFilled, bantAuthBad)}`}>
          <div className="text-[10px] font-bold tracking-widest text-gray-600 dark:text-slate-300">👤 A · AUTHORITY</div>
          <div className="text-sm mt-0.5">
            <InlineEdit leadId={lead.id} field="authorityPerson" type="select" value={lead.authorityPerson ?? ""}
              options={[
                {value:"Self",            label:"Self"},
                {value:"Wife",            label:"Wife"},
                {value:"Husband",         label:"Husband"},
                {value:"Father",          label:"Father"},
                {value:"Mother",          label:"Mother"},
                {value:"Brother",         label:"Brother"},
                {value:"Sister",          label:"Sister"},
                {value:"Parents",         label:"Parents"},
                {value:"Family",          label:"Family"},
                {value:"Business Partner",label:"Business Partner"},
                {value:"Friend",          label:"Friend"},
                {value:"Relative",        label:"Relative"},
                {value:"Company",         label:"Company"},
                {value:"Unknown",         label:"Unknown"},
              ]} />
          </div>
        </div>
        {/* N — Need. New free-text needSummary. */}
        <div className={`p-2.5 rounded border ${bantNClass(bantNeedFilled)}`}>
          <div className="text-[10px] font-bold tracking-widest text-gray-600 dark:text-slate-300">🎯 N · NEED</div>
          <div className="text-sm mt-0.5">
            {/* Auto-filled from Configuration when no explicit Need is set yet. */}
            <InlineEdit leadId={lead.id} field="needSummary" value={effectiveNeed} placeholder="Add value" />
          </div>
        </div>
        {/* T — Timeline. §14: India and Dubai use DIFFERENT timeline options. */}
        <div className={`p-2.5 rounded border ${bantTClass(bantTimeFilled, bantTimeBad)}`}>
          <div className="text-[10px] font-bold tracking-widest text-gray-600 dark:text-slate-300">⏱ T · TIMELINE</div>
          <div className="text-sm mt-0.5">
            <InlineEdit leadId={lead.id} field="whenCanInvest" type="select" value={lead.whenCanInvest ?? ""}
              options={lead.forwardedTeam === "India" ? [
                {value:"IMMEDIATE",       label:"⚡ Immediate / On Spot"},
                {value:"THIRTY_DAYS",     label:"📅 30 Days"},
                {value:"SITE_VISIT",      label:"🏠 Site Visit Planned"},
                {value:"MEETING",         label:"🤝 Meeting Scheduled"},
                {value:"THREE_MONTHS",    label:"📋 Evaluating Options (1–3 Months)"},
                {value:"SIX_PLUS_MONTHS", label:"⏳ 3–6 Months"},
                {value:"WINDOW_SHOPPING", label:"🪟 Window Shopping"},
                {value:"UNKNOWN",         label:"❓ Not Sure / Unknown"},
              ] : [
                {value:"IMMEDIATE",       label:"⚡ Immediate / On Spot"},
                {value:"THIRTY_DAYS",     label:"📅 30 Days"},
                {value:"THREE_MONTHS",    label:"✈ Will Visit Dubai First"},
                {value:"SIX_PLUS_MONTHS", label:"⏳ Not in 6 Months"},
                {value:"WINDOW_SHOPPING", label:"📆 6+ Months / Window Shopping"},
                {value:"UNKNOWN",         label:"❓ Not Sure / Unknown"},
              ]} />
          </div>
        </div>
      </div>
    </div>
  );

  const isAdminOrManager = me.role === "ADMIN" || me.role === "MANAGER";
  // Source (lead provenance) is editable by Admin / Super Admin ONLY (role
  // "ADMIN" covers super-admins via isSuperAdmin). Managers + agents see it
  // read-only. The server enforces the same rule in /api/leads/[id]/update.
  const canEditSource = me.role === "ADMIN";
  const sourceOptions = [
    { value: "WEBSITE", label: "Website" },
    { value: "WHATSAPP", label: "WhatsApp" },
    { value: "CSV_IMPORT", label: "CSV Import" },
    { value: "EVENT", label: "Event" },
    { value: "REFERRAL", label: "Referral" },
    { value: "INBOUND_CALL", label: "Inbound Call" },
    { value: "FACEBOOK_ADS", label: "Facebook Ads" },
    { value: "GOOGLE_ADS", label: "Google Ads" },
    { value: "PORTAL_99ACRES", label: "99acres" },
    { value: "PORTAL_MAGICBRICKS", label: "MagicBricks" },
    { value: "PORTAL_HOUSING", label: "Housing.com" },
    { value: "OTHER", label: "Other" },
  ];

  const qualificationCard = (
    <div data-lead-section="overview" className="card p-4">
      <div className="font-semibold mb-3 dark:text-slate-100">Client information <span className="text-[10px] text-gray-400 dark:text-slate-500 font-normal">(click any value to edit)</span></div>
      {/* `min-w-0` on every grid cell so long values (LinkedIn URLs, long
          categorization labels) truncate within their column instead of
          overflowing into the neighbour. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm [&>div]:min-w-0 [&>div]:overflow-hidden">
        {/* Phone — admin/manager edit + tel:/copy; agent sees the MASKED number
            only (PII), so no copy/dial of the real value. */}
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">📞 Phone</div>
          {isAdminOrManager ? (
            <ContactField leadId={lead.id} field="phone" kind="phone" value={lead.phone} editable />
          ) : (
            <ContactField leadId={lead.id} field="phone" kind="phone" value={lead.phone} readOnlyText={lead.phone ? (maskPhone(lead.phone) ?? "") : ""} />
          )}
        </div>
        {/* Alt phone — not PII-locked, everyone may edit + tel:/copy. */}
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">📱 Alt phone</div>
          <ContactField leadId={lead.id} field="altPhone" kind="phone" value={lead.altPhone} editable />
        </div>
        {/* Email — sits beside Phone/Alt phone per Lalit's layout. mailto: link +
            copy + ellipsis-with-tooltip so long addresses never break alignment.
            Admin/manager edit inline; agents get the link + copy, no edit (PII). */}
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">✉️ Email</div>
          <ContactField leadId={lead.id} field="email" kind="email" value={lead.email} editable={isAdminOrManager} />
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">🏢 Company</div>
          <InlineEdit leadId={lead.id} field="company" value={lead.company ?? ""} placeholder="Add value" />
        </div>
        {/* Source — VERBATIM lead provenance (sourceRaw), exactly as imported
            ("Townscript", "Eventbrite"). Free-text, never a fixed enum. Admin /
            Super Admin may edit; everyone else read-only. Falls back to a label
            from the legacy enum for old leads that predate sourceRaw. */}
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">📥 Source</div>
          {(() => {
            const shown = lead.sourceRaw ?? sourceOptions.find(o => o.value === lead.source)?.label ?? (lead.source ?? "");
            return canEditSource ? (
              <InlineEdit leadId={lead.id} field="sourceRaw" value={shown} placeholder="Set source" />
            ) : (
              <span className="text-gray-800 dark:text-slate-200">{shown || "—"}</span>
            );
          })()}
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">💼 Profession</div>
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
        {/* §7 Configuration — Dubai uses BR types, India uses BHK types. Never mix. */}
        <div>
          <div className="text-xs text-gray-500 dark:text-slate-400">🏠 Configuration</div>
          <InlineEdit leadId={lead.id} field="configuration" type="select" value={lead.configuration ?? ""}
            options={lead.forwardedTeam === "India"
              ? [
                  {value:"1BHK",label:"1 BHK"},
                  {value:"2BHK",label:"2 BHK"},
                  {value:"3BHK",label:"3 BHK"},
                  {value:"4BHK",label:"4 BHK"},
                  {value:"Villa",label:"Villa"},
                  {value:"Plot",label:"Plot"},
                  {value:"Commercial",label:"Commercial"},
                ]
              : [
                  {value:"Studio",label:"Studio"},
                  {value:"1BR",label:"1 BR"},
                  {value:"2BR",label:"2 BR"},
                  {value:"3BR",label:"3 BR"},
                  {value:"4BR",label:"4 BR"},
                  {value:"Penthouse",label:"Penthouse"},
                  {value:"Villa",label:"Villa"},
                  {value:"Commercial",label:"Commercial"},
                ]
            }
            placeholder="Add value" />
        </div>
        {/* LinkedIn — dedicated client field. Empty → "Add Value"; saved →
            clickable linkedin.com/in/… link + small pencil to edit. Nothing else. */}
        <div className="sm:col-span-2">
          <div className="text-xs text-gray-500 dark:text-slate-400">🔗 LinkedIn</div>
          <LinkedInField leadId={lead.id} value={lead.linkedInUrl} />
        </div>
      </div>
    </div>
  );

  // timelineCard removed — activities are now visible inside Conversation
  // History (notes merged in) per Lalit's ask: "Keep only conversation history
  // which should have all details everything".

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
      {lead.deletedAt && (
        <DeletedLeadBanner leadId={lead.id} deletedAtISO={lead.deletedAt.toISOString()} canRestore={me.isSuperAdmin} />
      )}
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

        {/* §15 FOLLOW-UP CARD — always visible when a follow-up is set */}
        {lead.followupDate && !followupOverdue && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 flex items-center gap-3 text-sm">
            <span className="text-emerald-600 text-base">📅</span>
            <div className="flex-1">
              <span className="font-semibold text-emerald-800 dark:text-emerald-200">Follow-up due: </span>
              <span className="text-emerald-700 dark:text-emerald-300">
                {new Date(lead.followupDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                {" "}·{" "}
                {new Date(lead.followupDate).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} IST
              </span>
            </div>
          </div>
        )}

        {/* FOLLOW-UP OVERDUE BANNER */}
        {followupOverdue && (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 px-4 py-3 flex items-center gap-3 text-sm">
            <span className="text-red-600 text-base">⚠️</span>
            <div>
              <span className="font-semibold text-red-700 dark:text-red-300">Follow-up overdue</span>
              <span className="text-red-600 dark:text-red-400 ml-2">
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
        <div className="card p-4">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {(me.role === "ADMIN" || me.role === "MANAGER") ? (
                  <h2 className="text-xl font-bold">
                    <InlineEdit leadId={lead.id} field="name" value={lead.name} placeholder="Lead name" />
                    {lead.altName && <span className="text-base font-medium text-gray-600"> & {lead.altName}</span>}
                  </h2>
                ) : (
                  <h2 className="text-xl font-bold">{lead.name}{lead.altName && <span className="text-base font-medium text-gray-600"> & {lead.altName}</span>}</h2>
                )}
                {/* Status — primary user-facing field (Excel/MIS values). Click to change. */}
                <span className={`${statusColor(lead.currentStatus)} text-xs px-2.5 py-0.5 rounded-full border font-semibold inline-flex items-center`}>
                  <InlineEdit
                    leadId={lead.id}
                    field="currentStatus"
                    type="select"
                    value={lead.currentStatus ?? ""}
                    options={selectableStatuses(lead.forwardedTeam, me.role, lead.currentStatus).map(s => ({ value: s, label: s }))}
                    placeholder="Set status"
                  />
                </span>
                <StageDurationBadge since={lead.updatedAt} />
                {lead.originalSheetStatus && lead.originalSheetStatus !== lead.currentStatus && (
                  <span className="chip text-[10px] bg-gray-100 text-gray-500 border border-gray-300" title="Original imported status">📋 {lead.originalSheetStatus}</span>
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
                {/* §16: Header location = WHERE the client is looking to buy (the
                    project's city), NOT the client's own city. Priority: linked
                    project city → project area → interested-unit project city →
                    client city only as a last fallback. */}
                {(() => {
                  const proj = lead.discussed?.[0]?.project ?? lead.interestedUnits?.[0]?.unit?.project ?? null;
                  const loc = proj?.city ?? proj?.area ?? lead.city ?? null;
                  return loc ? (
                    <span title="Property / project location" className="chip bg-slate-100 text-slate-600 border border-slate-200 text-[10px]">📍 {loc}</span>
                  ) : null;
                })()}
              </div>
              {/* §16: Email removed from header — lives in Client Information on right sidebar */}
              {/* §8 Requirement Snapshot — compact one-liner below name/status, above actions */}
              {(lead.configuration || lead.budgetMin || lead.notesShort) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600 dark:text-slate-300">
                  {lead.configuration && (
                    <span className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 px-2 py-0.5 rounded font-medium">
                      {lead.configuration}
                    </span>
                  )}
                  {lead.budgetMin && (
                    <span className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 px-2 py-0.5 rounded font-medium">
                      {lead.budgetCurrency === "INR" ? "₹" : lead.budgetCurrency}{" "}
                      {lead.budgetCurrency === "INR"
                        ? (lead.budgetMin >= 10_000_000
                            ? `${(lead.budgetMin/10_000_000).toFixed(1).replace(/\.0$/,"")} Cr`
                            : `${(lead.budgetMin/100_000).toFixed(0)} L`)
                        : `${(lead.budgetMin/1_000_000).toFixed(1).replace(/\.0$/,"")} M`}
                      {lead.budgetMax && lead.budgetMax > lead.budgetMin ? ` – ${
                        lead.budgetCurrency === "INR"
                          ? (lead.budgetMax >= 10_000_000
                              ? `${(lead.budgetMax/10_000_000).toFixed(1).replace(/\.0$/,"")} Cr`
                              : `${(lead.budgetMax/100_000).toFixed(0)} L`)
                          : `${(lead.budgetMax/1_000_000).toFixed(1).replace(/\.0$/,"")} M`
                      }` : ""}
                    </span>
                  )}
                  {lead.notesShort && (
                    <span className="text-gray-500 dark:text-slate-400 truncate max-w-[200px]">{lead.notesShort}</span>
                  )}
                </div>
              )}
              {/* Phone/WA action buttons — full-width block so the buttons grid
                  and alt-phone row stack vertically rather than appearing as
                  horizontal flex siblings. BestCallTimeChip sits below. */}
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
              {/* Voice note recorder — moved to header so agents see all 4
                  actions (Call / WhatsApp / Log Call / Voice Note) together
                  without scrolling. */}
              <div className="mt-3 w-full">
                <VoiceNoteRecorder leadId={lead.id} />
              </div>
              {/* Reject lead — surfaced on the ALWAYS-VISIBLE header (in addition
                  to the Admin-tab card below) so admins/managers can reject from
                  the main view without switching tabs. Hidden once rejected. */}
              {canReassign && lead.rejectedAt == null && (
                <div className="mt-3 w-full">
                  <RejectLeadModal leadId={lead.id} />
                </div>
              )}
              {/* Expo / Dubai-site-visit button MOVED to the very bottom of the
                  right column (was here in the header). Reassign dropdown also
                  moved — now rendered standalone on the right rail. */}
            </div>
          </div>
        </div>

        {/* BANT — at top of left column (spec §8). qualificationCard (Client Info)
            moved to right sidebar only (spec §15: no duplicate client info). */}
        <div>
          {bantCard}
        </div>

        {/* CONVERSATION STREAM — primary source of truth (spec §10).
            Comes before Quick Note (voice-first: voice note > conversation > quick note). */}
        <div data-lead-section="timeline">
          <CallStatsBar callLogs={realCallLogs.map((c) => ({ duration: c.durationSec, outcome: c.outcome, startedAt: c.startedAt }))} />
          <ConversationStreamCard
            callLogs={realCallLogs}
            waMessages={lead.waMessages}
            notes={lead.notes}
            forwardedTeam={lead.forwardedTeam}
            rawRemarks={lead.rawRemarks ?? lead.remarks}
            leadCreatedAt={lead.createdAt}
            agentNames={allActiveUsers.map(u => u.name)}
            leadId={lead.id}
            canControl={me.canControlConversations === true}
            viewerId={me.id}
            viewerTeam={me.team}
            controls={remarkControls}
            agents={agents.map(a => ({ id: a.id, name: a.name }))}
            isAdmin={me.role === "ADMIN"}
            meId={me.id}
          />
        </div>

        {/* QUICK NOTE — secondary (spec §9: Quick Note is secondary, must not dominate).
            Moved AFTER conversation history so agents see history first. */}
        <div data-lead-section="timeline">
          <QuickNoteCard leadId={lead.id} isAdmin={me.role === "ADMIN"} />
        </div>

        {/* Timeline removed — all activity now lives in Conversation History above. */}

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
      <div className="space-y-3">
        {/* ── Routing info panel (small, read-only) ──
            Shows the team classification provenance so managers/admins can
            audit how this lead ended up on the current team. Hidden from
            agents (internal system metadata per spec). */}
        {/* 📌 Sticky note — pinned (position:sticky) at the top of the right
            rail. Private per agent (StickyNote model, unique on leadId+userId).
            Auto-saves on blur. Lalit's ask: "give every agent a private
            scratchpad on the lead that follows them as they scroll the page". */}
        <StickyNoteWidget
          leadId={lead.id}
          initialBody={stickyNote.body}
          initialUpdatedAt={stickyNote.updatedAt ? stickyNote.updatedAt.toISOString() : null}
        />

        {/* §15: Client Information — right sidebar only, visible all screen sizes.
            No duplicate in the left/center column. */}
        {qualificationCard}

        {/* 🛠 Lead admin — Reject + Reassign in ONE compact card, near the
            top of the right column. Lalit's ask: "Pur Reject lead option
            above. Right side corner is too clumsy" — moved up from the
            bottom so admins/managers can find them without scrolling. Reject
            is FIRST (the more decisive action), Reassign second. */}
        {canReassign && (
          <div data-lead-section="admin" className="card p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold">🛠 Lead admin</div>
            {lead.rejectedAt != null ? (
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

        {/* 📍 Location — fully editable inline (city, country, address) */}
        <div data-lead-section="overview" className="card p-4">
          <div className="font-semibold mb-3 dark:text-slate-100">📍 Location <span className="text-[10px] text-gray-400 font-normal">(click to edit)</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mb-0.5">City</div>
              <InlineEdit leadId={lead.id} field="city" value={lead.city ?? ""} placeholder="Add value" />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mb-0.5">Country</div>
              <InlineEdit leadId={lead.id} field="country" value={lead.country || inferCountryFromCityFuzzy(lead.city) || ""} placeholder="Add value" />
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs text-gray-500 dark:text-slate-400 mb-0.5">Address</div>
              <InlineEdit leadId={lead.id} field="address" value={lead.address ?? ""} placeholder="Add value" />
            </div>
          </div>
        </div>

        {/* Imported sheet columns that don't map to a known CRM field — verbatim */}
        <DuplicateIntentBanner intent={dupIntent} />
        {customerHistory && <PreviousHistoryCard history={customerHistory} currentId={lead.id} />}
        <ImportedFieldsCard customFields={lead.customFields} rawImport={lead.rawImport} />

        {/* §15: LinkedContactsCard removed — alt phone already in Client Information.
            No duplicate contact display anywhere else on the page. */}

        <div data-lead-section="overview" className="card p-4">
          <LeadMeetingClient
            leadId={lead.id}
            counts={meetingCounts}
            leadName={lead.name}
            viewerRole={me.role}
            viewerId={me.id}
            activities={allMeetings}
          />
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
        <div data-lead-section="actions" className="card p-4">
          <div className="font-semibold mb-3 dark:text-slate-100">📅 Scheduling & next action</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <SchedulingField
              leadId={lead.id}
              field="followupDate"
              title="Set Follow-up"
              label="🔁 Follow-up"
              value={toISTLocalInput(lead.followupDate)}
              placeholder="Not scheduled"
              variant="primary"
            />
            <SchedulingField
              leadId={lead.id}
              field="meetingDate"
              title="Set Meeting"
              label="📅 Meeting"
              value={toISTLocalInput(lead.meetingDate)}
              placeholder="Not scheduled"
            />
            <SchedulingField
              leadId={lead.id}
              field="siteVisitDate"
              title="Set Site Visit"
              label="🏢 Site Visit"
              value={toISTLocalInput(lead.siteVisitDate)}
              placeholder="Not scheduled"
            />
          </div>
        </div>

        <div data-lead-section="projects" className="card p-4">
          <LeadProjectsClient
            leadId={lead.id}
            initial={lead.discussed.map(d => ({
              projectId: d.projectId,
              status: d.status,
              discussedAt: d.discussedAt.toISOString(),
              project: { name: d.project.name, city: d.project.city },
              autoDetected: d.autoDetected,
              suggestion: d.suggestion,
              sourceType: d.sourceType,
              sourceDate: d.sourceDate?.toISOString() ?? null,
              sourceText: d.sourceText,
            }))}
            allProjects={allProjects}
            // Admin/Manager bypass the picker's country filter (mirrors
            // cma/route.ts + projectWhereForUser) so they can search & add ANY
            // project on ANY lead — e.g. find "Sobha" (UAE) on an India lead.
            // Agents stay geo-scoped. Was unconditional → regressed once leads
            // started getting a forwardedTeam (turned the filter on).
            scopeCountry={(me.role === "ADMIN" || me.role === "MANAGER") ? null : teamToCountry(lead.forwardedTeam)}
            unmatchedMentions={unmatchedMentions.map(m => ({
              id: m.id,
              mentionText: m.mentionText,
              sourceType: m.sourceType,
              sourceDate: m.sourceDate?.toISOString() ?? null,
              sourceText: m.sourceText ?? null,
              resolved: m.resolved,
              resolvedIgnored: m.resolvedIgnored,
            }))}
            userRole={me.role}
          />
        </div>

        <div data-lead-section="projects" className="card p-4">
          <LeadInterestNotesClient
            leadId={lead.id}
            notes={interestNotes.map(n => ({
              id: n.id,
              noteText: n.noteText,
              autoDetected: n.autoDetected,
              sourceType: n.sourceType ?? null,
              sourceDate: n.sourceDate?.toISOString() ?? null,
              createdAt: n.createdAt.toISOString(),
            }))}
            interestedUnits={lead.interestedUnits.map(p => ({
              id: p.id,
              type: p.type,
              unit: {
                id: p.unit.id,
                code: p.unit.code,
                configuration: p.unit.configuration,
                priceBase: p.unit.priceBase,
                project: { name: p.unit.project.name, country: p.unit.project.country },
              },
            }))}
            userRole={me.role}
          />
        </div>

        {/* Assignment history — admin/manager only. Agents shouldn't see who else
            owned the lead before them (avoids inter-agent friction + cherry-picking). */}
        {(me.role === "ADMIN" || me.role === "MANAGER") && (
          <div data-lead-section="admin" className="card p-4">
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

        {/* Field-level change history + import source — admin/manager audit view */}
        {(me.role === "ADMIN" || me.role === "MANAGER") && (
          <ChangeHistoryCard rows={lead.fieldHistory} importBatch={lead.importBatch} ownerNames={ownerNames} />
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

        <Link href={backHref} className="text-xs text-[#0b1a33] font-semibold inline-block">← Back</Link>
      </div>

      {/* Mobile Timeline removed — merged into Conversation History above. */}
    </div>

    {/* AI Model Evaluation Workspace — full-width, below the main CRM grid.
        Visible on the "ai" mobile tab; always visible on desktop. */}
    {isPilotLead && (
      <div data-lead-section="ai" className="mt-4 pb-24 lg:pb-0">
        <AIComparisonWorkspace
          leadId={lead.id}
          claudeEnabled={claudeEnabledFlag}
          gptEnabled={gptEnabledFlag}
          geminiEnabled={geminiEnabledFlag}
          initialClaude={claudeInitialAnalysis}
          initialGpt={gptInitialAnalysis}
          initialGemini={geminiInitialAnalysis}
        />
      </div>
    )}
    </>
  );
}
