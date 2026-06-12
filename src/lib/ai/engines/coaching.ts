import type { Engine, EngineContext } from "../types";
import { parseJsonLoose } from "../json";
import { WCR_PERSONA, leadBlock } from "../persona";

/**
 * Agent Coaching Engine — what a sales director would tell the agent after
 * reading their handling of this lead. Not about the client; about the agent.
 */

export interface CoachingResult {
  grade: "Strong" | "Average" | "Needs Work";
  headline: string;
  whatAgentMissed: string[];
  questionsNotAsked: string[];
  qualificationGaps: string[];
  nextBestQuestions: string[];
  oneThingToDoBetter: string;
}

function mock(ctx: EngineContext): CoachingResult {
  const l = ctx.lead;
  const hasAuthority = !!l.bant?.authority;
  const hasTimeline = !!l.bant?.timeline;
  const hasBudget = !!(l.budget || l.bant?.budget);
  const hasNeed = !!(l.requirement || l.bant?.need);
  const hasVisit = (l.siteVisitsCount ?? 0) > 0 || (l.meetingsCount ?? 0) > 0;
  const thinNotes = (l.remarks ?? "").length < 150;

  const missed: string[] = [];
  if (!hasAuthority) missed.push("Never confirmed who actually makes the buying decision.");
  if (!hasTimeline) missed.push("Didn't pin a purchase timeframe — the lead can drift indefinitely.");
  if (!hasVisit) missed.push("No attempt to convert interest into a meeting or site visit.");
  if (thinNotes) missed.push("Conversation notes are thin — hard for anyone to pick this up cold.");

  const notAsked: string[] = [];
  if (!hasAuthority) notAsked.push("Who else is involved in this decision?");
  if (!hasNeed) notAsked.push("What's driving the purchase — end-use, yield, or Golden Visa?");
  if (!hasBudget) notAsked.push("What's the comfortable ticket size in AED?");
  if (!hasTimeline) notAsked.push("When do you want to complete the purchase?");

  const gaps: string[] = [];
  if (!hasBudget) gaps.push("Budget");
  if (!hasAuthority) gaps.push("Authority");
  if (!hasNeed) gaps.push("Need");
  if (!hasTimeline) gaps.push("Timeline");

  const score = [hasAuthority, hasTimeline, hasBudget, hasNeed, hasVisit].filter(Boolean).length;
  const grade = score >= 4 ? "Strong" : score >= 2 ? "Average" : "Needs Work";

  return {
    grade,
    headline:
      grade === "Strong" ? "Solid qualification — tighten the close."
      : grade === "Average" ? "Reasonable start, but key qualifiers are still open."
      : "Under-qualified — this lead was logged, not worked.",
    whatAgentMissed: missed.length ? missed : ["Nothing major — qualification is thorough."],
    questionsNotAsked: notAsked.length ? notAsked : ["All core qualifiers covered."],
    qualificationGaps: gaps.length ? gaps : ["None — BANT is complete."],
    nextBestQuestions: notAsked.slice(0, 3).length ? notAsked.slice(0, 3) : ["Can we lock a site visit this week?"],
    oneThingToDoBetter: !hasAuthority
      ? "Always establish the decision-maker on the first real conversation — it changes how you sell."
      : !hasVisit
        ? "Push every qualified lead toward a site visit; talking isn't closing."
        : "Capture richer notes so the next touch builds on the last.",
  };
}

const SCHEMA_HINT = `Return ONLY JSON: { "grade":"Strong"|"Average"|"Needs Work", "headline":string, "whatAgentMissed":string[], "questionsNotAsked":string[], "qualificationGaps":string[], "nextBestQuestions":string[], "oneThingToDoBetter":string }`;

export const coachingEngine: Engine<CoachingResult> = {
  key: "coaching",
  title: "Agent Coaching",
  description: "What the agent missed, the questions they didn't ask, and the next-best questions to close the gaps.",
  buildPrompt(ctx) {
    return {
      system: `${WCR_PERSONA}\n\nCoach the AGENT (not the client). Be direct and specific, the way a sales director reviews a rep's handling.\n${SCHEMA_HINT}`,
      user: `Review how this lead has been handled and coach the agent.\n\n${leadBlock(ctx.lead)}`,
    };
  },
  mock,
  parse(raw) {
    const r = parseJsonLoose<CoachingResult>(raw);
    if (!r.grade || !Array.isArray(r.nextBestQuestions)) throw new Error("missing required coaching fields");
    return r;
  },
};
