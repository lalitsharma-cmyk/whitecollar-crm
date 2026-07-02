// ────────────────────────────────────────────────────────────────────────────
// AI Sales OS — shared pure types (M0). No prisma, no "server-only": importable
// by the read-only regression harness + unit tests, mirroring src/lib/customer/types.ts.
// The Brain (src/lib/ai/brain) and every layer speak these shapes.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
// ────────────────────────────────────────────────────────────────────────────

/** What the Brain is reasoning about. One client = one profile, so `customer` is
 *  the canonical kind; lead/buyer/cold resolve up to a customer where possible. */
export type AiEntityKind = "lead" | "buyer" | "cold" | "customer";

/** Read-Only-First pipeline stage — every AiOutput records how far it got. Nothing
 *  past `suggest` happens without a human `approval`. */
export type AiStage = "read" | "analyze" | "detect" | "explain" | "suggest" | "approval" | "apply";

/** A deterministic signal from L2 (BANT, follow-up state, dedup, market, buying signal).
 *  `source` = the rule/lib that produced it, so the output is auditable + explainable. */
export interface AiSignal {
  key: string;                 // e.g. "followup.overdue", "bant.missing.budget", "dup.veryHigh"
  value: string | number | boolean | null;
  weight?: number;             // relative importance for ranking (0..1)
  source: string;              // the analyzer/lib that emitted it (explainability)
}

/** Confidence for a detection/suggestion. Deterministic rules → "high"; LLM-only
 *  (ambiguous) → carries the model + a trace so a human can audit the reasoning. */
export type AiConfidence = "high" | "medium" | "low";

/** L3 detection — an opportunity or risk the Brain found. */
export interface AiDetection {
  id: string;                  // stable id (kind + rule), for dedup across runs
  kind: "opportunity" | "risk";
  title: string;               // human one-liner
  confidence: AiConfidence;
  evidence: AiSignal[];        // WHY — the signals that triggered it (explainable)
  reasonedByLLM?: boolean;     // true only when a rule couldn't decide
}

/** A proposed action. `mutation` is null for read-only suggestions; when present it
 *  is executed ONLY after human approval and is required to be reversible. */
export interface AiSuggestion {
  id: string;
  detectionId: string | null; // which detection motivated it
  action: string;             // e.g. "call.today", "match.buyer", "fix.market"
  rationale: string;          // explainable, evidence-backed
  confidence: AiConfidence;
  routeToRole?: "AGENT" | "MANAGER" | "ADMIN";  // who should act/approve
  mutation: AiMutation | null; // null = pure suggestion (no write)
}

/** A gated, reversible write proposal. NEVER applied without approval; always audited. */
export interface AiMutation {
  entity: string;              // e.g. "Lead", "BuyerRecord"
  entityId: string;
  field: string;
  from: unknown;
  to: unknown;
  reversible: true;            // type-level guarantee: only reversible mutations allowed
}

/** The Brain's output for one entity. Read-only by construction — applying a
 *  mutation is a separate, approval-gated step that consumes a suggestion. */
export interface AiResult {
  kind: AiEntityKind;
  entityId: string;
  reachedStage: AiStage;       // how far the pipeline got (usually "suggest")
  signals: AiSignal[];
  detections: AiDetection[];
  suggestions: AiSuggestion[];
  explanation: string;         // top-level, human-readable summary of the reasoning
  engine: string;              // which engine produced any LLM reasoning ("mock" | "gemini" | …)
}

/** Audit row written for every read/suggest/approval/apply (audit-first). */
export interface AiDecisionAudit {
  kind: AiEntityKind;
  entityId: string;
  stage: AiStage;
  actorUserId: string | null;  // null = system/scheduled
  summary: string;
  detail?: unknown;
}
