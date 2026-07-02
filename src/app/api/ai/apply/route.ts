// POST /api/ai/apply — ADMIN-only, gated behind ai.enabled (default OFF). Applies a
// SINGLE approved, reversible, whitelisted AI mutation (M4). Every apply is recorded
// to AuditLog (action "ai.apply") with full before/after for reversal.
//
// Body: { mutation: { entity, entityId, field, from, to } }  — `reversible` is forced
// true here; the whitelist + before-check are the real gates (applyService).
//
// This is the FIRST AI write path. It is deliberately narrow: one field
// (Lead.market, derived/recomputable), admin-approved, audited, reversible.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { reqMeta } from "@/lib/audit";
import { applyMutation } from "@/lib/ai/applyService";
import type { AiMutation } from "@/lib/ai/types";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  if ((await getSetting("ai.enabled")).toLowerCase() !== "true") {
    return NextResponse.json({ error: "AI is disabled" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as { mutation?: unknown }));
  const m = (body.mutation ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);

  const entity = str(m.entity);
  const entityId = str(m.entityId);
  const field = str(m.field);
  if (!entity || !entityId || !field) {
    return NextResponse.json({ error: "mutation.entity, entityId and field are required" }, { status: 400 });
  }

  // Reconstruct a trusted AiMutation shape; reversible is forced (planApply re-checks).
  const mutation: AiMutation = {
    entity,
    entityId,
    field,
    from: (m.from ?? null) as AiMutation["from"],
    to: (m.to ?? null) as AiMutation["to"],
    reversible: true,
  };

  const outcome = await applyMutation(mutation, me.id, reqMeta(req));
  if (!outcome.applied) {
    return NextResponse.json({ ok: false, error: outcome.reason }, { status: 409 });
  }
  return NextResponse.json({ ok: true, description: outcome.description });
}
