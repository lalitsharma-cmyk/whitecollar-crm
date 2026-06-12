import type { Engine, EngineContext } from "../types";
import { parseJsonLoose } from "../json";
import { WCR_PERSONA, leadBlock } from "../persona";

/**
 * Follow-up Engine — scores the follow-up discipline on this lead and hands the
 * agent a ready-to-send next message + cadence. Channel-aware.
 */

export interface FollowupResult {
  lastFollowupQuality: "Strong" | "Average" | "Weak" | "None";
  reason: string;
  daysSinceContact: number | null;
  overdue: boolean;
  recommendedChannel: "Call" | "WhatsApp" | "Email" | "Meeting";
  recommendedAction: string;
  draftMessage: string;
  cadence: string;
}

function mock(ctx: EngineContext): FollowupResult {
  const l = ctx.lead;
  const days = l.lastContactDays ?? null;
  const overdue = (days ?? 0) > 7;
  const first = l.name.split(" ")[0];
  const activityCount = l.recentActivities?.length ?? 0;

  const quality: FollowupResult["lastFollowupQuality"] =
    activityCount === 0 ? "None"
    : days != null && days <= 3 ? "Strong"
    : days != null && days <= 10 ? "Average"
    : "Weak";

  const channel: FollowupResult["recommendedChannel"] =
    (l.meetingsCount ?? 0) > 0 || (l.siteVisitsCount ?? 0) > 0 ? "Call" : overdue ? "WhatsApp" : "WhatsApp";

  const draft =
    quality === "None"
      ? `Hi ${first}, this is ${l.ownerName ?? "your advisor"} from White Collar Realty. You'd enquired about Dubai property — is now a good time to share 2–3 options that fit what you're looking for?`
      : overdue
        ? `Hi ${first}, circling back — a couple of projects in your range have had price/payment-plan updates this week. Want me to send the latest so you can compare?`
        : `Hi ${first}, following up on our last chat — I've shortlisted options matching your requirement. Shall I send details, or would a quick call work better?`;

  return {
    lastFollowupQuality: quality,
    reason:
      quality === "None" ? "No logged follow-up activity on this lead at all."
      : quality === "Strong" ? `Contacted ${days} day(s) ago — cadence is tight.`
      : quality === "Average" ? `Last touch ${days} day(s) ago — acceptable but slipping.`
      : `Last touch ${days ?? "?"} day(s) ago — the lead is going cold.`,
    daysSinceContact: days,
    overdue,
    recommendedChannel: channel,
    recommendedAction: overdue
      ? "Re-engage today with a substance-led message, then call if they respond."
      : "Maintain momentum — send the shortlisted options and propose a specific next step.",
    draftMessage: draft,
    cadence: overdue
      ? "Day 0 WhatsApp → Day 2 call → Day 5 value-add (new inventory) → then weekly."
      : "Touch every 3–4 days while warm; never let it exceed 7 days without contact.",
  };
}

const SCHEMA_HINT = `Return ONLY JSON: { "lastFollowupQuality":"Strong"|"Average"|"Weak"|"None", "reason":string, "daysSinceContact":number|null, "overdue":boolean, "recommendedChannel":"Call"|"WhatsApp"|"Email"|"Meeting", "recommendedAction":string, "draftMessage":string, "cadence":string }`;

export const followupEngine: Engine<FollowupResult> = {
  key: "followup",
  title: "Follow-up Engine",
  description: "Scores follow-up discipline and hands over a ready-to-send next message + cadence.",
  buildPrompt(ctx) {
    return {
      system: `${WCR_PERSONA}\n\nAssess the follow-up discipline on this lead and write the next message the agent should send. The draft must be specific and ready to paste.\n${SCHEMA_HINT}`,
      user: `Score the follow-up and draft the next touch.\n\n${leadBlock(ctx.lead)}`,
    };
  },
  mock,
  parse(raw) {
    const r = parseJsonLoose<FollowupResult>(raw);
    if (!r.lastFollowupQuality || !r.draftMessage) throw new Error("missing required followup fields");
    return r;
  },
};
