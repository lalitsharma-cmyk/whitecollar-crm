import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";

/**
 * PUT /api/leads/[id]/sticky-note
 *
 * Upserts the calling agent's private sticky note for this lead.
 * Unique (leadId, userId) — every agent gets exactly one row per lead.
 *
 * Body: { body: string }   (mapped to StickyNote.body)
 * Returns: { ok: true, updatedAt: ISO } so the widget can show "Saved · just now".
 *
 * PRIVACY: the note body is only ever returned to its owner. Other agents
 * looking at the same lead get their own row (or an empty new one).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ownership / scope check — same as other inline-edit endpoints. Agents
  // can only touch leads they own; admins/managers can touch any.
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const payload = await req.json().catch(() => ({}));
  const raw = typeof payload?.body === "string" ? payload.body : "";
  // 4 KB is plenty for a sticky scratchpad — protects the table from abuse.
  if (raw.length > 4000) {
    return NextResponse.json({ error: "Sticky note is too long (max 4000 chars)" }, { status: 400 });
  }

  const sticky = await prisma.stickyNote.upsert({
    where: { leadId_userId: { leadId: id, userId: me.id } },
    create: { leadId: id, userId: me.id, body: raw },
    update: { body: raw },
  });

  return NextResponse.json({
    ok: true,
    body: sticky.body,
    updatedAt: sticky.updatedAt.toISOString(),
  });
}
