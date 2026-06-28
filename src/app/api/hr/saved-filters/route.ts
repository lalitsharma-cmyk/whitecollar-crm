// HR ATS — Saved Views (candidate list filter + column snapshots).
// Mirrors the Sales /api/saved-filters pattern but backed by HRSavedFilter.
//
// Visibility rule: every HR user sees their OWN saved views plus any that are
// marked isShared. Only the owner can delete one.
//
// The `query` column stores an opaque JSON blob describing the client-side
// candidate-list state (chip, search, advanced filters, hidden columns) — the
// HR list filters in the browser, so there is no URL query string to persist.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hrApiAuth } from "@/lib/hrAccess";

export const dynamic = "force-dynamic";

// GET — list the caller's own + all shared saved views.
export async function GET() {
  const auth = await hrApiAuth();
  if (auth.error) return auth.error;
  const me = auth.me;

  const items = await prisma.hRSavedFilter.findMany({
    where: { OR: [{ isShared: true }, { userId: me.id }] },
    orderBy: [{ createdAt: "asc" }],
  });

  return NextResponse.json({
    items: items.map((f) => ({
      id: f.id,
      name: f.name,
      query: f.query,
      isShared: f.isShared,
      isOwn: f.userId === me.id,
    })),
  });
}

// POST — create a new saved view from the current filter + column state.
export async function POST(req: NextRequest) {
  const auth = await hrApiAuth();
  if (auth.error) return auth.error;
  const me = auth.me;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 80);
  const query = String(body.query ?? "").slice(0, 8000);
  const isShared = body.isShared === true; // default private

  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!query) return NextResponse.json({ error: "Query required" }, { status: 400 });

  const created = await prisma.hRSavedFilter.create({
    data: { name, query, isShared, userId: me.id },
  });
  return NextResponse.json({ ok: true, id: created.id });
}

// DELETE — remove a saved view (only the owner). id passed as ?id= query param.
export async function DELETE(req: NextRequest) {
  const auth = await hrApiAuth();
  if (auth.error) return auth.error;
  const me = auth.me;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const f = await prisma.hRSavedFilter.findUnique({ where: { id } });
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (f.userId !== me.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.hRSavedFilter.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
