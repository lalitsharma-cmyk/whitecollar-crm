// ────────────────────────────────────────────────────────────────────────────
// buyerFollowup.ts — the Buyer-side equivalent of the Lead follow-up completion
// gate (src/lib/followupGate.ts). Kept OUT of buyerLifecycle.ts so that module
// stays pure (no prisma import, callable from the regression harness).
//
// Lalit's policy (parity with leads): an AGENT may not mark a follow-up "complete"
// without first logging a real client touch (call / WhatsApp / voice) TODAY (IST).
// Admins/Managers bypass (data corrections). Both the buyer detail page (to disable
// the Complete button) and the action-complete endpoint (to enforce server-side)
// read this helper, so the UI and the API can never disagree.
// ────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { istDayRange } from "@/lib/datetime";
import { CONTACT_ACTIVITY_TYPES } from "@/lib/buyerLifecycle";

/** True when a contact-type BuyerActivity (call / WhatsApp / voice / attempt) was
 *  logged TODAY (IST) for this buyer. Mirrors contactActivityTodayInfo() for leads. */
export async function hasBuyerContactToday(buyerId: string): Promise<boolean> {
  const { start, end } = istDayRange();
  const row = await prisma.buyerActivity.findFirst({
    where: {
      buyerId,
      type: { in: Array.from(CONTACT_ACTIVITY_TYPES) },
      createdAt: { gte: start, lt: end },
    },
    select: { id: true },
  });
  return !!row;
}
