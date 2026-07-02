// AI Sales OS — pure analysis core (M0). Deterministic, IO-free (no prisma, no
// engine call): given a pre-loaded lead context it runs the Read-Only pipeline
// (analyze → detect → suggest → explain) and returns an AiResult. NEVER mutates —
// suggestions carry `mutation: null` (applying is a separate approval-gated step).
// The context builder (prisma) + the LLM "reason" step are M1/M4 wrappers around
// this pure core, so this stays unit-testable (mirrors src/lib/leaveCover.ts).
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import type { AiResult, AiSignal, AiDetection, AiSuggestion } from "./types";

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
      explanation: `${ctx.name} is a closed/lost lead — no action.`, engine: "mock",
    };
  }

  s("followup.overdue", ctx.followupOverdue, 0.9, "followup");
  s("followup.missing", ctx.followupMissing, 0.6, "followup");
  s("lead.hot", ctx.isHot, 0.8, "aiScore");
  s("contact.today", ctx.contactedToday, 0.5, "callLog");
  if (ctx.daysSinceLastTouch != null) s("touch.daysSince", ctx.daysSinceLastTouch, 0.4, "lastTouchedAt");

  const evidence = (...keys: string[]) => signals.filter((sig) => keys.includes(sig.key));
  const detections: AiDetection[] = [];
  if (ctx.followupOverdue) {
    detections.push({ id: "followup-overdue", kind: "risk", title: "Overdue follow-up", confidence: "high", evidence: evidence("followup.overdue") });
  }
  if (ctx.isHot && !ctx.contactedToday) {
    detections.push({ id: "hot-uncontacted", kind: "opportunity", title: "Hot lead, no contact today", confidence: "high", evidence: evidence("lead.hot", "contact.today") });
  }
  if (ctx.followupMissing) {
    detections.push({ id: "followup-missing", kind: "risk", title: "No next follow-up scheduled", confidence: "medium", evidence: evidence("followup.missing") });
  }
  if ((ctx.daysSinceLastTouch ?? 0) > 7 && !ctx.contactedToday) {
    detections.push({ id: "ghosting", kind: "risk", title: `Untouched ${ctx.daysSinceLastTouch}d`, confidence: "medium", evidence: evidence("touch.daysSince") });
  }

  const suggestions: AiSuggestion[] = [];
  for (const d of detections) {
    if (d.id === "followup-overdue" || d.id === "hot-uncontacted" || d.id === "ghosting") {
      suggestions.push({ id: `call-${d.id}`, detectionId: d.id, action: "call.today", rationale: `${d.title} — call ${ctx.name} today.`, confidence: d.confidence, routeToRole: "AGENT", mutation: null });
    }
    if (d.id === "followup-missing") {
      suggestions.push({ id: "set-followup", detectionId: d.id, action: "followup.set", rationale: `Set a next follow-up date for ${ctx.name}.`, confidence: d.confidence, routeToRole: "AGENT", mutation: null });
    }
  }

  const explanation = detections.length
    ? `${ctx.name}: ${detections.map((d) => d.title).join("; ")}.`
    : `${ctx.name}: no action needed right now.`;

  return {
    kind: "lead", entityId: ctx.id, reachedStage: "suggest",
    signals, detections, suggestions, explanation, engine: "mock",
  };
}
