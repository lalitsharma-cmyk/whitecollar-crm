import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { askCRM } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  await requireUser();
  const { question } = await req.json().catch(() => ({}));
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "Missing question" }, { status: 400 });
  }

  // Build a compact context — counts + a few key lists.
  const [total, newToday, hot, byStatus, byOwner, recent] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    prisma.lead.count({ where: { aiScore: "HOT" } }),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["ownerId"], _count: { _all: true } }),
    prisma.lead.findMany({
      where: { aiScore: "HOT" },
      orderBy: { lastTouchedAt: "asc" },
      take: 10,
      include: { owner: true, interestedUnits: { include: { unit: { include: { project: true } } }, take: 1 } },
    }),
  ]);

  const users = await prisma.user.findMany({ where: { id: { in: byOwner.map(b => b.ownerId).filter((x): x is string => !!x) } } });
  const userMap = new Map(users.map(u => [u.id, u.name]));

  const context = [
    `Total leads: ${total}. New in 24h: ${newToday}. Hot: ${hot}.`,
    `By status: ${byStatus.map(b => `${b.status}=${b._count._all}`).join(", ")}.`,
    `By owner: ${byOwner.map(b => `${userMap.get(b.ownerId ?? "") ?? "Unassigned"}=${b._count._all}`).join(", ")}.`,
    `Hot leads (oldest last-touch first):`,
    ...recent.map(l => `- ${l.name} (${l.city ?? "?"}) · ${l.status} · owner=${l.owner?.name ?? "—"} · last=${l.lastTouchedAt?.toISOString().slice(0,10) ?? "never"} · ${l.interestedUnits[0]?.unit.project.name ?? "no project"}`),
  ].join("\n");

  const answer = await askCRM(question, context);
  return NextResponse.json({ answer });
}
