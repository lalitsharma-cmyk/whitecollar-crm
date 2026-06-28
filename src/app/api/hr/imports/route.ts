import { NextResponse, type NextRequest } from "next/server";
import { requireHrPermission } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";

// Record an import run in the history log (called by the client after all batches finish).
export async function POST(req: NextRequest) {
  const access = await requireHrPermission("importData");
  if (access.error) return access.error;
  const { me } = access;
  const b = await req.json().catch(() => ({}));
  const rec = await prisma.hRImport.create({
    data: {
      fileName: String(b.fileName ?? "import").slice(0, 200),
      importedById: me.id,
      total: Number(b.total) || 0,
      imported: Number(b.imported) || 0,
      updated: Number(b.updated) || 0,
      failed: Number(b.failed) || 0,
      skipped: Number(b.skipped) || 0,
    },
  });
  return NextResponse.json({ ok: true, id: rec.id });
}
