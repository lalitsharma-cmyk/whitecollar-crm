// Global Ctrl+K / Cmd+K quick-search endpoint.
// Returns up to 8 leads, 5 projects and 5 active agents/managers matching the
// query. Lead results are scoped via leadScopeWhere() so agents can never
// surface leads they don't own. All queries are capped via `take:` — never
// run unbounded scans here.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";

export async function GET(req: NextRequest) {
  const me = await requireUser();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ leads: [], projects: [], users: [] });
  }

  const scope = await leadScopeWhere(me);

  const [leads, projects, users] = await Promise.all([
    prisma.lead.findMany({
      where: {
        ...scope,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 8,
      select: {
        id: true,
        name: true,
        phone: true,
        budgetMin: true,
        budgetCurrency: true,
      },
    }),
    prisma.project.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 5,
      select: { id: true, name: true, city: true, country: true },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        role: { in: ["AGENT", "MANAGER"] },
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 5,
      select: { id: true, name: true, role: true, team: true },
    }),
  ]);

  return NextResponse.json({ leads, projects, users });
}
