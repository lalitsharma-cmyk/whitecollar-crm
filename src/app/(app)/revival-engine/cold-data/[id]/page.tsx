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
import { statusColor } from "@/lib/lead-statuses";
import ColdDataPromoteButton from "@/components/ColdDataPromoteButton";
import RejectLeadModal from "@/components/RejectLeadModal";
import ImportedFieldsCard from "@/components/ImportedFieldsCard";
import ColdClientInfoCard from "@/components/ColdClientInfoCard";
import ChangeHistoryCard from "@/components/ChangeHistoryCard";
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
              {lead.currentStatus && (
                <span className={`${statusColor(lead.currentStatus)} text-xs px-2.5 py-0.5 rounded-full border font-semibold`}>
                  {lead.currentStatus}
                </span>
              )}
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

            {/* Action buttons */}
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
            />
          </div>
        </div>
      </div>

      {/* ── Client Information (inline-editable · Cold Data Bank) — data fields only,
          no Lead-only workflow. Edits save to the master record + log field history. ── */}
      <ColdClientInfoCard lead={lead} isAdmin={me.role === "ADMIN"} />

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
      {me.role === "ADMIN" && (
        <ImportedFieldsCard customFields={lead.customFields} rawImport={lead.rawImport} />
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
