import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer } from "@/lib/buyerScope";
import { BUYER_POOL_STATUS, BUYER_ACTIVITY_TYPE } from "@/lib/buyerLifecycle";

/**
 * POST /api/buyer-data/[id]/action-snooze
 *
 * Buyer-side twin of /api/leads/[id]/action-snooze — powers the SAME
 * LeadFollowupActions "Snooze" picker on the Buyer detail view. Pushes the buyer
 * follow-up out to a chosen future instant so it leaves Today/Overdue but stays in
 * the agent's queue.
 *
 * Body (one of):
 *   { at?: string }   – explicit ISO instant (the picker sends
 *                       "YYYY-MM-DDTHH:mm:00+05:30" — exact IST wall-clock)
 *   { hours?: number } / { days?: number } – presets (default +24h)
 *
 * Additive only — writes BuyerRecord.followupDate + a "SNOOZED" BuyerActivity.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isAdmin = me.role === "ADMIN";
  const canLog = isAdmin || (buyer.ownerId === me.id && buyer.poolStatus === BUYER_POOL_STATUS.ASSIGNED);
  if (!canLog) return NextResponse.json({ error: "You can only snooze a follow-up on an assigned buyer." }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  let newFollowup: Date;
  let label: string;
  const atRaw = typeof body.at === "string" ? body.at.trim() : "";
  const atMs = atRaw ? Date.parse(atRaw) : NaN;
  if (atRaw && !isNaN(atMs)) {
    if (atMs <= Date.now()) return NextResponse.json({ error: "Pick a future date/time." }, { status: 400 });
    newFollowup = new Date(atMs);
    label = newFollowup.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  } else {
    const hoursRaw = Number(body.hours ?? 0);
    const daysRaw = Number(body.days ?? 0);
    const hours = isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 24 * 14) : 0;
    const days = isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 14) : 0;
    const totalMs = hours > 0 ? hours * 3600 * 1000 : (days > 0 ? days * 24 * 3600 * 1000 : 24 * 3600 * 1000);
    newFollowup = new Date(Date.now() + totalMs);
    label = hours > 0
      ? (hours === 1 ? "1 hour" : hours < 24 ? `${hours} hours` : `${Math.round(hours / 24)} day${hours / 24 === 1 ? "" : "s"}`)
      : (days === 1 ? "1 day" : `${days} days`);
  }

  const whenIST = newFollowup.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  await prisma.$transaction([
    prisma.buyerRecord.update({ where: { id }, data: { followupDate: newFollowup } }),
    prisma.buyerActivity.create({
      data: {
        buyerId: id,
        userId: me.id,
        type: BUYER_ACTIVITY_TYPE.SNOOZED,
        description: `⏸ Snoozed ${label} by ${me.name} — next follow-up at ${whenIST} IST`,
      },
    }),
  ]);

  await audit({
    userId: me.id, action: "buyer.action-snooze", entity: "BuyerRecord", entityId: id,
    meta: { followupDate: newFollowup.toISOString(), label }, request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, leadName: buyer.clientName, followupDate: newFollowup.toISOString(), snoozedFor: label });
}
