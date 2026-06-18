import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// Project Master CRUD (ADMIN only). The lead auto-classifier reads ACTIVE rows
// from the Project table — add/activate here and routing matches automatically.
// Additive only: create + edit + activate/deactivate. No deletes (deactivate
// instead, so historic lead→project links are never orphaned).
export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (me.role !== "ADMIN") return NextResponse.json({ error: "Admin only." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const toCountry = (m: unknown) => (String(m) === "India" ? "India" : "UAE");

  try {
    if (action === "create") {
      const name = String(body.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "Project name is required." }, { status: 400 });
      const market = String(body.market) === "India" ? "India" : "Dubai";
      const dupe = await prisma.project.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
      if (dupe) return NextResponse.json({ error: "A project with that name already exists." }, { status: 409 });
      const p = await prisma.project.create({
        data: {
          name,
          developer: body.developer ? String(body.developer).trim() : null,
          country: toCountry(body.market),
          city: body.city ? String(body.city).trim() : market,
          source: "manual",
          active: body.active === false ? false : true,
        },
        select: { id: true },
      });
      return NextResponse.json({ ok: true, id: p.id });
    }

    if (action === "update") {
      const id = String(body.id ?? "");
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const data: Record<string, unknown> = {};
      if (body.name != null) { const n = String(body.name).trim(); if (n) data.name = n; }
      if (body.developer !== undefined) data.developer = body.developer ? String(body.developer).trim() : null;
      if (body.market) data.country = toCountry(body.market);
      if (body.city != null) data.city = String(body.city).trim();
      if (body.active !== undefined) data.active = !!body.active;
      if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      await prisma.project.update({ where: { id }, data });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
