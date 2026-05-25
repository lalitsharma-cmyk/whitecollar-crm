// Smart CMA — returns a branded buyer-facing PDF for a lead.
// Includes top 3 matching units + payment plan + side-by-side comparison.
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { bestUnitsForLead } from "@/lib/inventoryMatch";
import { renderCmaPdf } from "@/lib/cmaPdf";
import { audit, reqMeta } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const [lead, units] = await Promise.all([
    prisma.lead.findUnique({ where: { id } }),
    bestUnitsForLead(id, 3),
  ]);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Render the PDF
  const pdf = await renderCmaPdf({
    lead,
    agent: me,
    units,
  });

  // Audit
  await audit({
    userId: me.id,
    action: "lead.cma.download",
    entity: "Lead",
    entityId: id,
    meta: { leadName: lead.name, unitCount: units.length },
    request: reqMeta(req),
  });

  const filename = `WCR-${lead.name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0,10)}.pdf`;
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.length),
    },
  });
}
