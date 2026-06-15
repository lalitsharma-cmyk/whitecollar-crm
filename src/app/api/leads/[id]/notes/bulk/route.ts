import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

/**
 * POST /api/leads/[id]/notes/bulk   body: { text: string }   (ADMIN / Super-Admin only)
 *
 * Paste a block of historical remarks into Conversation History — one remark per
 * line. An optional leading date backdates the remark, e.g.
 *     2026-01-15 | Spoke to client, wants 3BHK in DLF
 * Each line becomes a Note authored by the admin. Recorded in the audit trail.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  if (me.role !== "ADMIN") {
    return NextResponse.json({ error: "Only an admin can bulk-add historical remarks." }, { status: 403 });
  }
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const raw: string = typeof body.text === "string"
    ? body.text
    : Array.isArray(body.remarks) ? (body.remarks as unknown[]).map(String).join("\n") : "";
  const lines = raw.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
  if (lines.length === 0) return NextResponse.json({ error: "No remarks to add" }, { status: 400 });

  const dateRe = /^(\d{4}-\d{2}-\d{2})\s*[|:–-]\s*(.+)$/;
  const data = lines.map((line) => {
    const m = line.match(dateRe);
    if (m) {
      const d = new Date(m[1]);
      return { leadId: id, userId: me.id, body: m[2].trim(), ...(isNaN(d.getTime()) ? {} : { createdAt: d }) };
    }
    return { leadId: id, userId: me.id, body: line };
  });

  await prisma.note.createMany({ data });
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } }).catch(() => {});
  await audit({
    userId: me.id,
    action: "note.bulk_add",
    entity: "Lead",
    entityId: id,
    meta: { count: data.length, historical: true },
    request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true, added: data.length });
}
