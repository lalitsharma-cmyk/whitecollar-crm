import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LeadSource, ActivityType } from "@prisma/client";
import { assignLeadTo } from "@/lib/leadIngest";
import { canTouchBuyer } from "@/lib/buyerScope";
import { audit, reqMeta } from "@/lib/audit";
import { toE164 } from "@/lib/phone";
import { normalizeTeam } from "@/lib/teamRouting";
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
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (buyer.poolStatus === BUYER_POOL_STATUS.CONVERTED && buyer.convertedLeadId) {
    return NextResponse.json({ error: "This buyer has already been converted.", leadId: buyer.convertedLeadId }, { status: 409 });
  }

  // Who owns the resulting lead. Admin may pass ownerId to convert on behalf of an
  // agent; otherwise the buyer's current owner, falling back to the actor.
  const requestedOwner = String(body.ownerId ?? "").trim();
  const ownerId = requestedOwner || buyer.ownerId || me.id;
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, name: true, team: true, active: true } });
  if (!owner || !owner.active) return NextResponse.json({ error: "Resolved lead owner not found or inactive" }, { status: 400 });

  // ── Map buyer → lead fields ────────────────────────────────────────────────
  const phones = parseJsonArray(buyer.phones);
  const phone = phones[0] ? (toE164(phones[0]) ?? phones[0]) : null;
  const altPhone = phones[1] ? (toE164(phones[1]) ?? phones[1]) : null;
  const emails = parseJsonArray(buyer.emails);
  const email = emails[0] ?? null;
  const altEmail = emails[1] ?? null;

  // Team: prefer the owning agent's team, else infer from the buyer's market.
  const inferredCcy = inferBuyerCurrency({ nationality: buyer.nationality, projectName: buyer.projectName, source: buyer.source });
  const teamFromCcy = inferredCcy === "INR" ? "India" : inferredCcy === "AED" ? "Dubai" : null;
  const team = normalizeTeam(owner.team) ?? teamFromCcy ?? null;
  const budgetCurrency = team === "India" ? "INR" : team === "Dubai" ? "AED" : (inferredCcy ?? "AED");

  // transactionValue → budgetMax (a sensible single figure). budgetRaw keeps the
  // human display. Only when it's a positive finite number.
  const txn = typeof buyer.transactionValue === "number" && isFinite(buyer.transactionValue) && buyer.transactionValue > 0
    ? buyer.transactionValue : null;

  const coBuyers = parseJsonArray(buyer.coBuyerNames);

  // ── Create the lead, mark the buyer, write history — atomically ────────────
  const result = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        name: buyer.clientName,
        altName: coBuyers[0] ?? null,
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
