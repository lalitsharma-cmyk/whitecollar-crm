// §12/§13/§14 — Cold Data detail page.
// Lives at /revival-engine/cold-data/:id — SEPARATE from /leads/:id.
// Shows "COLD DATA RECORD" badge so there is no confusion.
// Available actions: Call, WhatsApp, Log Call, Add Note, Mark Interested, Convert to Lead.
// Convert to Lead: carries all history (calls, WA, notes, activities) — just flips isColdCall=false.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { leadScopeWhere } from "@/lib/leadScope";
import { formatDistanceToNow, format } from "date-fns";
import ConversationStreamCard from "@/components/ConversationStreamCard";
import QuickNoteCard from "@/components/QuickNoteCard";
import LeadActionsClient from "@/components/LeadActionsClient";
import { acefoneEnabled } from "@/lib/acefone";
import { statusColor } from "@/lib/lead-statuses";
import ColdDataPromoteButton from "@/components/ColdDataPromoteButton";
function maskPhone(p?: string | null): string | null {
  if (!p) return null;
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

  const lead = await prisma.lead.findFirst({
    where: { id, isColdCall: true, ...scope },
    include: {
      owner: { select: { id: true, name: true, avatarColor: true } },
      callLogs: { orderBy: { startedAt: "desc" }, take: 50, include: { user: { select: { name: true } } } },
      waMessages: { orderBy: { receivedAt: "desc" }, take: 30 },
      notes: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      activities: { orderBy: { createdAt: "desc" }, take: 20, include: { user: { select: { name: true } } } },
    },
  });

  if (!lead) {
    // If the lead exists but is no longer cold, redirect to leads
    const promoted = await prisma.lead.findFirst({ where: { id, ...scope } });
    if (promoted) redirect(`/leads/${id}`);
    notFound();
  }

  const agents = await prisma.user.findMany({
    where: { active: true, role: { in: ["AGENT", "MANAGER", "ADMIN"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true, team: true, avatarColor: true },
  });

  const canReassign = me.role === "ADMIN" || me.role === "MANAGER";
  const lastTouched = lead.lastTouchedAt
    ? formatDistanceToNow(lead.lastTouchedAt, { addSuffix: true })
    : "never touched";

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-16">
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

      {/* ── Main header card ── */}
      <div className="card p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0 flex-1">
            {/* Name + status */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{lead.name}</h2>
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
              {lead.phone && <span>📞 {maskPhone(lead.phone)}</span>}
              {lead.altPhone && <span>📱 {maskPhone(lead.altPhone)}</span>}
              {lead.email && <span>✉️ {lead.email}</span>}
              {lead.city && <span>📍 {lead.city}</span>}
            </div>

            {/* Requirement snapshot */}
            {(lead.configuration || lead.budgetMin || lead.notesShort) && (
              <div className="flex flex-wrap gap-2 text-[11px] mb-3">
                {lead.configuration && (
                  <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded font-medium">
                    {lead.configuration}
                  </span>
                )}
                {lead.budgetMin && (
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-medium">
                    {lead.budgetCurrency} {(lead.budgetMin / 1_000_000).toFixed(1)}M
                    {lead.budgetMax && lead.budgetMax > lead.budgetMin ? ` – ${(lead.budgetMax / 1_000_000).toFixed(1)}M` : ""}
                  </span>
                )}
                {lead.notesShort && (
                  <span className="text-gray-500 truncate max-w-[220px]">{lead.notesShort}</span>
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
              phoneMasked={maskPhone(lead.phone)}
              altPhoneMasked={maskPhone(lead.altPhone)}
              leadName={lead.name}
              agentName={me.name}
              acefoneEnabled={acefoneEnabled()}
              acefoneMappedForUser={!!me.acefoneAgentId}
              hideReassign={true}
            />
          </div>
        </div>
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

      {/* ── Conversation history (single source of truth) ── */}
      <ConversationStreamCard
        callLogs={lead.callLogs}
        waMessages={lead.waMessages}
        notes={lead.notes}
        forwardedTeam={lead.forwardedTeam}
        rawRemarks={lead.remarks}
      />

      {/* ── Quick note ── */}
      <QuickNoteCard leadId={lead.id} />

      {/* ── Meta info ── */}
      <div className="card p-4 text-xs text-gray-500 dark:text-slate-400 space-y-1">
        <div>Source: <span className="font-medium text-gray-700 dark:text-slate-300">{lead.source}</span></div>
        {lead.coldCallReason && <div>Cold reason: <span className="font-medium">{lead.coldCallReason}</span></div>}
        {lead.owner && <div>Assigned to: <span className="font-medium text-gray-700 dark:text-slate-300">{lead.owner.name}</span></div>}
        <div>Created: {format(lead.createdAt, "dd MMM yyyy")}</div>
      </div>
    </div>
  );
}
