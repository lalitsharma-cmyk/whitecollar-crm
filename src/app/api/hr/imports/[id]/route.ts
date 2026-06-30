import { NextResponse, type NextRequest } from "next/server";
import { requireHrPermission, hrApiAuth } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";

// PATCH — finalize an import batch with its real counts + error report.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrPermission("importData");
  if (access.error) return access.error;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  for (const k of ["total", "imported", "updated", "failed", "skipped"]) if (b[k] != null) data[k] = Number(b[k]) || 0;
  if (typeof b.errors === "string") data.errors = b.errors.slice(0, 100_000);
  await prisma.hRImport.update({ where: { id }, data }).catch(() => {});
  return NextResponse.json({ ok: true });
}

// GET — download the batch's error report as CSV.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrPermission("importData");
  if (access.error) return access.error;
  const { id } = await params;
  const rec = await prisma.hRImport.findUnique({ where: { id } });
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let rows: { row: string; reason: string }[] = [];
  try { rows = rec.errors ? JSON.parse(rec.errors) : []; } catch { rows = []; }
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["Row,Reason", ...rows.map(r => `${esc(r.row)},${esc(r.reason)}`)].join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="import-errors-${id}.csv"`,
    },
  });
}

// DELETE — ADMIN only. Hard-delete every candidate this batch created (cascade
// removes their follow-ups, interviews, timeline activities and resumes) plus
// the batch row itself. Used to reverse a wrong import.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await hrApiAuth();
  if (access.error) return access.error;
  if (access.role !== "ADMIN") return NextResponse.json({ error: "Only an Admin can delete an import batch." }, { status: 403 });
  const { id } = await params;
  // 404 if the batch doesn't exist, so the client shows a real error instead of
  // a false success on a stale/wrong id.
  const batch = await prisma.hRImport.findUnique({ where: { id }, select: { id: true } });
  if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  const del = await prisma.hRCandidate.deleteMany({ where: { importBatchId: id } });
  // Let any delete error propagate (no silent .catch) so the client can surface it.
  await prisma.hRImport.delete({ where: { id } });
  return NextResponse.json({ ok: true, deleted: del.count });
}
