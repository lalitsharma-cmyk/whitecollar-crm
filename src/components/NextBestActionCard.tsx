// Status-driven Next Best Action card (Lalit spec 2026-06).
//
// Rule: STATUS is always the primary decision-maker, not remarks.
// Certain statuses → dedicated read-only cards (no follow-up actions).
// Active statuses → contextual sales action based on lifecycle stage.

type Props = { lead: any };

type Action = {
  headline: string;
  why: string;
  kind: "call" | "whatsapp" | "meeting" | "review" | "none";
};

type StatusCard = {
  kind: "booked" | "junk" | "inactive";
  title: string;
  body: string;
  color: string;
  borderColor: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MEETING_TYPES = ["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT"];

// Statuses where the lead is permanently closed — show a read-only summary card,
// NO follow-up actions, NO re-engage suggestions, NO escalation.
const BOOKED_STATUSES = new Set([
  "booked with us", "already bought", "purchased", "sold", "booking done",
  "won", "booked", "deal closed",
]);
const JUNK_STATUSES = new Set([
  "junk", "invalid number", "wrong number", "pass away", "number changed",
  "by mistake inquiry", "spam", "invalid",
]);
const NOT_INTERESTED_STATUSES = new Set([
  "not interested", "do not call", "drop",
]);
const LOW_BUDGET_STATUSES = new Set([
  "low budget", "budget issue", "funds issue",
]);

function matchesSet(status: string | null | undefined, set: Set<string>): boolean {
  if (!status) return false;
  return set.has(status.toLowerCase().trim());
}

function getStatusCard(lead: any): StatusCard | null {
  const status: string | undefined = lead?.currentStatus ?? lead?.status;
  const cs = (status ?? "").toLowerCase().trim();

  if (BOOKED_STATUSES.has(cs) || lead?.status === "WON" || lead?.status === "BOOKING_DONE") {
    return {
      kind: "booked",
      title: "✅ Client Booked",
      body: "This client has completed a booking. The action list is in RM (relationship management) mode — focus on payment updates, upgrade opportunities, and referrals.",
      color: "text-emerald-800",
      borderColor: "border-emerald-400",
    };
  }
  if (matchesSet(cs, JUNK_STATUSES) || lead?.status === "LOST") {
    return {
      kind: "junk",
      title: "🗑 Junk / Invalid",
      body: "This lead is marked as junk or invalid. No follow-up actions are required.",
      color: "text-gray-600",
      borderColor: "border-gray-300",
    };
  }
  if (matchesSet(cs, NOT_INTERESTED_STATUSES)) {
    return {
      kind: "inactive",
      title: "🛑 Not Interested",
      body: "Client has declined. You can optionally schedule a revival check-in after 3–6 months if circumstances may have changed.",
      color: "text-red-700",
      borderColor: "border-red-300",
    };
  }
  if (matchesSet(cs, LOW_BUDGET_STATUSES)) {
    return {
      kind: "inactive",
      title: "📉 Budget Gap",
      body: "Client's current budget doesn't match available inventory. Consider suggesting alternatives or revisiting when their situation changes.",
      color: "text-amber-700",
      borderColor: "border-amber-300",
    };
  }
  return null;
}

// Whether a site visit or meeting is upcoming (scheduled in the future)
function hasUpcomingActivity(lead: any, now: number): boolean {
  const activities: any[] = Array.isArray(lead?.activities) ? lead.activities : [];
  const siteVisitMs = lead?.siteVisitDate ? new Date(lead.siteVisitDate).getTime() : null;
  const meetingMs   = lead?.meetingDate ? new Date(lead.meetingDate).getTime() : null;
  if (siteVisitMs != null && siteVisitMs >= now) return true;
  if (meetingMs != null && meetingMs >= now) return true;
  return activities.some(a => {
    if (!MEETING_TYPES.includes(a?.type)) return false;
    const t = a?.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
    return t >= now && a?.status !== "DONE";
  });
}

function computeAction(lead: any): Action {
  const callLogs: any[] = (Array.isArray(lead?.callLogs) ? lead.callLogs : [])
    .filter((c: any) => c.attributedAgentName == null); // only real calls
  const status: string = lead?.status ?? "";
  const currentStatus: string = (lead?.currentStatus ?? "").toLowerCase();
  const now = Date.now();

  const lastCall = callLogs[0];
  const siteVisitMs = lead?.siteVisitDate ? new Date(lead.siteVisitDate).getTime() : null;

  // EOI / Negotiation rules
  if (status === "NEGOTIATION" && !lead?.eoiStage) {
    return { headline: "💸 Start EOI workflow now", kind: "call",
      why: "Lead is in Negotiation but no EOI stage has been recorded. Lock in intent — collect the EOI today before momentum cools." };
  }
  if (status === "NEGOTIATION" && lead?.eoiStage) {
    const progress = [lead.eoiCollectedAt, lead.kycReceivedAt, lead.bookingFormSentAt,
      lead.bookingFormSignedAt, lead.paymentProofReceivedAt, lead.developerConfirmedAt, lead.lastTouchedAt]
      .filter(Boolean).map((d: any) => new Date(d).getTime());
    const lastProgressMs = progress.length ? Math.max(...progress) : null;
    if (!lastProgressMs || now - lastProgressMs > 3 * DAY_MS) {
      return { headline: "📞 Call to push EOI forward", kind: "call",
        why: `EOI is at "${lead.eoiStage}" but hasn't moved in 3+ days. Call now and unblock KYC, payment proof, or signature.` };
    }
  }

  // Post site-visit
  if (status === "SITE_VISIT" && siteVisitMs != null && siteVisitMs < now) {
    const activities: any[] = Array.isArray(lead?.activities) ? lead.activities : [];
    const sinceVisit = activities.filter(a => a?.createdAt && new Date(a.createdAt).getTime() > siteVisitMs!);
    if (sinceVisit.length === 0) {
      return { headline: "📞 Call for post-visit feedback", kind: "call",
        why: "The site visit has passed and nothing has been logged since. Get their reaction now — first 48 hours decide the deal." };
    }
  }

  // Upcoming site visit
  if (status === "SITE_VISIT" && siteVisitMs != null && siteVisitMs >= now) {
    return { headline: "📅 Confirm visit via WhatsApp", kind: "whatsapp",
      why: "A site visit is scheduled. Confirm time, location, and any preparation on WhatsApp so they show up." };
  }

  // Callback / follow-up scheduled today
  if (currentStatus.includes("callback") || currentStatus.includes("follow-up")) {
    return { headline: "🔁 Callback due today", kind: "call",
      why: "Client requested a callback or follow-up was scheduled. Call now while it's expected." };
  }

  // Qualified — get something on the calendar
  if (status === "QUALIFIED") {
    if (!hasUpcomingActivity(lead, now)) {
      return { headline: "🏢 Book a site visit or meeting", kind: "meeting",
        why: "Lead is qualified but nothing is on the calendar. Propose two slots today — qualified leads without a meeting go cold in a week." };
    }
  }

  // Contacted — last call missed
  if (status === "CONTACTED" && lastCall?.outcome === "NOT_PICKED") {
    return { headline: "📞 Try a different time slot", kind: "call",
      why: "Last attempt didn't connect. Call at a different time — same window tomorrow is the lowest-yield choice." };
  }

  // Contacted — last call connected
  if (status === "CONTACTED" && (lastCall?.outcome === "CONNECTED" || lastCall?.outcome === "INTERESTED")) {
    return { headline: "💬 Send WhatsApp with matching projects", kind: "whatsapp",
      why: "You spoke — follow up while it's fresh. Send 2–3 matching projects with a quick reason each fits their requirement." };
  }

  // New lead with no calls
  if (status === "NEW" && callLogs.length === 0) {
    return { headline: "📞 Make first call now (SLA timer)", kind: "call",
      why: "Fresh lead, zero calls. Speed-to-lead wins — first dial inside the SLA window multiplies connect rate." };
  }

  // Stale
  const lastTouchedMs = lead?.lastTouchedAt ? new Date(lead.lastTouchedAt).getTime() : null;
  if (!lastTouchedMs || now - lastTouchedMs > 14 * DAY_MS) {
    return { headline: "♻ Re-engage — send a project update", kind: "whatsapp",
      why: "Lead hasn't been touched in 2+ weeks. Send a project update, a price-rise notice, or a simple check-in." };
  }

  return { headline: "📋 Review notes and decide next step", kind: "review",
    why: "Skim Conversation History and Notes, then set a concrete next action (call window, WhatsApp, or meeting) before closing this tab." };
}

export default function NextBestActionCard({ lead }: Props) {
  // Check for terminal-status leads first — show a read-only card, no actions.
  const statusCard = getStatusCard(lead);
  if (statusCard) {
    if (statusCard.kind === "junk") return null; // junk: hide entirely
    return (
      <div className={`card p-4 border-l-4 ${statusCard.borderColor}`}>
        <div className={`text-sm font-semibold ${statusCard.color}`}>{statusCard.title}</div>
        <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{statusCard.body}</p>
        {statusCard.kind === "booked" && (
          <div className="mt-2.5 flex flex-wrap gap-2 text-[11px]">
            {[
              lead?.bookingDoneAt && `📅 Booked: ${new Date(lead.bookingDoneAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}`,
              lead?.eoiStage && `Stage: ${lead.eoiStage.replace(/_/g, " ")}`,
              lead?.commissionStatus && `Commission: ${lead.commissionStatus.toLowerCase()}`,
            ].filter(Boolean).map((item, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">{item}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const action = computeAction(lead);
  const kindColors = {
    call:     { border: "border-[#c9a24b]", bg: "bg-amber-50/40", icon: "📞" },
    whatsapp: { border: "border-green-400",  bg: "bg-green-50/30",  icon: "💬" },
    meeting:  { border: "border-blue-400",   bg: "bg-blue-50/30",   icon: "🏢" },
    review:   { border: "border-gray-300",   bg: "bg-gray-50/20",   icon: "📋" },
    none:     { border: "border-gray-300",   bg: "bg-gray-50/20",   icon: "•"  },
  };
  const { border, bg } = kindColors[action.kind] ?? kindColors.review;

  return (
    <div className={`card p-5 border-l-4 ${border} ${bg} shadow-sm`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">Next action</span>
        <span className="text-[10px] text-gray-400">— do this first</span>
      </div>
      <div className="text-base font-bold text-gray-900 leading-snug">{action.headline}</div>
      <p className="text-sm text-gray-700 mt-1.5 leading-relaxed">{action.why}</p>
      <div className="mt-2.5">
        <span className="text-[11px] text-gray-500">Logging a call or activity will update this recommendation.</span>
      </div>
    </div>
  );
}
