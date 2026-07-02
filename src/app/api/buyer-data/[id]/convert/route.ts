import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LeadSource, ActivityType, ActivityStatus } from "@prisma/client";
import { notify } from "@/lib/notify";
import { assignLeadTo } from "@/lib/leadIngest";
import { canTouchBuyer, isBuyerAssignableForMarket, marketOfBuyer } from "@/lib/buyerScope";
import { audit, reqMeta } from "@/lib/audit";
import { toE164 } from "@/lib/phone";
import { normalizeNameList } from "@/lib/nameFormat";
import { normalizeTeam } from "@/lib/teamRouting";
import { resolveMarket } from "@/lib/market";
import {
  parseJsonArray,
  inferBuyerCurrency,
} from "@/lib/buyerIntelligence";
import {
  logBuyerActivity,
  openStint,
  BUYER_POOL_STATUS,
  BUYER_ACTIVITY_TYPE,
} from "@/lib/buyerLifecycle";

// ── Convert a buyer into a real Lead ─────────────────────────────────────────
// Assigned AGENT (their own ASSIGNED buyer) OR admin. Creates a Lead from the
// buyer (clientName→name, phones→phone/altPhone, emails→email/altEmail,
// projectName→sourceDetail, nationality→categorization, transactionValue→budget),
// owned by the converting agent, tagged "Converted From Buyer Data" + an Activity
// note "Converted from Buyer Data by <agent>". Marks the buyer CONVERTED
// (convertedLeadId/At/ById), closes the open stint, logs BuyerActivity CONVERTED.
// The lead is created via prisma then assigned with assignLeadTo() so it gets a
// proper Assignment-history row + owner notification. The new lead appears in
// Leads + Master Data like any normal lead.
//
// Body (all optional overrides): { ownerId?: string } — admin may convert ON
// BEHALF of a specific agent; otherwise the buyer's current owner (or the admin)
// becomes the lead owner.
const CONVERT_TAG = "Converted From Buyer Data";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const buyer = await prisma.buyerRecord.findUnique({ where: { id } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Already converted → 409. Guard on status ALONE: a CONVERTED buyer must never be
  // re-converted even if its lead link is somehow null (which would mint a duplicate).
  if (buyer.poolStatus === BUYER_POOL_STATUS.CONVERTED) {
    return NextResponse.json({ error: "This buyer has already been converted.", leadId: buyer.convertedLeadId ?? undefined }, { status: 409 });
  }

  // Convert authority: ADMIN any; else ONLY the owning agent of an ASSIGNED buyer
  // (mirrors the detail page's canConvertReject — bare canTouchBuyer would also let
  // a MANAGER convert a subordinate's buyer, wider than the UI ever offers).
  const isAdmin = me.role === "ADMIN";
  if (!isAdmin && !(buyer.ownerId === me.id && buyer.poolStatus === BUYER_POOL_STATUS.ASSIGNED)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Who owns the resulting lead. For an ASSIGNED buyer it's the owning agent (admin
  // may override with body.ownerId). A buyer NOT currently assigned (admin pool /
  // returned) has no owner to convert under → the admin must name the agent, else
  // the lead would silently land on the admin with no team.
  const requestedOwner = String(body.ownerId ?? "").trim();
  if (buyer.poolStatus !== BUYER_POOL_STATUS.ASSIGNED && !requestedOwner) {
    return NextResponse.json({ error: "Assign this buyer to an agent before converting, or pass an ownerId." }, { status: 400 });
  }
  const ownerId = requestedOwner || buyer.ownerId || me.id;
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, name: true, team: true, active: true, role: true } });
  if (!owner || !owner.active) return NextResponse.json({ error: "Resolved lead owner not found or inactive" }, { status: 400 });
  // When an admin converts ON BEHALF of a specific agent, that agent must belong to the
  // BUYER'S market team (or be an admin) — an India buyer can't be converted onto a Dubai
  // agent, or vice-versa. The buyer's own current owner already passed this at assignment.
  const bMarket = marketOfBuyer(buyer);
  if (requestedOwner && !isBuyerAssignableForMarket(owner, bMarket)) {
    return NextResponse.json({ error: `${bMarket} buyers can only be converted on behalf of ${bMarket}-team users or admins.` }, { status: 403 });
  }

  // ── Map buyer → lead fields ────────────────────────────────────────────────
  const phones = parseJsonArray(buyer.phones);
  const phone = phones[0] ? (toE164(phones[0]) ?? phones[0]) : null;
  const altPhone = phones[1] ? (toE164(phones[1]) ?? phones[1]) : null;
  const emails = parseJsonArray(buyer.emails);
  const email = emails[0] ?? null;
  const altEmail = emails[1] ?? null;

  // Team / currency: the owning agent's team wins; else the buyer's MARKET is the
  // authoritative signal (this is the Dubai module — market is "Dubai"), NOT the
  // nationality heuristic (an Indian-national Dubai investor must stay Dubai/AED).
  const marketTeam = buyer.market === "Dubai" ? "Dubai" : buyer.market === "India" ? "India" : null;
  const inferredCcy = inferBuyerCurrency({ nationality: buyer.nationality, projectName: buyer.projectName, source: buyer.source, market: buyer.market });
  const team = normalizeTeam(owner.team) ?? marketTeam ?? (inferredCcy === "INR" ? "India" : inferredCcy === "AED" ? "Dubai" : null);
  const budgetCurrency = team === "India" ? "INR" : team === "Dubai" ? "AED" : (buyer.market === "Dubai" ? "AED" : inferredCcy ?? "AED");

  // transactionValue → budgetMax (a sensible single figure). budgetRaw keeps the
  // human display. Only when it's a positive finite number.
  const txn = typeof buyer.transactionValue === "number" && isFinite(buyer.transactionValue) && buyer.transactionValue > 0
    ? buyer.transactionValue : null;

  const coBuyers = parseJsonArray(buyer.coBuyerNames);

  // ── Create the lead, mark the buyer, write history — atomically ────────────
  const result = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        // Proper-Case the names as they flow buyer → lead (covers buyers imported
        // before name normalisation shipped; this create bypasses ingestLead).
        name: normalizeNameList(buyer.clientName),
        altName: normalizeNameList(coBuyers[0] ?? null),
        phone,
        altPhone,
        email,
        altEmail,
        // Lead has no `nationality` column — fold it into the free-text client
        // context + the categorization signal so the info isn't lost.
        whoIsClient: buyer.nationality ? `Nationality: ${buyer.nationality}` : null,
        source: LeadSource.OTHER,
        sourceRaw: "Buyer Data",
        sourceDetail: buyer.projectName ?? null,
        propertyType: buyer.propertyType ?? null,
        configuration: buyer.configuration ?? null,
        budgetMax: txn,
        budgetCurrency,
        budgetRaw: txn != null ? String(buyer.transactionValue) : null,
        categorization: "Investor",
        forwardedTeam: team,
        // Market (India/UAE) must be set wherever a team is written so the
        // lead-market-segregation invariant can never drift — this create
        // bypasses ingestLead, which is the only other path that sets it.
        market: resolveMarket({ forwardedTeam: team, budgetCurrency }),
        routingMethod: "manual",
        routingSource: "buyer_data_conversion",
        routingReason: `Converted from Buyer Data by ${me.name}`,
        leadOrigin: "ACTIVE_LEAD",
        currentStatus: "Fresh Lead",
        tags: CONVERT_TAG,
        remarks: buyer.remarks ?? null,
        rawRemarks: buyer.remarks ?? null,
      },
    });

    // ── Carry the buyer's conversation timeline into the Lead (ZERO data loss) ──
    // Buyer calls/notes/WhatsApp/voice/attempts + lifecycle live in BuyerActivity;
    // without this they'd be orphaned on the converted buyer and the new Lead would
    // open with a blank history. Copy every BuyerActivity as a Lead timeline Activity
    // (preserving the original actor + timestamp), and re-link any telephony CallLogs
    // (with their recordings) to the Lead so its call history is complete.
    const buyerActs = await tx.buyerActivity.findMany({ where: { buyerId: buyer.id }, orderBy: { createdAt: "asc" } });
    if (buyerActs.length > 0) {
      await tx.activity.createMany({
        data: buyerActs.map((a) => ({
          leadId: lead.id,
          userId: a.userId,
          type: a.type === "CALL" ? ActivityType.CALL : ActivityType.NOTE,
          status: ActivityStatus.DONE,
          title: `[from Buyer Data] ${a.type.replaceAll("_", " ").toLowerCase()}`,
          description: a.description ?? null,
          completedAt: a.createdAt,
          createdAt: a.createdAt,
        })),
      });
    }
    // Re-link telephony calls (+ recordings) from the buyer to the new lead. No-op
    // until AS Phone is live; keeps recordings playable in the Lead call history.
    await tx.callLog.updateMany({ where: { buyerId: buyer.id, leadId: null }, data: { leadId: lead.id } });

    // Mark the buyer CONVERTED + link the lead. Close the open stint (terminal —
    // not a return-to-pool; conversion is a successful exit, returnReason stays null).
    const open = await openStint(tx, buyer.id);
    if (open) {
      await tx.buyerAssignment.update({ where: { id: open.id }, data: { returnedAt: new Date() } });
    }
    await tx.buyerRecord.update({
      where: { id: buyer.id },
      data: {
        poolStatus: BUYER_POOL_STATUS.CONVERTED,
        convertedLeadId: lead.id,
        convertedAt: new Date(),
        convertedById: me.id,
      },
    });

    // Buyer-side timeline row.
    await logBuyerActivity(tx, buyer.id, me.id, BUYER_ACTIVITY_TYPE.CONVERTED, `Converted to lead by ${me.name} (lead ${lead.id})`);

    // Lead-side audit: a NOTE remark + a COLD_TO_LEAD promotion marker, both
    // attributed to the converting agent so Smart Timeline shows date+name+body.
    await tx.activity.create({
      data: {
        leadId: lead.id,
        userId: me.id,
        type: ActivityType.NOTE,
        status: "DONE",
        title: "Converted from Buyer Data",
        description: `Converted from Buyer Data by ${me.name}.${buyer.projectName ? ` Property: ${buyer.projectName}.` : ""}${buyer.unitNumber ? ` Unit ${buyer.unitNumber}.` : ""}`,
        completedAt: new Date(),
      },
    });

    return { leadId: lead.id };
  });

  // Assign with the canonical helper AFTER the lead exists — gives the lead a
  // proper Assignment-history row, SLA clock, and owner notification. (Runs
  // outside the tx because it sends a notification side-effect.)
  await assignLeadTo(result.leadId, ownerId, `Converted from Buyer Data by ${me.name}`);

  // Buyer-lifecycle notification (its OWN kind, distinct from the LEAD_ASSIGNED
  // that assignLeadTo just fired for the new lead). Tells the owner a buyer they
  // were working became a real Lead. INFO severity — not a hot-lead alert.
  await notify({
    userId: ownerId,
    kind: "BUYER_CONVERTED",
    severity: "INFO",
    title: `✅ Buyer converted to lead: ${buyer.clientName}`,
    body: `${me.name} converted this buyer into a Lead. It's now in Leads / Master Data.`,
    linkUrl: `/leads/${result.leadId}`,
  }).catch(() => null);

  await audit({
    userId: me.id,
    action: "buyer.convert",
    entity: "BuyerRecord",
    entityId: buyer.id,
    meta: { leadId: result.leadId, ownerId },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, leadId: result.leadId, ownerId });
}
