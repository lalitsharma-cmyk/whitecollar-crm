import type { Engine, EngineContext } from "../types";
import { parseJsonLoose } from "../json";
import { WCR_PERSONA, leadBlock } from "../persona";
import { parseBudgetAed } from "./util";

/**
 * Escalation Engine — detects the signals that mean "this is too important to
 * leave in the agent queue" and tells the agent exactly who to escalate to and
 * what to brief. Per Section 11.
 */

export type EscalationUrgency = "Immediate" | "Today" | "ThisWeek" | "None";

export interface EscalationResult {
  shouldEscalate: boolean;
  escalateTo: string | null;
  urgency: EscalationUrgency;
  triggers: string[];
  reason: string;
  briefingPoints: string[];
  riskIfIgnored: string;
}

function mock(ctx: EngineContext): EscalationResult {
  const l = ctx.lead;
  const r = l.remarks ?? "";
  const budget = parseBudgetAed(l.budget ?? l.bant?.budget);
  const triggers: string[] = [];

  if (budget >= 5_000_000) triggers.push(`UHNI ticket size (${l.budget})`);
  if (budget >= 8_000_000) triggers.push("High-value / branded inventory requirement");
  if (/portfolio|already (own|bought)|second (home|property)|investor|multiple (unit|propert)/i.test(r)) triggers.push("Existing portfolio / repeat investor");
  if (/family|spouse|wife|husband|father|mother|parents|brother|partner|jointly/i.test(`${r} ${l.bant?.authority ?? ""}`)) triggers.push("Family / joint decision structure");
  if (/resale|resell|flip|exit|secondary market/i.test(r)) triggers.push("Resale / exit-driven — needs structuring");
  if (/another (agent|broker)|other broker|also (talking|dealing)|competitor/i.test(r)) triggers.push("Deal-control risk (client is multi-sourcing)");
  if (/mortgage|finance|loan|ltv|bank approval/i.test(r)) triggers.push("Complex financing");

  const shouldEscalate = triggers.length > 0 && budget >= 3_000_000 || budget >= 5_000_000 || triggers.length >= 2;
  const toLalit = budget >= 5_000_000 || /portfolio|already (own|bought)|investor/i.test(r);
  const urgency: EscalationUrgency = !shouldEscalate ? "None" : budget >= 8_000_000 ? "Immediate" : budget >= 5_000_000 ? "Today" : "ThisWeek";

  return {
    shouldEscalate,
    escalateTo: shouldEscalate ? (toLalit ? "Lalit Sharma" : "Reporting Manager") : null,
    urgency,
    triggers: triggers.length ? triggers : ["No escalation signals — standard agent handling is appropriate."],
    reason: shouldEscalate
      ? `${triggers[0]}. A deal of this profile converts far better with senior involvement and is too valuable to risk on solo handling.`
      : "Profile is within normal agent scope — no escalation warranted yet.",
    briefingPoints: shouldEscalate
      ? [
          `Client: ${l.name} · ${l.budget ?? "budget TBD"} · ${l.requirement ?? "requirement TBD"}.`,
          `Stage: ${l.status ?? "—"}; last contact ${l.lastContactDays ?? "?"} day(s) ago.`,
          triggers.length > 1 ? `Why senior: ${triggers.slice(0, 2).join(" + ")}.` : `Why senior: ${triggers[0]}.`,
          "Open gaps: " + [!l.bant?.authority && "decision-maker", !l.bant?.timeline && "timeline"].filter(Boolean).join(", ") || "qualification largely complete.",
        ]
      : [],
    riskIfIgnored: shouldEscalate
      ? "Left in the agent queue, a lead this size is likely to stall or be lost to a competitor mid-funnel."
      : "Low — routine follow-up is sufficient.",
  };
}

const SCHEMA_HINT = `Return ONLY JSON: { "shouldEscalate":boolean, "escalateTo":string|null, "urgency":"Immediate"|"Today"|"ThisWeek"|"None", "triggers":string[], "reason":string, "briefingPoints":string[], "riskIfIgnored":string }`;

export const escalationEngine: Engine<EscalationResult> = {
  key: "escalation",
  title: "Escalation",
  description: "Detects UHNI / portfolio / family-decision / deal-control signals and recommends who to escalate to, with a briefing.",
  buildPrompt(ctx) {
    return {
      system: `${WCR_PERSONA}\n\nDecide whether this lead must be escalated (UHNI, complex financing, family decision, high-value inventory, resale risk, deal-control risk). If yes, name who to escalate to and exactly what to brief them.\n${SCHEMA_HINT}`,
      user: `Assess escalation for this lead.\n\n${leadBlock(ctx.lead)}`,
    };
  },
  mock,
  parse(raw) {
    const r = parseJsonLoose<EscalationResult>(raw);
    if (typeof r.shouldEscalate !== "boolean" || !Array.isArray(r.triggers)) throw new Error("missing required escalation fields");
    return r;
  },
};
