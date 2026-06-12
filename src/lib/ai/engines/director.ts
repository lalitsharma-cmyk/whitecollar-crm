import type { Engine, EngineContext } from "../types";
import { parseJsonLoose } from "../json";
import { WCR_PERSONA, leadBlock } from "../persona";

/**
 * AI Sales Director — the HEADLINE verdict. Not analysis; a decision.
 * Every field answers one of the seven questions an agent needs:
 *   what's missing · what to ask · what action · what channel ·
 *   escalate? · nurture? · drop?
 */

export type DirectorVerdict = "Escalate" | "PushToClose" | "Nurture" | "Revive" | "Drop";
export type Channel = "Call" | "WhatsApp" | "Email" | "Meeting" | "SiteVisit";
export type Urgency = "Now" | "Today" | "ThisWeek" | "Later";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface DirectorResult {
  verdict: DirectorVerdict;
  verdictReason: string;
  whatsMissing: string[];
  whatToAskNext: string[];
  nextAction: string;
  channel: Channel;
  channelReason: string;
  escalate: { should: boolean; to: string | null; why: string | null };
  urgency: Urgency;
  openingLine: string;
  confidence: Confidence;
}

// ─── Heuristic mock (genuinely useful on real lead data, zero cost) ──────────────

function parseBudgetAed(budget?: string | null): number {
  if (!budget) return 0;
  const m = budget.match(/([\d.]+)\s*M/i);
  if (m) return parseFloat(m[1]) * 1_000_000;
  const digits = budget.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

function mock(ctx: EngineContext): DirectorResult {
  const l = ctx.lead;
  const budgetAed = parseBudgetAed(l.budget);
  const hasBudget = budgetAed > 0;
  const hasAuthority = !!l.bant?.authority;
  const hasNeed = !!(l.requirement || l.bant?.need);
  const hasTimeline = !!l.bant?.timeline;
  const hasVisit = (l.siteVisitsCount ?? 0) > 0;
  const hasMeeting = (l.meetingsCount ?? 0) > 0;
  const stale = (l.lastContactDays ?? 999) > 21;
  const veryStale = (l.lastContactDays ?? 999) > 45;
  const portfolio = /portfolio|already (own|bought)|second (home|property)|investor/i.test(l.remarks ?? "");
  const isUHNI = budgetAed >= 5_000_000 || portfolio;

  // What's missing — ordered by how much it blocks the deal.
  const whatsMissing: string[] = [];
  if (!hasAuthority) whatsMissing.push("Decision-maker not confirmed (is it their call, or joint with family/partner?)");
  if (!hasTimeline) whatsMissing.push("Purchase timeframe unknown — no date to anchor urgency");
  if (!hasBudget) whatsMissing.push("Budget / ticket size not established in AED");
  if (!hasNeed) whatsMissing.push("Purpose unclear — end-use vs rental yield vs Golden Visa");
  if (!hasVisit && !hasMeeting) whatsMissing.push("No meeting or site visit yet — deal isn't anchored");

  // What to ask next — concrete questions.
  const whatToAskNext: string[] = [];
  if (!hasAuthority) whatToAskNext.push("Will this be your decision alone, or together with family/partners?");
  if (!hasTimeline) whatToAskNext.push("Are you looking to transact in the next 30–60 days, or exploring for later?");
  if (!hasBudget) whatToAskNext.push("What ticket size in AED are you comfortable deploying?");
  if (!hasNeed) whatToAskNext.push("Is this for your own use, rental income, or the Golden Visa?");
  if (whatToAskNext.length === 0) whatToAskNext.push("Shall we lock a site visit / video walkthrough this week to move ahead?");

  // Verdict.
  let verdict: DirectorVerdict;
  let verdictReason: string;
  if (isUHNI) {
    verdict = "Escalate";
    verdictReason = `High-value profile (${l.budget ?? "AED 5M+ / existing portfolio"}). Warrants senior attention before it cools.`;
  } else if (hasBudget && hasTimeline && (hasVisit || hasMeeting) && !stale) {
    verdict = "PushToClose";
    verdictReason = "Qualified and engaged — budget, timeline and a meeting/visit are in place. Press for the booking.";
  } else if (veryStale && !hasBudget && !hasTimeline) {
    verdict = "Drop";
    verdictReason = `Cold for ${l.lastContactDays} days with no budget or timeline established. Low return on further effort unless revived with substance.`;
  } else if (stale) {
    verdict = "Revive";
    verdictReason = `No contact for ${l.lastContactDays} days. Re-open with a real reason (new inventory / price revision), not "just checking in".`;
  } else {
    verdict = "Nurture";
    verdictReason = "Genuine but under-qualified. Fill the gaps below before pushing for a commitment.";
  }

  // Channel.
  let channel: Channel;
  let channelReason: string;
  if (verdict === "PushToClose" && !hasVisit) {
    channel = "SiteVisit"; channelReason = "Anchor the deal with a site visit / walkthrough — it converts far better than another call.";
  } else if (verdict === "Revive" || verdict === "Drop") {
    channel = "WhatsApp"; channelReason = "Low-friction re-open; gauges if there's still a pulse before investing call time.";
  } else if (hasMeeting || hasVisit) {
    channel = "Call"; channelReason = "Relationship is warm enough for a direct call to qualify and progress.";
  } else {
    channel = "WhatsApp"; channelReason = "Early stage — a crisp WhatsApp gets a faster reply than a cold call.";
  }

  const urgency: Urgency = isUHNI ? "Now" : verdict === "PushToClose" ? "Today" : verdict === "Drop" ? "Later" : "ThisWeek";

  const opening =
    verdict === "Revive" || verdict === "Drop"
      ? `Hi ${l.name.split(" ")[0]}, prices on a couple of Dubai projects matching your earlier interest just moved — worth a quick look?`
      : verdict === "PushToClose"
        ? `Hi ${l.name.split(" ")[0]}, I've held a strong unit in your budget — shall we lock your site visit this week before it's gone?`
        : `Hi ${l.name.split(" ")[0]}, to shortlist the right Dubai options for you, may I ask a couple of quick questions about your plan?`;

  return {
    verdict,
    verdictReason,
    whatsMissing: whatsMissing.length ? whatsMissing : ["Core qualification is complete — no critical gaps."],
    whatToAskNext: whatToAskNext.slice(0, 3),
    nextAction:
      verdict === "Escalate" ? "Brief Lalit and co-own the next conversation — do not let this sit in the agent queue."
      : verdict === "PushToClose" ? "Lock the site visit / booking conversation now; prepare the unit options and payment plan."
      : verdict === "Drop" ? "Move to nurture list; one substance-led revival attempt, then deprioritise."
      : verdict === "Revive" ? "Send a substance-led re-open (new inventory or price change), then call if they respond."
      : "Run the qualification questions below on the next touch, then re-assess.",
    channel,
    channelReason,
    escalate: {
      should: isUHNI,
      to: isUHNI ? "Lalit Sharma" : null,
      why: isUHNI ? `${l.budget ? `Budget ${l.budget}` : "Existing portfolio / investor profile"} qualifies for senior handling.` : null,
    },
    urgency,
    openingLine: opening,
    confidence: hasBudget && (hasTimeline || hasNeed) ? "MEDIUM" : "LOW",
  };
}

// ─── Real-provider prompt + parse ────────────────────────────────────────────────

const SCHEMA_HINT = `Return ONLY JSON:
{
  "verdict": "Escalate"|"PushToClose"|"Nurture"|"Revive"|"Drop",
  "verdictReason": string,
  "whatsMissing": string[],
  "whatToAskNext": string[],
  "nextAction": string,
  "channel": "Call"|"WhatsApp"|"Email"|"Meeting"|"SiteVisit",
  "channelReason": string,
  "escalate": { "should": boolean, "to": string|null, "why": string|null },
  "urgency": "Now"|"Today"|"ThisWeek"|"Later",
  "openingLine": string,
  "confidence": "HIGH"|"MEDIUM"|"LOW"
}`;

export const directorEngine: Engine<DirectorResult> = {
  key: "director",
  title: "AI Sales Director",
  description: "The headline call: missing info, next question, next action, channel, and whether to escalate / nurture / drop.",
  buildPrompt(ctx) {
    return {
      system: `${WCR_PERSONA}\n\nYou are giving the agent ONE clear directive on this lead — like a sales director glancing at it for 10 seconds and telling them exactly what to do next.\n${SCHEMA_HINT}`,
      user: `Give your directive for this lead. Be decisive — choose ONE verdict and ONE channel, and make the opening line ready to send.\n\n${leadBlock(ctx.lead)}`,
    };
  },
  mock,
  parse(raw) {
    const r = parseJsonLoose<DirectorResult>(raw);
    if (!r.verdict || !r.channel || !Array.isArray(r.whatToAskNext)) throw new Error("missing required director fields");
    return r;
  },
};
