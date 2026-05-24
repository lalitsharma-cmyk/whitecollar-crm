// Admin-only: set or clear an agent's Acefone agent id (used for click-to-call routing).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const raw = body.acefoneAgentId;
  const value = raw === null || raw === "" ? null : String(raw).trim().slice(0, 32) || null;
  await prisma.user.update({ where: { id }, data: { acefoneAgentId: value } });
  return NextResponse.json({ ok: true, acefoneAgentId: value });
}
