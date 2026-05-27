// Vault — delete a single entry.
// PRIVACY: we MUST verify the entry's userId matches the session user BEFORE
// deleting. Returning 404 (not 403) avoids leaking the existence of other
// users' entries. Admin role has no special access.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  // Compound where ensures we delete ONLY if the entry belongs to me.
  // deleteMany returns count=0 if no match — safer than findUnique+delete
  // because it cannot race against a concurrent delete.
  const res = await prisma.vaultEntry.deleteMany({
    where: { id, userId: me.id },
  });

  if (res.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
