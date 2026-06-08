import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrDuplicateWhere } from "@/lib/hrDuplicates";

// Live duplicate lookup as the user fills the Add Candidate form.
// Matches on mobile, WhatsApp, or email; returns up to 5 existing candidates.
export async function GET(req: NextRequest) {
  await requireUser();
  const url = new URL(req.url);
  const where = hrDuplicateWhere(
    url.searchParams.get("phone"),
    url.searchParams.get("whatsapp"),
    url.searchParams.get("email"),
  );
  if (!where) return NextResponse.json({ matches: [] });

  const matches = await prisma.hRCandidate.findMany({
    where,
    select: { id: true, name: true, phone: true, whatsappPhone: true, email: true, status: true },
    take: 5,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ matches });
}
