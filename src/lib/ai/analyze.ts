// AI Sales OS — pure analysis core (M0). Deterministic, IO-free (no prisma, no
// engine call): given a pre-loaded lead context it runs the Read-Only pipeline
// (analyze → detect → suggest → explain) and returns an AiResult. NEVER mutates —
// suggestions carry `mutation: null` (applying is a separate approval-gated step).
// The context builder (prisma) + the LLM "reason" step are M1/M4 wrappers around
// this pure core, so this stays unit-testable (mirrors src/lib/leaveCover.ts).
//
// Explainability contract (why this matters even on the mock engine): the
// deterministic `explanation` + each suggestion `rationale` are what an agent/manager
// actually reads until a real LLM key is set. So they are written to be action-first,
// confidence-annotated, and GROUNDED in the CRM's own rules (retrieveKnowledge) — not a
// bare list of flags. No "[mock]" text ever appears here; this is real deterministic copy.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import type { AiResult, AiSignal, AiDetection, AiSuggestion, AiConfidence } from "./types";
import { retrieveKnowledge } from "./knowledge";

/** The minimal, pre-loaded facts the M0 analyzer reads. The server builder maps a
 *  Lead + its computed state (follow-up, score, today's touches) into this shape. */
export interface AiLeadContext {
  id: string;
  name: string;
  currentStatus: string | null;
  isTerminal: boolean;         // Won/Closed/Lost/rejected → no action
  followupOverdue: boolean;    // followupDate < start-of-today IST
  followupMissing: boolean;    // workable but no followupDate
  isHot: boolean;              // aiScore = HOT
  contactedToday: boolean;     // a real client touch (call/WA/email) logged today
  ownerId: string | null;
  daysSinceLastTouch: number | null;
}

/** One-line WCR rule that grounds a detection's advice, retrieved from the shared KB
 *  (deterministic keyword overlap — no LLM). Keeps the mock explanation citing a KNOWN
 *  rule instead of sounding generic. Empty string when nothing relevant is found. */
function ground(query: string): string {
  const hit = retrieveKnowledge(query, { limit: 1 })[0];
  return hit ? hit.entry.body : "";
}

/** Human phrase for a confidence tier — surfaced in the explanation so the reader always
 *  sees HOW sure the AI is (never a bare claim). */
const CONF_LABEL: Record<AiConfidence, string> = {
  high: "high confidence",
  medium: "medium confidence",
  low: "low confidence",
};

export function analyzeLeadContext(ctx: AiLeadContext): AiResult {
  const signals: AiSignal[] = [];
  const s = (key: string, value: AiSignal["value"], weight: number, source: string) => {
    signals.push({ key, value, weight, source });
  };

  s("status.terminal", ctx.isTerminal, 0, "lead.status");
  if (ctx.isTerminal) {
    return {
      kind: "lead", entityId: ctx.id, reachedStage: "analyze",
      signals, detections: [], suggestions: [],
      explanation: `${ctx.name} is a closed/lost lead — no action needed (terminal status "${ctx.currentStatus ?? "closed"}").`,
      engine: "mock",
    };
  }

  const days = ctx.daysSinceLastTouch;
  s("followup.overdue", ctx.followupOverdue, 0.9, "followup");
  s("followup.missing", ctx.followupMissing, 0.6, "followup");
  s("lead.hot", ctx.isHot, 0.8, "aiScore");
  s("contact.today", ctx.contactedToday, 0.5, "callLog");
  if (days != null) s("touch.daysSince", days, 0.4, "lastTouchedAt");

  const evidence = (...keys: string[]) => signals.filter((sig) => keys.includes(sig.key));
  const detections: AiDetection[] = [];

  // Hot + no contact today = the single highest-value moment (fresh-intent decays fast).
  // Ordered FIRST so brain.ts (which reasons over detections[0]) sees the true top signal.
  if (ctx.isHot && !ctx.contactedToday) {
    detections.push({
      id: "hot-uncontacted", kind: "opportunity",
      title: "Hot lead — not contacted today", confidence: "high",
      evidence: evidence("lead.hot", "contact.today", "touch.daysSince"),
    });
  }
  if (ctx.followupOverdue) {
    detections.push({
      id: "followup-overdue", kind: "risk",
      title: "Follow-up is overdue", confidence: "high",
      evidence: evidence("followup.overdue", "touch.daysSince"),
    });
  }
  // Cooling / stalled: no touch in >7d. Badly stalled (>14d) is a HIGH-confidence risk
  // (the gap itself is unambiguous), 8–14d is a medium warning.
  if ((days ?? 0) > 7 && !ctx.contactedToday) {
    const badlyStalled = (days ?? 0) > 14;
    detections.push({
      id: "ghosting", kind: "risk",
      title: `No contact in ${days} days${badlyStalled ? " — going cold" : ""}`,
      confidence: badlyStalled ? "high" : "medium",
      evidence: evidence("touch.daysSince", "contact.today"),
    });
  }
  if (ctx.followupMissing) {
    detections.push({
      id: "followup-missing", kind: "risk",
      title: "No next follow-up scheduled", confidence: "medium",
      evidence: evidence("followup.missing"),
    });
  }

  const suggestions: AiSuggestion[] = [];
  for (const d of detections) {
    if (d.id === "hot-uncontacted") {
      const rule = ground("hot high-intent lead uncontacted priority cooling");
      suggestions.push({
        id: `call-${d.id}`, detectionId: d.id, action: "call.today",
        rationale: `Call ${ctx.name} now — flagged HOT and no touch logged today${
          days != null ? ` (last contact ${days}d ago)` : ""
        }.${rule ? ` ${rule}` : ""}`,
        confidence: d.confidence, routeToRole: "AGENT", mutation: null,
      });
    }
    if (d.id === "followup-overdue") {
      const rule = ground("overdue follow-up discipline pipeline");
      suggestions.push({
        id: `call-${d.id}`, detectionId: d.id, action: "call.today",
        rationale: `The scheduled follow-up for ${ctx.name} has passed — reconnect today, then set the next date.${
          rule ? ` ${rule}` : ""
        }`,
        confidence: d.confidence, routeToRole: "AGENT", mutation: null,
      });
    }
    if (d.id === "ghosting") {
      const rule = ground("reviving a stalled dormant lead with new information");
      suggestions.push({
        id: `call-${d.id}`, detectionId: d.id, action: "call.today",
        rationale: `${ctx.name} has had no contact in ${days} days and is cooling — re-engage today${
          rule ? `. ${rule}` : "."
        }`,
        confidence: d.confidence, routeToRole: "AGENT", mutation: null,
      });
    }
    if (d.id === "followup-missing") {
      const rule = ground("every workable lead needs a future follow-up date");
      suggestions.push({
        id: "set-followup", detectionId: d.id, action: "followup.set",
        rationale: `${ctx.name} has no next follow-up on the calendar — schedule one so it can't fall through.${
          rule ? ` ${rule}` : ""
        }`,
        confidence: d.confidence, routeToRole: "AGENT", mutation: null,
      });
    }
  }

  // Action-first, confidence-annotated summary — this is what the reader sees on the mock
  // engine, so it names the top action + how sure the AI is + the driving evidence, then
  // lists the remaining findings. Not a bare list of titles.
  let explanation: string;
  if (detections.length === 0) {
    explanation = `${ctx.name}: on track — no overdue follow-up, not stalled, nothing urgent right now.`;
  } else {
    const top = detections[0];
    const lead = top.kind === "opportunity"
      ? `Opportunity for ${ctx.name}: ${top.title.toLowerCase()} (${CONF_LABEL[top.confidence]}).`
      : `Risk on ${ctx.name}: ${top.title.toLowerCase()} (${CONF_LABEL[top.confidence]}).`;
    const primary = suggestions[0];
    const rest = detections.slice(1).map((d) => d.title.toLowerCase());
    explanation =
      lead +
      (primary ? ` Recommended next action: ${primary.rationale}` : "") +
      (rest.length ? ` Also flagged: ${rest.join("; ")}.` : "");
  }

  return {
    kind: "lead", entityId: ctx.id, reachedStage: "suggest",
    signals, detections, suggestions, explanation, engine: "mock",
  };
}
