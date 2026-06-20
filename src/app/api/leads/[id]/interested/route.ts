import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { LeadInterestType, ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { userCanAccessProjectCountry } from "@/lib/propertyScope";

// POST /api/leads/[id]/interested  body: { unitId, type?, notes? }
// Adds (or upserts) a Unit into the lead's interested-properties list.
// Idempotent — re-posting just updates type/notes; the unique (leadId,unitId)
// constraint guarantees we don't double-insert.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const body = await req.json().catch(() => ({}));
  const unitId = String(body.unitId ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "unitId required" }, { status: 400 });

  const typeRaw = String(body.type ?? "PRIMARY");
  const type = (Object.values(LeadInterestType) as string[]).includes(typeRaw)
    ? (typeRaw as LeadInterestType)
    : LeadInterestType.PRIMARY;
  const notes = body.notes ? String(body.notes).trim() : undefined;

  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { project: true },
  });
  if (!unit) return NextResponse.json({ error: "Unit not found" }, { status: 404 });

  // Market guard (server-side). An AGENT may only mark interest in a unit whose
  // project is in their market; Admin/Manager may cross markets.
  if (!userCanAccessProjectCountry(me, unit.project.country)) {
    return NextResponse.json({ error: "That property belongs to another market." }, { status: 403 });
  }

  await prisma.leadProperty.upsert({
    where: { leadId_unitId: { leadId: id, unitId } },
    create: { leadId: id, unitId, type, notes },
    update: { type, notes },
  });

  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.PROJECT_DISCUSSED,
      status: ActivityStatus.DONE,
      title: `Interested: ${unit.project.name} ${unit.configuration} (${unit.code})`,
      description: notes,
      completedAt: new Date(),
    },
  });
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } });
  return NextResponse.json({ ok: true });
}

// DELETE /api/leads/[id]/interested  body: { unitId }
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const body = await req.json().catch(() => ({}));
  const unitId = String(body.unitId ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "unitId required" }, { status: 400 });
  await prisma.leadProperty.deleteMany({ where: { leadId: id, unitId } });
  return NextResponse.json({ ok: true });
}
