import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import ImportedFieldsCard from "@/components/ImportedFieldsCard";
import ChangeHistoryCard from "@/components/ChangeHistoryCard";
import BuyerInlineEdit from "@/components/BuyerInlineEdit";
import BuyerActivityTimeline from "@/components/BuyerActivityTimeline";
import BuyerActionsClient from "@/components/BuyerActionsClient";
import LeadFollowupActions from "@/components/LeadFollowupActions";
import LeadVoiceGuidance from "@/components/LeadVoiceGuidance";
import { hasBuyerContactToday } from "@/lib/buyerFollowup";
import BuyerAdminPanel from "@/components/BuyerAdminPanel";
import BuyerQuickNoteCard from "@/components/BuyerQuickNoteCard";
import BuyerNotesCard from "@/components/BuyerNotesCard";
import StickyNoteWidget from "@/components/StickyNoteWidget";
import LeadMobileTabs from "@/components/LeadMobileTabs";
import { canTouchBuyer, canAccessDubaiBuyers, isDubaiAssignable } from "@/lib/buyerScope";
import {
  parseJsonArray,
  rollupForRecords,
  formatTxnValue,
  inferBuyerCurrency,
  classifyBuyer,
  BUYER_CLASS_META,
} from "@/lib/buyerIntelligence";
import {
  CARD, VERDICT_CARD, VERDICT_EYEBROW, CARD_TITLE, CARD_TITLE_HINT,
  ADMIN_EYEBROW, FIELD_GRID_2, FIELD_LABEL, PAGE_GRID, MAIN_COL, RIGHT_RAIL,
} from "@/lib/detailLayout";

// ── Buyer Data detail — UNIFIED with the Lead detail view (Lead = master template).
// Both pages now share the class tokens in src/lib/detailLayout.ts (3rd alignment
// pass) so the two views CANNOT drift apart again. The visual shell matches the
// Lead detail section-for-section:
//   MAIN COLUMN (col-span-2, space-y-4):
//     • Header card (card p-4): name (inline-edit) + status chip + snapshot chips
//       + the fluid action button row (BuyerActionsClient → ACTION_ROW token).
//     • Buyer Intelligence (VERDICT_CARD — same shell/tint as the Lead BANT card).
//     • Conversation History (CONVO_CARD — BuyerActivityTimeline, Raw + Smart).
//     • Quick Note (BuyerQuickNoteCard) — secondary, after Conversation History.
//     • BELOW QUICK NOTE → buyer extras (additions only, SAME CARD token):
//       Property / Transaction details + Imported Fields + multi-property table.
//   RIGHT RAIL (space-y-3) — SAME density + card styles as the Lead right rail:
//     • Sticky-Note widget (StickyNoteWidget, apiBase=/api/buyer-data).
//     • Client information card (CARD + FIELD_GRID_2 — the Lead's exact 2-col style).
//     • 📍 Location card (CARD + FIELD_GRID_2 — mirrors the Lead Location card).
//     • 💳 Transaction & next action card (occupies the Lead "Scheduling" slot).
//     • Buyer admin panel (BuyerAdminPanel — mirrors the Lead "🛠 Lead admin" card).
//     • Working notes (BuyerNotesCard) + Source provenance card (admin/manager).
// Buyer-specific data only; the Lead view is untouched. Scoped via canTouchBuyer.
export const dynamic = "force-dynamic";

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—";
const toDateInput = (d: Date | null) =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

export default async function BuyerDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  // Dubai Buyer Data — visible only to Admin + Dubai-team users. Non-Dubai
  // (India/Gurgaon) agents/managers are redirected away (parity with the list).
  if (!canAccessDubaiBuyers(me)) redirect("/dashboard");

  const rec = await prisma.buyerRecord.findUnique({ where: { id }, include: { owner: { select: { id: true, name: true } } } });
  if (!rec) notFound();
  // 404 (not 403) if this user can't see this buyer — also blocks a soft-deleted
  // one AND a non-Dubai-market buyer (canTouchBuyer enforces market="Dubai").
  if (!(await canTouchBuyer(me, { ownerId: rec.ownerId, poolStatus: rec.poolStatus, deletedAt: rec.deletedAt, market: rec.market }))) notFound();

  const isAdmin = me.role === "ADMIN";
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  // Convert/Reject: the assigned agent (own ASSIGNED) or an admin. Assign/Transfer: admin/manager.
  const canConvertReject = isAdmin || (rec.ownerId === me.id && rec.poolStatus === "ASSIGNED");
  const canAssign = isAdminOrMgr;
  // canLog (action row + quick note): an ASSIGNED buyer worked by the viewer (or admin).
  const canLog = isAdmin || (rec.ownerId === me.id && rec.poolStatus === "ASSIGNED");
  // Inline edits are allowed for anyone who can touch the buyer (admin any; assigned
  // agent their own) — the PATCH route re-checks canTouchBuyer server-side.
  const canEditFields = canConvertReject;
  // Contact-today gate for the follow-up "Complete" button (parity with leads:
  // an agent must log a real touch before completing). Only needed when the
  // follow-up bar renders (canLog); admins bypass the gate server-side anyway.
  const buyerHasContactToday = canLog ? await hasBuyerContactToday(id) : false;

  // Repeat-buyer rollup: all LIVE records sharing this buyerKey (incl. this one).
  const siblings = rec.buyerKey
    ? await prisma.buyerRecord.findMany({
        where: { buyerKey: rec.buyerKey, deletedAt: null },
        orderBy: { transactionDate: "asc" },
      })
    : [rec];
  const rollup = rollupForRecords(siblings);
  const others = siblings.filter((s) => s.id !== rec.id);

  // Agent roster for the admin panel (admin/mgr only). DUBAI ONLY — Dubai-team
  // AGENT/MANAGER + admins; India/Gurgaon + HR excluded (the assign endpoint
  // re-enforces this server-side via isDubaiAssignable).
  const agents = canAssign
    ? (await prisma.user.findMany({
        where: {
          active: true,
          hrOnly: false,
          OR: [
            { team: "Dubai", role: { in: ["AGENT", "MANAGER"] } },
            { role: "ADMIN" },
          ],
        },
        select: { id: true, name: true, team: true, role: true }, orderBy: { name: "asc" },
      })).filter((a) => isDubaiAssignable(a)).map(({ id, name, team }) => ({ id, name, team }))
    : [];

  // Sticky note — private to the calling user, upserted so the widget renders
  // synchronously (mirrors the Lead view's StickyNote upsert).
  const stickyNote = await prisma.buyerStickyNote.upsert({
    where: { buyerId_userId: { buyerId: rec.id, userId: me.id } },
    create: { buyerId: rec.id, userId: me.id, body: "" },
    update: {},
  });

  // Manager Voice Guidance (Channel ①) — buyer parity with the Lead view. Admin
  // records; the assigned agent plays + marks understood. Mapped to the SAME
  // VoiceGuidanceMsg shape the shared LeadVoiceGuidance component consumes.
  const voiceGuidanceRaw = await prisma.buyerVoiceMessage.findMany({
    where: { buyerId: rec.id, kind: "GUIDANCE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, createdAt: true, transcript: true, title: true, durationSec: true, createdById: true,
      createdBy: { select: { name: true } },
      reads: { where: { userId: me.id }, select: { id: true } },
    },
  });
  const voiceGuidance = voiceGuidanceRaw.map((v) => ({
    id: v.id,
    by: v.createdBy?.name ?? "Admin",
    at: v.createdAt.toISOString(),
    transcript: v.transcript,
    title: v.title,
    durationSec: v.durationSec,
    understood: v.reads.length > 0,
    mine: v.createdById === me.id,
  }));

  // Field-level Change History (admin/manager) — parity with the Lead detail's
  // ChangeHistoryCard; every inline-edit is now recorded in BuyerFieldHistory.
  const fieldHistory = isAdminOrMgr
    ? await prisma.buyerFieldHistory.findMany({
        where: { buyerId: rec.id },
        orderBy: { changedAt: "desc" },
        take: 60,
        select: { id: true, field: true, oldValue: true, newValue: true, changedAt: true, source: true, changedBy: { select: { name: true } } },
      })
    : [];

  const ccy = inferBuyerCurrency({ nationality: rec.nationality, projectName: rec.projectName, source: rec.source, market: rec.market });
  const buyerClass = classifyBuyer({ totalPropertiesOwned: rollup.totalPropertiesOwned, totalInvestmentValue: rollup.totalInvestmentValue }, ccy);
  const coBuyers = parseJsonArray(rec.coBuyerNames);
  const phones = parseJsonArray(rec.phones);
  const emails = parseJsonArray(rec.emails);
  const primaryPhone = phones[0] ?? null;
  const altPhone = phones[1] ?? null;
  const primaryEmail = emails[0] ?? null;

  // poolStatus → status-chip colour, styled like the Lead status chip.
  const poolLabel = rec.poolStatus.replace(/_/g, " ");
  const statusChipCls =
    rec.poolStatus === "CONVERTED" ? "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700"
    : rec.poolStatus === "ASSIGNED" ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"
    : rec.poolStatus === "REJECTED" ? "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700"
    : "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700";

  // Small inline field renderer for the buyer extra section (label + value/editor).
  // Uses the SAME label token as the Lead view's Client-Info / Location rows.
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex flex-col min-w-0">
      <span className={FIELD_LABEL}>{label}</span>
      <span className="text-gray-800 dark:text-slate-200 break-words text-sm">{children}</span>
    </div>
  );
  // Inline-or-readonly: edit when permitted, else show the value plainly (parity
  // with the Lead view, where agents on others' records see read-only values).
  const editable = (field: string, value: string | number | null, opts?: { type?: "text" | "number" | "date"; display?: string; options?: string[] }) =>
    canEditFields
      ? <BuyerInlineEdit recordId={rec.id} field={field} value={value} type={opts?.type} display={opts?.display} options={opts?.options} />
      : <>{opts?.display ?? (value == null || value === "" ? "—" : String(value))}</>;
  // Property-country dropdown options — Dubai module → UAE primary, plus GCC + the
  // common buyer-home countries for the occasional non-UAE record (#247).
  const BUYER_COUNTRY_OPTIONS = ["United Arab Emirates", "Saudi Arabia", "Qatar", "Oman", "Bahrain", "Kuwait", "India", "United Kingdom", "Pakistan", "United States", "Canada", "Other"];

  return (
    <>
      {/* Mobile tab bar — identical mechanism to the Lead view (sets body[data-lead-tab]). */}
      <LeadMobileTabs />

      {/* Floating private sticky note — reuses the EXACT Lead widget, pointed at the
          buyer sticky-note API. Renders nothing until opened (or when a body exists). */}
      <StickyNoteWidget
        leadId={rec.id}
        initialBody={stickyNote.body}
        initialUpdatedAt={stickyNote.updatedAt ? stickyNote.updatedAt.toISOString() : null}
        apiBase="/api/buyer-data"
      />

      <div className={PAGE_GRID}>
        {/* ── MAIN COLUMN (col-span-2) ──────────────────────────────────────── */}
        <div className={MAIN_COL}>
          {/* Header — name + status chip + action button row (always visible, no
              data-lead-section so the mobile tabs never hide it; matches Lead view). */}
          <div className={CARD}>
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold dark:text-slate-100">
                    {canEditFields
                      ? <BuyerInlineEdit recordId={rec.id} field="clientName" value={rec.clientName} />
                      : rec.clientName}
                  </h2>
                  {/* Status = the REAL imported buyer status (R4) — primary chip.
                      The Admin-Pool / assignment lifecycle is a SEPARATE, explicitly
                      labeled chip so "Status" is never again read as "Admin Pool". */}
                  {rec.businessStatus && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full border font-semibold inline-flex items-center bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700">
                      {rec.businessStatus}
                    </span>
                  )}
                  <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold inline-flex items-center ${statusChipCls}`} title="Data Pool / assignment lifecycle — separate from the imported Status">
                    Pool: {poolLabel}
                  </span>
                  {/* Classification tier — First-Time / Investor / Whale (matches the list badge). */}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold inline-flex items-center gap-0.5 ${BUYER_CLASS_META[buyerClass].tone}`}>
                    {BUYER_CLASS_META[buyerClass].emoji} {BUYER_CLASS_META[buyerClass].label}
                  </span>
                  {rollup.repeatBuyerStatus && (
                    <span className="chip text-[10px] bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
                      🔁 Repeat buyer · {rollup.totalPropertiesOwned} properties
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  {rec.projectName || "—"}{rec.unitNumber ? ` · Unit ${rec.unitNumber}` : ""}
                </div>
                {/* Requirement snapshot chips — Configuration + Transaction value (mirrors
                    the Lead header's config + budget chip row). */}
                {(rec.configuration || rec.transactionValue) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {rec.configuration && (
                      <span className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 px-2 py-0.5 rounded font-medium">
                        {rec.configuration}
                      </span>
                    )}
                    {rec.transactionValue != null && (
                      <span className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 px-2 py-0.5 rounded font-medium">
                        {formatTxnValue(rec.transactionValue, ccy)}
                      </span>
                    )}
                  </div>
                )}
                {/* Action button row — same fluid flex primitive + button styling as
                    the Lead view (BuyerActionsClient → ACTION_ROW token). */}
                <BuyerActionsClient
                  buyerId={rec.id}
                  phone={primaryPhone}
                  altPhone={altPhone}
                  email={primaryEmail}
                  clientName={rec.clientName}
                  agentName={me.name}
                  canLog={canLog}
                >
                  {/* Complete / Snooze / Escalate — the SAME follow-up bar as the
                      Lead view, pointed at the buyer follow-up endpoints. Renders
                      inline with Call/WhatsApp/…/Voice. Only on an ASSIGNED buyer. */}
                  {canLog && (
                    <LeadFollowupActions
                      apiBase="/api/buyer-data"
                      leadId={rec.id}
                      leadName={rec.clientName}
                      followupDate={rec.followupDate ? rec.followupDate.toISOString() : null}
                      hasContactToday={buyerHasContactToday}
                      compact
                    />
                  )}
                </BuyerActionsClient>
              </div>
            </div>
          </div>

          {/* Buyer Intelligence — occupies the BANT-verdict slot at the top of the
              left column (rollup metrics). SAME shell + tint as the Lead BANT card
              (VERDICT_CARD token). data-lead-section="overview". */}
          <div data-lead-section="overview" className={VERDICT_CARD}>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={VERDICT_EYEBROW}>📊 BUYER INTELLIGENCE</span>
              <span className="text-[10px] text-gray-500 dark:text-slate-400">Properties · Investment · Purchase history</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <div>
                <div className="text-lg font-bold text-gray-800 dark:text-slate-100">{rollup.totalPropertiesOwned}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Properties Owned</div>
              </div>
              <div>
                <div className="text-lg font-bold text-gray-800 dark:text-slate-100">{formatTxnValue(rollup.totalInvestmentValue, ccy)}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Total Investment</div>
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-800 dark:text-slate-100 mt-1">{fmtDate(rollup.firstPurchaseDate)}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">First Purchase</div>
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-800 dark:text-slate-100 mt-1">{fmtDate(rollup.latestPurchaseDate)}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Latest Purchase</div>
              </div>
              <div>
                <div className={`text-sm font-semibold mt-1 ${rollup.repeatBuyerStatus ? "text-amber-600 dark:text-amber-400" : "text-gray-500"}`}>
                  {rollup.repeatBuyerStatus ? "Repeat 🔁" : "First-time"}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Buyer Status</div>
              </div>
            </div>
          </div>

          {/* Conversation History — Raw History + Smart Timeline (BuyerActivity),
              same card look as the Lead Conversation History (CONVO_CARD). */}
          <div data-lead-section="timeline">
            <BuyerActivityTimeline buyerId={rec.id} canLog={canLog} isAdmin={isAdmin} rawRemarks={rec.remarks} />
          </div>

          {/* Manager Voice Guidance — same shared component + placement as the Lead
              view (after Conversation History), pointed at the buyer voice endpoints.
              Admin sees the recorder; agents see guidance once it exists. */}
          <div data-lead-section="timeline">
            <LeadVoiceGuidance apiBase="/api/buyer-data" leadId={rec.id} isAdmin={isAdmin} messages={voiceGuidance} />
          </div>

          {/* Quick Note — secondary, after Conversation History (parity with Lead view). */}
          <div data-lead-section="timeline">
            <BuyerQuickNoteCard buyerId={rec.id} canLog={canLog} />
          </div>

          {/* ════════════════════════════════════════════════════════════════════
              BUYER DATA EXTRA SECTION — below Quick Note, in the available space.
              Property / Transaction details + Imported fields + multi-property table.
              These are the intended ADDITIONS (the buyer-only data); every card uses
              the SAME CARD token + CARD_TITLE heading style as the Lead view's cards,
              so they read as part of the same layout, never a bespoke style.
              ════════════════════════════════════════════════════════════════════ */}

          {/* Buyer Property Details */}
          <div data-lead-section="overview" className={CARD}>
            <div className={CARD_TITLE}>🏠 Buyer Property Details {canEditFields && <span className={CARD_TITLE_HINT}>(click any value to edit)</span>}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
              <Field label="Project">{editable("projectName", rec.projectName)}</Field>
              <Field label="Tower / Building">{editable("tower", rec.tower)}</Field>
              <Field label="Unit Number">{editable("unitNumber", rec.unitNumber)}</Field>
              <Field label="Property Type">{editable("propertyType", rec.propertyType)}</Field>
              <Field label="Configuration">{editable("configuration", rec.configuration)}</Field>
              <Field label="Size">{editable("size", rec.size)}</Field>
              <Field label="Actual Size">{editable("actualSize", rec.actualSize)}</Field>
              <Field label="Area">{editable("area", rec.area)}</Field>
              <Field label="Country">{editable("country", rec.country, { options: BUYER_COUNTRY_OPTIONS })}</Field>
            </div>
          </div>

          {/* Transaction Details */}
          <div data-lead-section="overview" className={CARD}>
            <div className={CARD_TITLE}>💳 Transaction Details {canEditFields && <span className={CARD_TITLE_HINT}>(click any value to edit)</span>}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
              <Field label="Transaction Value">{editable("transactionValue", rec.transactionValue, { type: "number", display: formatTxnValue(rec.transactionValue, ccy) })}</Field>
              <Field label="Transaction Date">{editable("transactionDate", toDateInput(rec.transactionDate), { type: "date", display: fmtDate(rec.transactionDate) })}</Field>
              <Field label="Transaction ID">{editable("transactionId", rec.transactionId)}</Field>
              <Field label="Price / sq.ft">{editable("pricePerSqFt", rec.pricePerSqFt, { type: "number", display: rec.pricePerSqFt != null ? formatTxnValue(rec.pricePerSqFt, ccy) : undefined })}</Field>
              <Field label="Transaction Type">{editable("transactionType", rec.transactionType)}</Field>
              <Field label="Role">{editable("role", rec.role)}</Field>
            </div>
          </div>

          {/* Imported Fields — unmapped import columns (extraFields) + the verbatim
              full original row (rawImport, collapsible "Original Imported Row"). */}
          <ImportedFieldsCard customFields={rec.extraFields} rawImport={rec.rawImport} />

          {/* Change History — field-level audit (admin/manager), same shared card
              as the Lead view. Populated from BuyerFieldHistory going forward. */}
          {isAdminOrMgr && <ChangeHistoryCard rows={fieldHistory} />}

          {/* Multiple Properties table — all records sharing this buyerKey. */}
          {others.length > 0 && (
            <div data-lead-section="overview" className={CARD}>
              <div className={CARD_TITLE}>🏘️ Properties owned by this buyer <span className="text-[11px] text-gray-400 font-normal">— {rollup.totalPropertiesOwned} total (this + {others.length} other{others.length === 1 ? "" : "s"})</span></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                      <th className="px-2 py-1.5">Project</th>
                      <th className="px-2 py-1.5">Tower / Building</th>
                      <th className="px-2 py-1.5">Unit</th>
                      <th className="px-2 py-1.5">Config</th>
                      <th className="px-2 py-1.5">Size</th>
                      <th className="px-2 py-1.5 text-right">Txn Value</th>
                      <th className="px-2 py-1.5">Txn Date</th>
                      <th className="px-2 py-1.5">Owner</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {[rec, ...others].map((o) => {
                      const occy = inferBuyerCurrency({ nationality: o.nationality, projectName: o.projectName, source: o.source, market: o.market });
                      const isThis = o.id === rec.id;
                      return (
                        <tr key={o.id} className={isThis ? "bg-amber-50/40 dark:bg-amber-900/10" : "hover:bg-gray-50 dark:hover:bg-slate-800/50"}>
                          <td className="px-2 py-1.5">
                            {isThis ? <span className="font-medium text-gray-800 dark:text-slate-200">{o.projectName || "—"} <span className="text-[10px] text-amber-600">(this)</span></span>
                              : <Link href={`/buyer-data/${o.id}`} className="text-[#0b1a33] dark:text-blue-300 hover:underline">{o.projectName || "—"}</Link>}
                          </td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.tower || "—"}</td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.unitNumber || "—"}</td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.configuration || "—"}</td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.size || "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-800 dark:text-slate-200">{formatTxnValue(o.transactionValue, occy)}</td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400 whitespace-nowrap">{fmtDate(o.transactionDate)}</td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.ownerName || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT RAIL ────────────────────────────────────────────────────────
            SAME density + card styles as the Lead right rail. Lead order is:
            Sticky → Client information → Location → Scheduling → … → admin.
            Buyer mirrors: Client information → Location → Transaction & next action
            → Buyer admin → Working notes → Source. ──────────────────────────── */}
        <div className={RIGHT_RAIL}>
          {/* Client information — RIGHT-RAIL 2-col card, byte-identical shell + grid
              + label style to the Lead view's `qualificationCard` (the Client
              Information card). Buyer-specific fields (nationality/passport/co-buyers)
              slot into the SAME rows. */}
          <div data-lead-section="overview" className={CARD}>
            <div className={CARD_TITLE}>Client information {canEditFields && <span className={CARD_TITLE_HINT}>(click any value to edit)</span>}</div>
            <div className={`${FIELD_GRID_2} [&>div]:min-w-0 [&>div]:overflow-hidden`}>
              <div>
                <div className={FIELD_LABEL}>👤 Buyer Name</div>
                {/* Read-only here — the header h2 is the single editable source for
                    the name (parity with the Lead view, which edits name only in
                    the header). Avoids two live editors on one field. */}
                <span className="text-gray-800 dark:text-slate-200 break-words">{rec.clientName || "—"}</span>
              </div>
              <div>
                <div className={FIELD_LABEL}>📞 Phone</div>
                <span className="text-gray-800 dark:text-slate-200 break-words">{phones.length ? phones.join(", ") : "—"}</span>
              </div>
              <div>
                <div className={FIELD_LABEL}>✉️ Email</div>
                <span className="text-gray-800 dark:text-slate-200 break-words">{emails.length ? emails.join(", ") : "—"}</span>
              </div>
              <div>
                <div className={FIELD_LABEL}>👥 Co-Buyers</div>
                <span className="text-gray-800 dark:text-slate-200 break-words">{coBuyers.length ? coBuyers.join(", ") : "—"}</span>
              </div>
              <div>
                <div className={FIELD_LABEL}>🌍 Nationality</div>
                {editable("nationality", rec.nationality)}
              </div>
              <div>
                <div className={FIELD_LABEL}>🛂 Passport Number</div>
                {editable("passport", rec.passport)}
              </div>
              <div>
                <div className={FIELD_LABEL}>📅 Passport Expiry</div>
                {editable("passportExpiry", rec.passportExpiry)}
              </div>
              <div>
                <div className={FIELD_LABEL}>🧾 Owner Name</div>
                {editable("ownerName", rec.ownerName)}
              </div>
              <div>
                <div className={FIELD_LABEL}>🧑‍💼 Sales Agent</div>
                {editable("agentName", rec.agentName)}
              </div>
              {/* Source is import provenance, not client info — shown only in the
                  admin/manager provenance card below (Lalit 2026-06-27, #248). */}
            </div>
          </div>

          {/* 📍 Location — mirrors the Lead view's right-rail Location card shell
              exactly (same CARD + FIELD_GRID_2 + label style). Country + Area are
              shown READ-ONLY here (their single editable source is the main-column
              Property Details card) so no field is bound to two editors — a buyer
              field with two inline editors could desync (guarded by buyer-5b). */}
          <div data-lead-section="overview" className={CARD}>
            <div className={CARD_TITLE}>📍 Location</div>
            <div className={FIELD_GRID_2}>
              <div>
                <div className={`${FIELD_LABEL} mb-0.5`}>Country</div>
                <span className="text-gray-800 dark:text-slate-200 break-words">{rec.country || "—"}</span>
              </div>
              <div>
                <div className={`${FIELD_LABEL} mb-0.5`}>Area</div>
                <span className="text-gray-800 dark:text-slate-200 break-words">{rec.area || "—"}</span>
              </div>
            </div>
          </div>

          {/* 💳 Status, follow-up & purchase — occupies the Lead "📅 Scheduling &
              next action" slot in the right rail, SAME CARD + FIELD_GRID_2 style.
              The imported buyer Status + the Follow-up date (parity with leads,
              R4/R5) lead the card, alongside the headline purchase facts; the full
              editable Transaction Details card lives in the main column. */}
          <div data-lead-section="actions" className={CARD}>
            <div className={CARD_TITLE}>💳 Status & next action</div>
            <div className={FIELD_GRID_2}>
              <div>
                <div className={`${FIELD_LABEL} mb-0.5`}>Status</div>
                <span className="text-gray-800 dark:text-slate-200 break-words font-medium">{editable("businessStatus", rec.businessStatus)}</span>
              </div>
              <div>
                <div className={`${FIELD_LABEL} mb-0.5`}>Follow-up</div>
                <span className="text-gray-800 dark:text-slate-200 break-words">{editable("followupDate", rec.followupDate ? rec.followupDate.toISOString().slice(0, 10) : null, { type: "date", display: fmtDate(rec.followupDate) })}</span>
              </div>
              <div>
                <div className={`${FIELD_LABEL} mb-0.5`}>Transaction Value</div>
                <span className="text-gray-800 dark:text-slate-200 break-words font-semibold">{formatTxnValue(rec.transactionValue, ccy)}</span>
              </div>
              <div>
                <div className={`${FIELD_LABEL} mb-0.5`}>Transaction Date</div>
                <span className="text-gray-800 dark:text-slate-200 break-words">{fmtDate(rec.transactionDate)}</span>
              </div>
              <div>
                <div className={`${FIELD_LABEL} mb-0.5`}>Latest Purchase</div>
                <span className="text-gray-800 dark:text-slate-200 break-words">{fmtDate(rollup.latestPurchaseDate)}</span>
              </div>
              <div>
                <div className={`${FIELD_LABEL} mb-0.5`}>Repeat Buyer</div>
                <span className={`break-words font-medium ${rollup.repeatBuyerStatus ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-slate-400"}`}>{rollup.repeatBuyerStatus ? "Yes 🔁" : "First-time"}</span>
              </div>
            </div>
          </div>

          {/* Buyer admin panel — convert / assign / reject + attempt + transfer history
              (mirrors the Lead "🛠 Lead admin" right-rail card, SAME card shell). */}
          <BuyerAdminPanel
            buyerId={rec.id}
            poolStatus={rec.poolStatus}
            ownerName={rec.owner?.name ?? null}
            convertedLeadId={rec.convertedLeadId}
            canConvertReject={canConvertReject}
            canAssign={canAssign}
            showHistory={isAdminOrMgr}
            agents={agents}
          />

          {/* Working notes — SHARED free-text notes retained across reassignments
              (distinct from the per-user Quick Note / sticky note above). */}
          <BuyerNotesCard buyerId={rec.id} initial={rec.remarks} canEdit={canEditFields} />

          {/* Source / import provenance — small read-only card (admin/manager),
              like the Lead view's reference cards on the right rail. */}
          {isAdminOrMgr && (
            <div data-lead-section="admin" className={CARD}>
              <div className={`${ADMIN_EYEBROW} mb-2`}>📥 Source</div>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-gray-400 dark:text-slate-500">Source</dt>
                <dd className="text-gray-700 dark:text-slate-200 break-words">{rec.source || "—"}</dd>
                {rec.sourceFile && (<><dt className="text-gray-400 dark:text-slate-500">File</dt><dd className="text-gray-700 dark:text-slate-200 break-words">{rec.sourceFile}</dd></>)}
                <dt className="text-gray-400 dark:text-slate-500">Imported</dt>
                <dd className="text-gray-700 dark:text-slate-200">{fmtDate(rec.createdAt)}</dd>
              </dl>
            </div>
          )}

          <Link href="/buyer-data" className="text-xs text-[#0b1a33] dark:text-blue-300 font-semibold inline-block">← Back to Dubai Buyer Data</Link>
        </div>
      </div>
    </>
  );
}
