import type { Engine, EngineContext } from "../types";
import { parseJsonLoose } from "../json";
import { WCR_PERSONA, leadBlock } from "../persona";
import { firstName, parseBudgetAed } from "./util";

/**
 * Revival Engine — for inactive leads. Per Section 11: NEVER "just checking in".
 * Always re-open with substance (market / inventory / payment-plan / price /
 * new opportunity) and hand over a ready-to-send message.
 */

export type RevivalAngle = "MarketUpdate" | "InventoryUpdate" | "PaymentPlanUpdate" | "PriceRevision" | "NewOpportunity";

export interface RevivalResult {
  isWorthReviving: boolean;
  whyInactive: string;
  daysSinceContact: number | null;
  angle: RevivalAngle;
  substanceHook: string;
  channel: "WhatsApp" | "Call" | "Email";
  draftMessage: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

function mock(ctx: EngineContext): RevivalResult {
  const l = ctx.lead;
  const days = l.lastContactDays ?? null;
  const fn = firstName(l.name);
  const budget = parseBudgetAed(l.budget ?? l.bant?.budget);
  const wasQualified = budget > 0 || !!l.bant?.need;
  const r = l.remarks ?? "";

  // Worth reviving if it was ever a real lead and it's gone quiet (not ancient-and-empty).
  const isWorthReviving = wasQualified && (days == null || days >= 14) && (days == null || days <= 120);

  const angle: RevivalAngle =
    /price|expensive|budget|costly|high/i.test(r) ? "PriceRevision" :
    /payment|emi|installment|plan/i.test(r) ? "PaymentPlanUpdate" :
    /which project|inventory|options|availab/i.test(r) ? "InventoryUpdate" :
    budget >= 5_000_000 ? "NewOpportunity" : "MarketUpdate";

  const hook: Record<RevivalAngle, string> = {
    PriceRevision: "A project in their range just announced a revised price / limited launch pricing.",
    PaymentPlanUpdate: "A developer extended a 1%-monthly / post-handover payment plan that fits their concern.",
    InventoryUpdate: "Fresh inventory matching their requirement just released — limited units.",
    NewOpportunity: "An off-market / pre-launch opportunity surfaced that suits their portfolio.",
    MarketUpdate: "A relevant Dubai market shift (yields / handover momentum) gives a concrete reason to reconnect.",
  };

  const draft: Record<RevivalAngle, string> = {
    PriceRevision: `Hi ${fn}, the project you liked just revised pricing for a limited window — worth a 5-min look before it closes?`,
    PaymentPlanUpdate: `Hi ${fn}, remember the payment-plan concern? A developer just opened a 1%-monthly plan that changes the math — want the breakdown?`,
    InventoryUpdate: `Hi ${fn}, new units just released matching what you wanted (${l.requirement ?? "your requirement"}). They move fast — shall I hold options for you?`,
    NewOpportunity: `Hi ${fn}, a pre-launch opportunity came up that fits your portfolio strategy. Limited allocation — can I send you the details?`,
    MarketUpdate: `Hi ${fn}, quick Dubai update relevant to your plan — yields and handover timelines just shifted in your favour. Want a 2-line summary?`,
  };

  return {
    isWorthReviving,
    whyInactive:
      days == null ? "No recent contact logged — relationship has gone quiet."
      : days > 60 ? `Dormant for ${days} days — likely deprioritised after early interest with no compelling reason to act.`
      : `Quiet for ${days} days — momentum lost, probably after the last touch went unanswered.`,
    daysSinceContact: days,
    angle,
    substanceHook: hook[angle],
    channel: "WhatsApp",
    draftMessage: isWorthReviving ? draft[angle] : `Low revival value — only re-engage if genuinely new inventory appears; otherwise leave on the nurture list.`,
    confidence: wasQualified ? "MEDIUM" : "LOW",
  };
}

const SCHEMA_HINT = `Return ONLY JSON: { "isWorthReviving":boolean, "whyInactive":string, "daysSinceContact":number|null, "angle":"MarketUpdate"|"InventoryUpdate"|"PaymentPlanUpdate"|"PriceRevision"|"NewOpportunity", "substanceHook":string, "channel":"WhatsApp"|"Call"|"Email", "draftMessage":string, "confidence":"HIGH"|"MEDIUM"|"LOW" }`;

export const revivalEngine: Engine<RevivalResult> = {
  key: "revival",
  title: "Revival",
  description: "Re-opens inactive leads with substance (never 'just checking in') and a ready-to-send message.",
  buildPrompt(ctx) {
    return {
      system: `${WCR_PERSONA}\n\nThis lead may be inactive. Decide if it's worth reviving, why it went quiet, and re-open with SUBSTANCE — never "just checking in". Provide a ready-to-send message.\n${SCHEMA_HINT}`,
      user: `Build the revival play for this lead.\n\n${leadBlock(ctx.lead)}`,
    };
  },
  mock,
  parse(raw) {
    const r = parseJsonLoose<RevivalResult>(raw);
    if (typeof r.isWorthReviving !== "boolean" || !r.draftMessage) throw new Error("missing required revival fields");
    return r;
  },
};
