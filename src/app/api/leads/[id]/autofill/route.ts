// Manual "🪄 Auto-fill from remarks" trigger — called by the button on lead detail.
//
// Re-runs the same heuristic extractor that runs at CSV-import time but on the
// CURRENT remarks text. Returns the suggestion + a preview of what fields would
// change. Body { apply: true } actually writes them. Body { apply: false } is
// dry-run for the preview modal.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { extractFromRemarks, mergeSuggestions } from "@/lib/remarkAutofill";
import { audit, reqMeta } from "@/lib/audit";
import { teamToMarket } from "@/lib/market";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));
  const apply = body.apply === true;
  const force = body.force === true; // overwrite even if a field is already set

  // loadOwnedLead returns a slim lead — fetch the full row for remarks + structured fields
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (!lead.remarks || lead.remarks.trim().length < 5) {
    return NextResponse.json({ ok: false, reason: "No remarks to parse" });
  }

  const projects = (await prisma.project.findMany({ select: { name: true } })).map((p) => p.name);
  const suggestions = extractFromRemarks(lead.remarks, projects);
  const existing = {
    budgetMin: lead.budgetMin, budgetMax: lead.budgetMax,
    budgetCurrency: lead.budgetCurrency, configuration: lead.configuration,
    city: lead.city, potential: lead.potential, fundReadiness: lead.fundReadiness,
    whenCanInvest: lead.whenCanInvest, company: lead.company,
    sourceDetail: lead.sourceDetail, forwardedTeam: lead.forwardedTeam,
  };
  const toApply = mergeSuggestions(existing as never, suggestions, force) as Record<string, unknown>;
  // MARKET tracks TEAM — if the remark autofill sets a team, co-write the derived
  // India/UAE market so the lead-market-segregation invariant can't drift.
  if (toApply.forwardedTeam && toApply.market == null) {
    toApply.market = teamToMarket(toApply.forwardedTeam as string);
  }

  if (!apply) {
    return NextResponse.json({ ok: true, dryRun: true, suggestions, toApply, fieldsFound: Object.keys(toApply).length });
  }

  if (Object.keys(toApply).length === 0) {
    return NextResponse.json({ ok: true, applied: 0, message: "Nothing to fill — every detected field is already set." });
  }

  await prisma.lead.update({ where: { id }, data: toApply as never });
  await audit({
    userId: me.id, action: "lead.autofill", entity: "Lead", entityId: id,
    meta: { fields: Object.keys(toApply), force }, request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, applied: Object.keys(toApply).length, fields: toApply });
}
