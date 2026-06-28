import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hrDuplicateWhere } from "@/lib/hrDuplicates";
import { hrApiAuth, hrScopeWhere } from "@/lib/hrAccess";

// Live duplicate lookup as the user fills the Add Candidate form.
// Matches on mobile, WhatsApp, or email; returns up to 5 existing candidates.
export async function GET(req: NextRequest) {
  const auth = await hrApiAuth();
  if (auth.error) return auth.error;
  const { me } = auth;
  const url = new URL(req.url);
  const dupWhere = hrDuplicateWhere(
    url.searchParams.get("phone"),
    url.searchParams.get("whatsapp"),
    url.searchParams.get("email"),
  );
  if (!dupWhere) return NextResponse.json({ matches: [] });

  // Scope so a Junior HR cannot discover candidates outside their own scope.
  const where = { AND: [hrScopeWhere(me), dupWhere] };

  const matches = await prisma.hRCandidate.findMany({
    where,
    select: { id: true, name: true, phone: true, whatsappPhone: true, email: true, status: true },
    take: 5,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ matches });
}
