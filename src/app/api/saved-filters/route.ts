// List + create saved filters.
// Visibility rule: every user sees their own private + all shared filters.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canonicalizeQuery } from "@/lib/savedFilters";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await requireUser();
  const items = await prisma.savedFilter.findMany({
    where: { OR: [{ isShared: true }, { createdById: me.id }] },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({
    items: items.map((f) => ({
      id: f.id, name: f.name, icon: f.icon, queryString: f.queryString,
      isShared: f.isShared, isOwn: f.createdById === me.id, isSystem: f.createdById === null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 80);
  const queryString = canonicalizeQuery(String(body.queryString ?? ""));
  const icon = body.icon ? String(body.icon).slice(0, 8) : null;
  const isShared = body.isShared !== false; // default true
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!queryString) return NextResponse.json({ error: "Query string required" }, { status: 400 });

  const created = await prisma.savedFilter.create({
    data: { name, icon, queryString, isShared, createdById: me.id },
  });
  return NextResponse.json({ ok: true, id: created.id });
}
