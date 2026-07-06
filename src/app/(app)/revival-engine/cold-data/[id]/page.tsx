// §12/§13/§14 — Cold Data detail page.
// Lives at /revival-engine/cold-data/:id — SEPARATE from /leads/:id.
// Shows "COLD DATA RECORD" badge so there is no confusion.
// Available actions: Call, WhatsApp, Log Call, Add Note, Mark Interested, Convert to Lead.
// Convert to Lead: carries all history (calls, WA, notes, activities) — just flips isColdCall=false.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { leadScopeWhere, COLD_ORIGINS } from "@/lib/leadScope";
import { getReturningClientCardEnabled } from "@/lib/settings";
import { getReturningClientView } from "@/lib/customer/returningClient";
import ReturningClientCard from "@/components/ReturningClientCard";
import DetailShell from "@/components/DetailShell";
import { formatLeadName } from "@/lib/leadName";
import { formatDistanceToNow, format } from "date-fns";
import ConversationStreamCard from "@/components/ConversationStreamCard";
import QuickNoteCard from "@/components/QuickNoteCard";
import StickyNoteWidget from "@/components/StickyNoteWidget";
import DuplicateIntentBanner from "@/components/DuplicateIntentBanner";
import { getDuplicateIntent } from "@/lib/duplicateIntent";
import PreviousHistoryCard from "@/components/PreviousHistoryCard";
import { getCustomerHistory } from "@/lib/customerHistory";
import { displayBudget } from "@/lib/budgetParse";
import LeadActionsClient from "@/components/LeadActionsClient";
import { acefoneEnabled } from "@/lib/acefone";
import { statusColor, selectableStatuses } from "@/lib/lead-statuses";
import InlineEdit from "@/components/InlineEdit";
import ColdDataPromoteButton from "@/components/ColdDataPromoteButton";
import RejectLeadModal from "@/components/RejectLeadModal";
import ImportedFieldsCard from "@/components/ImportedFieldsCard";
import ColdClientInfoCard from "@/components/ColdClientInfoCard";
import ChangeHistoryCard from "@/components/ChangeHistoryCard";
// ── Full Normal-Lead parity surfaces (Revival Engine) — the SAME shared
// components the Lead detail (leads/[id]) renders. Revival rows ARE Leads
// (Lead table, leadOrigin COLD/REVIVAL), so every /api/leads/[id]/* route these
// call applies unchanged — no forks, no new routes, no schema. The prior page
// hid these ("unlock on Convert"); that gating is now superseded for Revival.
import LeadFollowupActions from "@/components/LeadFollowupActions";
import LeadReassignClient from "@/components/LeadReassignClient";
import SchedulingField from "@/components/SchedulingField";
import LeadMeetingClient from "@/components/LeadMeetingClient";
import SiteVisitTracker from "@/components/SiteVisitTracker";
import AdvancedActivityLogger from "@/components/AdvancedActivityLogger";
import VoiceNoteRecorder from "@/components/VoiceNoteRecorder";
import LeadResourceShare from "@/components/LeadResourceShare";
import LeadProjectsClient from "@/components/LeadProjectsClient";
import LeadInterestedClient from "@/components/LeadInterestedClient";
import { toISTLocalInput } from "@/lib/datetime";
import { hasContactActivityToday } from "@/lib/followupGate";
import { parseRemarksTimeline, mergeSameMoment } from "@/lib/remarkParser";
import { projectWhereForUser, teamToCountry } from "@/lib/propertyScope";
import { getTravelRatePerKmInr } from "@/lib/settings";
// Mask a cold-data phone to its last 4 digits (PII protection on the data-bank).
// reveal=true → return the full number: admins / super-admins / Lalit need the real
// contact to work the pipeline; agents & managers still see the masked (last-4) form.
function maskPhone(p?: string | null, reveal = false): string | null {
  if (!p) return null;
  if (reveal) return p;
  const d = p.replace(/\D/g, "");
  return d.length >= 4 ? `···${d.slice(-4)}` : p;
}

export const dynamic = "force-dynamic";

export default async function ColdDataDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  // Back target — return to the exact Revival list/filter the caller came from.
  // Internal paths only (single leading slash); default to the cold-call list.
  const backHref = sp.back && sp.back.startsWith("/") && !sp.back.startsWith("//") ? sp.back : "/cold-calls";
  const me = await requireUser();
  const scope = await leadScopeWhere(me);
  // Admin / super-admin / Lalit see the FULL phone on cold data (no PII mask); every
  // super-admin + Lalit is role ADMIN, so this one check covers all three. Agents &
  // managers still see the masked (last-4) form.
  const canSeeContact = me.role === "ADMIN" || me.isSuperAdmin === true;

  const lead = await prisma.lead.findFirst({
    where: { id, OR: [{ isColdCall: true }, { leadOrigin: { in: COLD_ORIGINS } }], ...scope },
    include: {
      owner: { select: { id: true, name: true, avatarColor: true } },
      callLogs: { orderBy: { startedAt: "desc" }, take: 50, include: { user: { select: { name: true } } } },
      waMessages: { orderBy: { receivedAt: "desc" }, take: 30, include: { actor: { select: { name: true } } } },
      notes: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      activities: { orderBy: { createdAt: "desc" }, take: 20, include: { user: { select: { name: true } } } },
      fieldHistory: { orderBy: { changedAt: "desc" }, take: 60, include: { changedBy: { select: { name: true } } } },
      // Full-parity relations (mirror leads/[id]) — drive Properties Discussed,
      // Interested Properties, and the meeting/site-visit surfaces below.
      discussed:          { include: { project: true }, orderBy: { discussedAt: "desc" } },
      interestedProjects: { include: { project: true }, orderBy: { interestedAt: "desc" } },
      interestedUnits:    { include: { unit: { include: { project: true } } } },
    },
  });

  if (!lead) {
    // If the lead exists but is no longer cold, redirect to leads
    const promoted = await prisma.lead.findFirst({ where: { id, ...scope } });
    if (promoted) redirect(`/leads/${id}`);
    notFound();
  }

  // Unified Lead Detail (Phase E / WS-J J5) — cross-module Returning Client card,
  // now on Cold/Revival too (zero feature drift, governance #3: the same client's
  // data is visible everywhere). Flag-gated (default OFF → no-op); read-only +
  // scope-safe (agents only ever see their own sibling enquiries).
  const returningClient = (await getReturningClientCardEnabled())
    ? await getReturningClientView(me, lead)
    : null;

  // Sticky note — private per-agent. Upsert anchors updatedAt on first view. This
  // also mounts the listener for the "Note" action button (open-sticky-<leadId>),
  // which otherwise had no listener on cold data → the Note button did nothing.
  const stickyNote = await prisma.stickyNote.upsert({
    where: { leadId_userId: { leadId: id, userId: me.id } },
    create: { leadId: id, userId: me.id, body: "" },
    update: {},
  });

  // Duplicate-intent — same detection the Lead detail uses (excludes soft-deleted,
  // scope-confidential). Server-computed, so an inline edit's router.refresh()
  // re-runs it → the banner auto-re-checks after every save.
  const dupIntent = await getDuplicateIntent(lead.phone, lead.email, lead.id, scope).catch(() => null);

  // Previous History Found — the SAME unified prior-enquiry block the Leads detail
  // renders (governance #3: a linked client's data is visible from EVERY module).
  // Aggregates by mobile/email AND by canonical Customer (lead.customerId), so an
  // admin "Link as One Customer" surfaces the full cross-module history here too —
  // not only on /leads. Scope-confidential + excludes recycle-bin (scope bakes in
  // deletedAt:null); null when there is no prior record.
  const customerHistory = await getCustomerHistory(lead.phone, lead.email, lead.id, scope, lead.customerId).catch(() => null);

  const agents = await prisma.user.findMany({
    where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER", "ADMIN"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true, team: true, avatarColor: true },
  });

  const canReassign = me.role === "ADMIN" || me.role === "MANAGER";
  const lastTouched = lead.lastTouchedAt
    ? formatDistanceToNow(lead.lastTouchedAt, { addSuffix: true })
    : "never touched";

  // ════════════════════════════════════════════════════════════════════════
  // Full Normal-Lead parity — server-side data the shared workflow surfaces
  // need. These MIRROR leads/[id] exactly (same queries, same reducers). All
  // reads are scope-safe or lead-scoped; nothing new is written here.
  // ════════════════════════════════════════════════════════════════════════

  // Project master (scoped to the viewer's markets) — feeds the Properties
  // Discussed / Interested pickers. Same query as leads/[id].
  const allProjects = await prisma.project.findMany({
    where: projectWhereForUser(me),
    select: { id: true, name: true, city: true, country: true },
    orderBy: { name: "asc" },
  });

  // Active-user roster — agent-attribution for imported remarks (meeting parse).
  const allActiveUsers = await prisma.user.findMany({ where: { active: true }, select: { name: true } });

  // Structured meeting activities (Office / Virtual / Site Visit) — same query
  // + normalization + remark-detection merge as leads/[id], so the meeting
  // count tiles + history match the Lead detail exactly.
  const meetingActs = await prisma.activity.findMany({
    where: { leadId: id, type: { in: ["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT"] } },
    orderBy: { completedAt: "desc" },
    include: { user: { select: { name: true } } },
  });

  // Auto-detection reads — projects/interest notes + admin-only unmatched mentions.
  const [interestNotes, unmatchedMentions] = await Promise.all([
    prisma.leadInterestNote.findMany({ where: { leadId: id }, orderBy: { createdAt: "asc" } }),
    (me.role === "ADMIN" || me.role === "MANAGER")
      ? prisma.unmatchedMention.findMany({ where: { leadId: id, resolved: false, resolvedIgnored: false }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
  ]);

  // Completion gate — does this record have a valid contact attempt (call / WA /
  // email) logged today (IST)? Drives the Complete button in LeadFollowupActions.
  const leadHasContactToday = await hasContactActivityToday(lead.id);

  // Travel rate — used by AdvancedActivityLogger (Expo / site-visit km reimbursement).
  const travelRatePerKmInr = await getTravelRatePerKmInr();

  // Imported MIS remarks were stored as synthetic CallLog rows (attributedAgentName
  // set, NO ivrProvider) — Historical Notes, not real calls. Keep any row that is a
  // live telephony call (ivrProvider set) OR a UI-logged call (attributedAgentName
  // null); drop the synthetic import rows. Mirrors leads/[id].
  const realCallLogs = lead.callLogs.filter((c) => c.ivrProvider != null || c.attributedAgentName == null);

  // ── Meeting intelligence — parse imported remarks for Office/Virtual/Site-Visit
  // mentions AND merge with structured Activity rows (mirrors leads/[id]).
  const remarkMeetingType: Record<string, "OFFICE_MEETING" | "VIRTUAL_MEETING" | "SITE_VISIT"> = {
    MEETING: "OFFICE_MEETING",
    VIRTUAL_MEETING: "VIRTUAL_MEETING",
    SITE_VISIT: "SITE_VISIT",
  };
  const detectedMeetings = (lead.remarks
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

  // In-progress visit (started, not ended) attended by me — so the tracker resumes.
  const activeVisit = meetingActs.find(
    (a) => a.attendedByUserId === me.id && a.startedAt && !a.endedAt && a.status !== "DONE"
  );

  return (
    <>
      {/* Sticky note (floating) — listens for the "Note" action button's
          open-sticky-<leadId> event so Note works on cold data too. */}
      <StickyNoteWidget
        leadId={lead.id}
        initialBody={stickyNote.body}
        initialUpdatedAt={stickyNote.updatedAt ? stickyNote.updatedAt.toISOString() : null}
      />

      {/* Shared DetailShell (Phase C) — centered single-column data-bank layout,
          preserving the Cold view's max-w-4xl centering via singleColClassName. */}
      <DetailShell
        module="cold"
        singleColClassName="max-w-4xl mx-auto pb-16"
        header={null}
        mainColumn={<>

      {/* ── COLD DATA RECORD badge — visible at all times ── */}
      <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center gap-3">
        <span className="text-2xl">❄️</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-amber-900 dark:text-amber-200 text-sm tracking-wide uppercase">
            Cold Data Record
          </div>
          <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            This is a cold prospect — <strong>not yet a lead</strong>. Use &quot;Convert to Lead&quot; once qualified. Last touched: {lastTouched}.
          </div>
        </div>
        <Link href={backHref}
          className="text-xs text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 font-medium shrink-0 flex items-center gap-1">
          ← Back
        </Link>
      </div>

      {/* ── Duplicate-intent banner — reused from the Lead view; re-checks on every
          inline edit (router.refresh re-runs getDuplicateIntent). ── */}
      <DuplicateIntentBanner intent={dupIntent} />

      {/* ── Previous History Found — SAME card the Leads detail renders, so a client
          found in both Revival and Leads (and linked via "Link as One Customer")
          shows the identical unified prior-enquiry history from THIS Revival view.
          Reuses the shared component (no forked Revival timeline). ── */}
      {customerHistory && <PreviousHistoryCard history={customerHistory} currentId={lead.id} />}

      {/* Unified Lead Detail (Phase E / J5) — cross-module Returning Client card:
          the same client's other enquiries across modules, shown on Cold too. */}
      {returningClient && <ReturningClientCard view={returningClient} />}

      {/* ── Main header card ── */}
      <div className="card p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0 flex-1">
            {/* Name + status */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{formatLeadName(lead.name)}</h2>
              {/* Status — inline-editable via the SHARED InlineEdit (same pattern as
                  leads/[id]). Revival rows ARE Leads, so the default /api/leads/[id]/update
                  route + change-history apply unchanged. Role+team-scoped options. */}
              <span className={`${statusColor(lead.currentStatus)} text-xs px-2.5 py-0.5 rounded-full border font-semibold inline-flex items-center`}>
                <InlineEdit leadId={lead.id} field="currentStatus" type="select" value={lead.currentStatus ?? ""}
                  options={selectableStatuses(lead.forwardedTeam, me.role, lead.currentStatus).map(s => ({ value: s, label: s }))}
                  placeholder="Set status" />
              </span>
              {lead.forwardedTeam && (
                <span className={`chip text-[10px] ${lead.forwardedTeam === "India" ? "src-csv" : "src-wa"}`}>
                  {lead.forwardedTeam}
                </span>
              )}
            </div>

            {/* Phone + email */}
            <div className="text-sm text-gray-500 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5 mb-3">
              {lead.phone && <span>📞 {maskPhone(lead.phone, canSeeContact)}</span>}
              {lead.altPhone && <span>📱 {maskPhone(lead.altPhone, canSeeContact)}</span>}
              {lead.email && <span>✉️ {lead.email}</span>}
              {lead.city && <span>📍 {lead.city}</span>}
            </div>

            {/* Requirement snapshot — Configuration + Budget chips only. */}
            {(lead.configuration || lead.budgetMin) && (
              <div className="flex flex-wrap gap-2 text-[11px] mb-3">
                {lead.configuration && (
                  <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded font-medium">
                    {lead.configuration}
                  </span>
                )}
                {displayBudget(lead) !== "—" && (
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-medium">
                    {displayBudget(lead)}
                  </span>
                )}
              </div>
            )}

            {/* Action buttons — Call / WhatsApp / Log Call / Note, plus the
                Complete / Snooze / Escalate follow-up bar injected inline as
                `extraActions` (SAME pattern + endpoints as leads/[id]). Revival
                rows ARE Leads, so apiBase stays the default "/api/leads" and the
                hasContactToday gate on Complete matches the Lead detail. */}
            <LeadActionsClient
              leadId={lead.id}
              phone={lead.phone}
              altPhone={lead.altPhone}
              email={lead.email}
              currentOwnerId={lead.ownerId}
              canReassign={canReassign}
              agents={agents.map(a => ({ id: a.id, name: a.name, role: a.role, team: a.team, avatarColor: a.avatarColor }))}
              phoneMasked={maskPhone(lead.phone, canSeeContact)}
              altPhoneMasked={maskPhone(lead.altPhone, canSeeContact)}
              leadName={lead.name}
              agentName={me.name}
              acefoneEnabled={acefoneEnabled()}
              acefoneMappedForUser={!!me.acefoneAgentId}
              hideReassign={true}
              extraActions={
                <LeadFollowupActions
                  leadId={lead.id}
                  leadName={lead.name}
                  followupDate={lead.followupDate ? lead.followupDate.toISOString() : null}
                  hasContactToday={leadHasContactToday}
                  compact
                />
              }
            />

            {/* Voice note recorder — records a voice note against this record
                (SAME shared component + /api/leads/[id]/notes route as leads/[id]). */}
            <div className="mt-3 w-full">
              <VoiceNoteRecorder leadId={lead.id} />
            </div>

            {/* Brochure / Resource share — pick from the Gallery and send via
                WhatsApp / Email; every share is tracked (same as leads/[id]). */}
            <div className="w-full">
              <LeadResourceShare
                leadId={lead.id}
                leadName={lead.name}
                phone={lead.phone}
                email={lead.email}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Client Information (inline-editable · Cold Data Bank) — data fields only,
          no Lead-only workflow. Edits save to the master record + log field history. ── */}
      <ColdClientInfoCard lead={lead} isAdmin={me.role === "ADMIN"} />

      {/* ════════════════════════════════════════════════════════════════════
          FULL NORMAL-LEAD WORKFLOW (Revival parity) — the SAME shared surfaces
          leads/[id] renders. Agents work the revival queue completely WITHOUT
          converting first. Every control below calls an existing /api/leads/[id]/*
          route (Revival rows ARE Leads) — no forks, no new routes, no schema.
          ════════════════════════════════════════════════════════════════════ */}

      {/* 📅 Scheduling & next action — Follow-up / Meeting / Site Visit dates
          (SchedulingField → /api/leads/[id]/update). Same three fields, same
          field names + placement as leads/[id]. Site Visit renders for all
          teams exactly as the Lead detail does (no Dubai-team hiding there). */}
      <div className="card p-4">
        <div className="font-semibold mb-3 dark:text-slate-100">📅 Scheduling &amp; next action</div>
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

      {/* Start a Visit — the live Site/Home/Expo/Meeting tracker (resumes an
          in-progress visit). Same component + activeVisit gate as leads/[id]. */}
      <SiteVisitTracker
        leadId={lead.id}
        leadName={lead.name}
        activeVisit={activeVisit && activeVisit.startedAt && (activeVisit.type === "OFFICE_MEETING" || activeVisit.type === "SITE_VISIT") ? {
          activityId: activeVisit.id,
          type: activeVisit.type,
          startedAt: activeVisit.startedAt.toISOString(),
        } : null}
      />

      {/* Meetings & Site Visits — office / site / virtual counts + full history
          (LeadMeetingClient → /api/leads/[id]/meeting). Same counts + activities
          (structured Activity rows merged with remark-detected meetings). */}
      <div className="card p-4">
        <LeadMeetingClient
          leadId={lead.id}
          counts={meetingCounts}
          leadName={lead.name}
          viewerRole={me.role}
          viewerId={me.id}
          activities={allMeetings}
        />
      </div>

      {/* Log Expo / Site visit / Home visit — km-reimbursement logger. Team-aware
          label exactly as leads/[id] (Dubai → Expo/Dubai site visit; India → Home). */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-2">Log Expo / Site visit / Home visit</div>
        <AdvancedActivityLogger
          leadId={lead.id}
          team={(lead.forwardedTeam === "Dubai" || lead.forwardedTeam === "India") ? lead.forwardedTeam : null}
          travelRatePerKm={travelRatePerKmInr}
        />
      </div>

      {/* Reassign — admin/manager only (mirrors leads/[id] gating). Was BROKEN on
          Revival before (LeadActionsClient called with hideReassign + no standalone
          control). Now the SAME LeadReassignClient → /api/leads/[id]/assign. Hidden
          while the record is rejected (reactivate-before-reassign rule, same as
          leads/[id]); the Cold-data actions card below handles the rejected state. */}
      {canReassign && lead.rejectedAt == null && (
        <div className="card p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold">🛠 Reassign</div>
          <LeadReassignClient
            leadId={lead.id}
            currentOwnerId={lead.ownerId}
            agents={agents.map(a => ({ id: a.id, name: a.name, role: a.role, team: a.team }))}
            leadTeam={lead.forwardedTeam}
          />
        </div>
      )}

      {/* Properties Discussed — LeadProjectsClient (→ /api/leads/[id]/discussed…).
          Admin/Manager bypass the picker's country filter (same as leads/[id]);
          agents stay geo-scoped to the record's market. */}
      <div className="card p-4">
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

      {/* Interested Properties — LeadInterestedClient (same shared component +
          routes as leads/[id]); legacy notes + interested units carried through. */}
      <div className="card p-4">
        <LeadInterestedClient
          leadId={lead.id}
          initial={lead.interestedProjects.map(d => ({
            projectId: d.projectId,
            interestedAt: d.interestedAt.toISOString(),
            project: { name: d.project.name, city: d.project.city },
            autoDetected: d.autoDetected,
            suggestion: d.suggestion,
            sourceType: d.sourceType,
            sourceDate: d.sourceDate?.toISOString() ?? null,
            sourceText: d.sourceText,
          }))}
          allProjects={allProjects}
          scopeCountry={(me.role === "ADMIN" || me.role === "MANAGER") ? null : teamToCountry(lead.forwardedTeam)}
          legacyNotes={interestNotes.map(n => ({
            id: n.id,
            noteText: n.noteText,
            autoDetected: n.autoDetected,
            sourceType: n.sourceType ?? null,
            sourceDate: n.sourceDate?.toISOString() ?? null,
          }))}
          interestedUnits={lead.interestedUnits.map(p => ({
            id: p.id,
            type: p.type,
            unit: {
              id: p.unit.id,
              code: p.unit.code,
              configuration: p.unit.configuration,
              project: { name: p.unit.project.name, country: p.unit.project.country },
            },
          }))}
        />
      </div>

      {/* ── Convert to Lead — primary CTA ── */}
      <div className="card p-5">
        <div className="font-semibold text-sm mb-2">🚀 Convert to Active Lead</div>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
          Once this prospect qualifies (connected call, expressed interest) — convert them.
          All call history, WhatsApp messages, and notes carry over. They will appear in{" "}
          <strong>Leads</strong>, not Revival Engine.
        </p>
        <ColdDataPromoteButton leadId={lead.id} leadName={lead.name} />
      </div>

      {/* ── Reject — keeps the lead in Revival as Rejected (NOT promoted) ──
          Wires the SAME RejectLeadModal + origin-safe /api/leads/[id]/reject the
          Leads detail uses. Reject sets currentStatus = rejectionStatusFor(reason),
          records rejectionReason/Note/At/By, clears the follow-up, and logs a
          STATUS_CHANGE Activity + Note + AuditLog + notify — and NEVER touches
          leadOrigin/isColdCall. So the lead remains a cold/revival record (now
          Rejected); it is not moved to Leads or Master Data. redirectTo=/cold-calls
          returns the user to the Revival list. */}
      <div className="card p-5">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold mb-2">🛠 Cold-data actions</div>
        {lead.rejectedAt != null ? (
          <div className="text-xs text-gray-600 dark:text-slate-300">
            Already rejected{lead.rejectionReason ? ` — ${lead.rejectionReason.replace(/_/g, " ").toLowerCase()}` : ""}. The record stays in Revival, marked Rejected.
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              Not a real prospect? Reject it — the record stays here in Revival (marked Rejected), out of the working queue. It is <strong>not</strong> promoted or moved to Leads.
            </p>
            <RejectLeadModal leadId={lead.id} forwardedTeam={lead.forwardedTeam} redirectTo="/cold-calls" />
          </>
        )}
      </div>

      {/* ── Imported sheet columns (verbatim) — Admin/Super-Admin/Lalit only ── */}
      {/* Parity with leads/[id]: pass leadId + editable so admins can inline-edit the
          imported values. Revival rows ARE Leads, so ImportedFieldEdit's shared MERGE
          route (/api/leads/[id]/update) applies unchanged — no new route/field. */}
      {me.role === "ADMIN" && (
        <ImportedFieldsCard customFields={lead.customFields} rawImport={lead.rawImport} leadId={lead.id} editable />
      )}

      {/* ── Change History — field-level audit of Cold Data Bank edits (who · old→new ·
          timestamp), logged automatically on every inline edit via recordFieldChanges. ── */}
      {(me.role === "ADMIN" || me.role === "MANAGER") && lead.fieldHistory.length > 0 && (
        <ChangeHistoryCard rows={lead.fieldHistory} />
      )}

      {/* ── Conversation history (single source of truth) ── */}
      <ConversationStreamCard
        callLogs={lead.callLogs}
        waMessages={lead.waMessages}
        notes={lead.notes}
        activities={lead.activities}
        forwardedTeam={lead.forwardedTeam}
        rawRemarks={lead.rawRemarks ?? lead.remarks}
        isAdmin={me.role === "ADMIN"}
        meId={me.id}
        leadOwnerName={lead.owner?.name ?? null}
      />

      {/* ── Quick note ── */}
      <QuickNoteCard leadId={lead.id} isAdmin={me.role === "ADMIN"} />

      {/* ── Meta info ── */}
      <div className="card p-4 text-xs text-gray-500 dark:text-slate-400 space-y-1">
        <div>Source: <span className="font-medium text-gray-700 dark:text-slate-300">{lead.source}</span></div>
        {lead.coldCallReason && <div>Cold reason: <span className="font-medium">{lead.coldCallReason}</span></div>}
        {lead.owner && <div>Assigned to: <span className="font-medium text-gray-700 dark:text-slate-300">{lead.owner.name}</span></div>}
        <div>Created: {format(lead.createdAt, "dd MMM yyyy")}</div>
      </div>
        </>}
      />
    </>
  );
}
