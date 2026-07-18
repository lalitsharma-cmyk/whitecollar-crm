import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { CALL_OUTCOME_INITIATED } from "@/lib/callOutcome";
import { loadOwnedLead } from "@/lib/leadScope";
import { startCall } from "@/lib/callLogService";

// ── CLICK-TO-CALL FROM THE LEAD DETAIL ("Call" in LeadActionsClient) ─────────
//
// HISTORY / WHY THIS ROUTE STILL EXISTS
// This was the ONLY dial affordance in the CRM that recorded anything — but it
// wrote an Activity, NOT a CallLog, so its ~1,408 dials per 30 days were
// invisible to Call Logs, reports and the call engine (Lalit P0, 2026-07-18).
//
// It now does BOTH:
//   1. startCall()  → ONE CallLog at outcome=INITIATED — the same row the dial
//      beacon (/api/calls/dial) writes from every other Call button. When the
//      agent then logs the call, resolveOrCreateCall() transitions THIS row
//      instead of creating a second one. One dial = one row.
//   2. The original Activity write — KEPT ON PURPOSE (see below).
//
// WHY THE ACTIVITY WRITE IS KEPT
// Removing it would be a live regression, not a cleanup:
//   • It is the "📞 Call initiated" entry on the lead's Smart Timeline. This is
//     the only dial affordance that has ever produced one; deleting it would
//     silently empty a timeline signal agents rely on, and orphan the ~1,408
//     historical rows' forward continuity.
//   • ActivityType.CALL is a CONTACT_ACTIVITY_TYPE in src/lib/followupGate.ts,
//     so this row currently participates in the follow-up completion gate.
//     Dropping it would CHANGE follow-up behaviour for the lead detail; that is
//     a policy decision for Lalit, not a side effect of a logging fix.
// Conversely, the new /api/calls/dial beacon deliberately writes NO Activity —
// if it did, tapping Call from any list view would satisfy the completion gate
// and let a mere dial close a follow-up CRM-wide. Timeline semantics therefore
// stay exactly as they are today: unchanged here, unchanged everywhere else.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;

  // 1. The CENTRAL record of the dial — same service every other Call uses.
  //    Never throws; a null id just means the row couldn't be written.
  const { callLogId } = await startCall({
    leadId: id,
    userId: me.id,
    phoneNumber: lead.phone,
  });

  // 2. The timeline entry (unchanged behaviour — see the note above).
  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.CALL,
      status: ActivityStatus.DONE,
      title: "📞 Call initiated",
      description: "Agent tapped Call button",
      // A tap is a dial with no result yet — stamp a non-null "Initiated" outcome
      // so click-to-call rows never erode the CALL-outcome integrity invariant.
      // The real outcome lands on a separate Activity when the agent logs the call.
      outcome: CALL_OUTCOME_INITIATED,
    },
  });
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } }).catch(() => {});
  return NextResponse.json({ ok: true, callLogId });
}
