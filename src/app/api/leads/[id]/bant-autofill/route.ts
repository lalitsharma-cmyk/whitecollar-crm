import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { runBantAutoFill } from "@/lib/bantAutoFill";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const suggestions = await runBantAutoFill(id);
  await prisma.lead.update({ where: { id }, data: { bantSuggestionsJson: JSON.stringify(suggestions) } });
  return NextResponse.json({ ok: true, suggestions });
}
