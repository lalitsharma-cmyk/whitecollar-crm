// Specialised activity logger — handles:
//   EXPO_MEETING        (Dubai team: developer expo in IN city)
//   HOME_VISIT          (India team: client's home + distance reimbursement)
//   DUBAI_SITE_VISIT    (Dubai team: site visit with developer coordination)
//   SITE_VISIT          (India team: also captures distance for reimbursement)
//
// Reads admin's per-km rate from Setting("travel.perKmInr") and auto-computes
// reimbursementAmount on save.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { isRevivalOrigin, REVIVAL_CALLING_ONLY_ERROR } from "@/lib/moduleSource";
import { getTravelRatePerKmInr } from "@/lib/settings";

type AdvType = "EXPO_MEETING" | "HOME_VISIT" | "DUBAI_SITE_VISIT";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;
  // Revival Engine is calling-only (Lalit 2026-07-16): every type this route
  // creates (EXPO_MEETING / HOME_VISIT / DUBAI_SITE_VISIT→SITE_VISIT) is an
  // active-pipeline kind — blocked on cold/revival-origin leads.
  if (isRevivalOrigin(lead.leadOrigin)) {
    return NextResponse.json({ error: REVIVAL_CALLING_ONLY_ERROR }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));

  const type = String(body.type ?? "") as AdvType;
  if (!["EXPO_MEETING", "HOME_VISIT", "DUBAI_SITE_VISIT"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  const whenRaw = String(body.when ?? "").trim();
  const when = whenRaw ? new Date(whenRaw) : new Date();
  if (isNaN(when.getTime())) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  const isFuture = when.getTime() > Date.now();

  // 7-day forward cap for AGENT role (matches /meeting + /visit policy).
  // EXPO_MEETING + HOME_VISIT + DUBAI_SITE_VISIT all fall under the same
  // "no planning more than a week out" rule. Managers/Admins bypass.
  const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
  if (me.role === "AGENT" && when.getTime() > Date.now() + SEVEN_DAYS_MS) {
    return NextResponse.json({
      error: "Meetings can only be scheduled up to 7 days in advance. For longer-term planning, ask your manager.",
    }, { status: 400 });
  }
  const notes = String(body.notes ?? "").trim();

  // Distance-based reimbursement (HOME_VISIT or India SITE_VISIT)
  const distanceKm = body.distanceKm != null ? Number(body.distanceKm) : null;
  let reimbursementAmount: number | null = null;
  if (distanceKm && distanceKm > 0) {
    const rate = await getTravelRatePerKmInr();
    reimbursementAmount = Math.round(distanceKm * rate);
  }

  // Map our payload type → Prisma ActivityType. DUBAI_SITE_VISIT is stored as
  // SITE_VISIT in the activity table; the Dubai-specific fields disambiguate it.
  const dbType: ActivityType =
    type === "EXPO_MEETING" ? ActivityType.EXPO_MEETING :
    type === "HOME_VISIT" ? ActivityType.HOME_VISIT :
    ActivityType.SITE_VISIT;

  const title =
    type === "EXPO_MEETING" ? `🎪 Expo · ${body.expoDeveloper ?? "—"} · ${body.expoCity ?? "—"}` :
    type === "HOME_VISIT"   ? `🏠 Home visit${distanceKm ? ` · ${distanceKm}km · ₹${reimbursementAmount}` : ""}` :
                              `🚗 Site visit${distanceKm ? ` · ${distanceKm}km · ₹${reimbursementAmount}` : ""}`;

  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      attendedByUserId: me.id,
      type: dbType,
      status: isFuture ? ActivityStatus.PLANNED : ActivityStatus.DONE,
      title,
      description: notes || undefined,
      scheduledAt: isFuture ? when : undefined,
      completedAt: !isFuture ? when : undefined,
      // Expo fields
      expoCity: body.expoCity || undefined,
      expoHotel: body.expoHotel || undefined,
      expoDeveloper: body.expoDeveloper || undefined,
      expoDeveloperContact: body.expoDeveloperContact || undefined,
      expoAgentAttended: body.expoAgentAttended === true,
      // Dubai site-visit fields
      dubaiDeveloperSalesperson: body.dubaiDeveloperSalesperson || undefined,
      cabScheduled: body.cabScheduled === true,
      decisionInOffice: body.decisionInOffice === true,
      // India travel
      distanceKm: distanceKm ?? undefined,
      reimbursementAmount: reimbursementAmount ?? undefined,
    },
  });

  await prisma.lead.update({
    where: { id },
    data: {
      lastTouchedAt: new Date(),
      ...(type === "EXPO_MEETING" || type === "DUBAI_SITE_VISIT" || type === "HOME_VISIT"
        ? { siteVisitDate: when }
        : {}),
    },
  });

  return NextResponse.json({ ok: true, reimbursementAmount });
}
