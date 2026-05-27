// Rules-based "Next Best Action" recommendation card.
//
// Pure synchronous computation over fields already loaded by the lead detail
// page — no AI, no async, server-component friendly. The card always renders
// (worst case it falls through to the "Review notes" default) because agents
// should ALWAYS see one clear action above the fold.
//
// Lead is typed loosely (`any`) for the same reason as BuyingSignalsCard: the
// page query uses a wide Prisma `include` whose generated type would force
// every caller into a specific shape. All field access is defensive.

type Props = { lead: any };

type Action = {
  headline: string;
  why: string;
};

const MEETING_TYPES = ["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT"];
const DAY_MS = 24 * 60 * 60 * 1000;

function computeAction(lead: any): Action {
  const callLogs: any[] = Array.isArray(lead?.callLogs) ? lead.callLogs : [];
  const activities: any[] = Array.isArray(lead?.activities) ? lead.activities : [];
  const status: string | undefined = lead?.status;
  const now = Date.now();

  // Helper — most recent call (callLogs already ordered by startedAt desc on the page).
  const lastCall = callLogs[0];

  // Helper — site visit timing
  const siteVisitMs = lead?.siteVisitDate ? new Date(lead.siteVisitDate).getTime() : null;

  // Rule 1 — Negotiation without EOI started
  if (status === "NEGOTIATION" && !lead?.eoiStage) {
    return {
      headline: "💸 Start EOI workflow now",
      why: "Lead is in Negotiation but no EOI stage has been recorded. Lock in intent — collect the EOI today before momentum cools.",
    };
  }

  // Rule 2 — Negotiation, EOI exists but stalled (no progress in 3 days).
  // "Progress" = lastTouchedAt advanced or the EOI-related dates were updated.
  if (status === "NEGOTIATION" && lead?.eoiStage) {
    const candidates = [
      lead?.eoiCollectedAt,
      lead?.kycReceivedAt,
      lead?.bookingFormSentAt,
      lead?.bookingFormSignedAt,
      lead?.paymentProofReceivedAt,
      lead?.developerConfirmedAt,
      lead?.lastTouchedAt,
    ]
      .filter(Boolean)
      .map((d: any) => new Date(d).getTime());
    const lastProgressMs = candidates.length ? Math.max(...candidates) : null;
    if (lastProgressMs == null || now - lastProgressMs > 3 * DAY_MS) {
      return {
        headline: "📞 Call to push the EOI forward",
        why: `EOI is at "${lead.eoiStage}" but hasn't moved in 3+ days. Get on the phone, unblock whatever's stuck (KYC, payment proof, signature) and set a same-day next step.`,
      };
    }
  }

  // Rule 3 — Site visit date has passed, no activity since the visit.
  if (status === "SITE_VISIT" && siteVisitMs != null && siteVisitMs < now) {
    const sinceVisit = activities.filter((a) => {
      const t = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      return t > siteVisitMs;
    });
    if (sinceVisit.length === 0) {
      return {
        headline: "📞 Call for post-visit feedback",
        why: "The site visit is in the past and nothing has been logged since. Get their unfiltered reaction now — first 48 hours decide the deal.",
      };
    }
  }

  // Rule 4 — Future site visit on the calendar
  if (status === "SITE_VISIT" && siteVisitMs != null && siteVisitMs >= now) {
    return {
      headline: "📅 Confirm site visit slot via WhatsApp",
      why: "A site visit is scheduled. Confirm time, location, and parking on WhatsApp so they show up — no-shows kill the week.",
    };
  }

  // Rule 5 — Qualified but nothing on the calendar
  if (status === "QUALIFIED") {
    const meetingMs = lead?.meetingDate ? new Date(lead.meetingDate).getTime() : null;
    const upcomingMeeting =
      (meetingMs != null && meetingMs >= now) ||
      (siteVisitMs != null && siteVisitMs >= now);
    const upcomingMeetingActivity = activities.some((a) => {
      if (!MEETING_TYPES.includes(a?.type)) return false;
      const t = a?.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
      return t >= now && a?.status !== "DONE";
    });
    if (!upcomingMeeting && !upcomingMeetingActivity) {
      return {
        headline: "🏢 Book a site visit / office meeting",
        why: "Lead is qualified but nothing is on the calendar. Qualified leads without a meeting go cold inside a week — propose two slots today.",
      };
    }
  }

  // Rule 6 — Contacted, last call was not picked
  if (status === "CONTACTED" && lastCall?.outcome === "NOT_PICKED") {
    return {
      headline: "📞 Try calling at a different time (use connect-rate-by-hour)",
      why: "Last attempt didn't connect. Check the team's connect-rate-by-hour heatmap and dial in a different window — same time tomorrow is the lowest-yield choice.",
    };
  }

  // Rule 7 — Contacted, last call connected
  if (status === "CONTACTED" && lastCall?.outcome === "CONNECTED") {
    return {
      headline: "💬 Send WhatsApp with project options",
      why: "You spoke with them — follow up while it's fresh. Send 2-3 matching projects on WhatsApp with photos, price, and a one-line reason each fits.",
    };
  }

  // Rule 8 — Brand new, no calls yet
  if (status === "NEW" && callLogs.length === 0) {
    return {
      headline: "📞 Make first call now (SLA timer)",
      why: "Fresh lead, zero calls. Speed-to-lead wins — first dial inside the SLA window 4x's the connect rate vs same-day-later attempts.",
    };
  }

  // Rule 9 — Stale: no touch in 14+ days
  const lastTouchedMs = lead?.lastTouchedAt
    ? new Date(lead.lastTouchedAt).getTime()
    : null;
  if (lastTouchedMs == null || now - lastTouchedMs > 14 * DAY_MS) {
    return {
      headline: "♻ Re-engage: send a project update or check-in WhatsApp",
      why: "Lead hasn't been touched in 2+ weeks. Send a project update, a price-rise notice, or a simple check-in — give them a reason to reply.",
    };
  }

  // Rule 10 — Default
  return {
    headline: "📋 Review notes and decide next step",
    why: "No single rule fired. Skim Call History and Notes, then set a concrete next step (call window, WhatsApp, or meeting) before closing this lead.",
  };
}

export default function NextBestActionCard({ lead }: Props) {
  const action = computeAction(lead);

  return (
    <div className="card p-5 border-l-4 border-[#c9a24b] bg-amber-50/40 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold tracking-widest text-[#8a6a1f] uppercase">
          Next best action
        </span>
        <span className="text-[10px] text-gray-500">— do this first</span>
      </div>
      <div className="text-lg font-bold text-gray-900 leading-snug">
        {action.headline}
      </div>
      <p className="text-sm text-gray-700 mt-1.5 leading-relaxed">
        {action.why}
      </p>
      <div className="mt-3">
        <button
          type="button"
          className="btn btn-primary text-xs"
          aria-label="Mark this next best action as done"
        >
          ✅ Mark done
        </button>
        <span className="text-[11px] text-gray-500 ml-2">
          Logging a call or meeting below will count as completion.
        </span>
      </div>
    </div>
  );
}
