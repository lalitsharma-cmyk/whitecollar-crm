// Admin-only: upsert a daily target for an agent. Latest row wins (readTarget()
// queries the most recent DAILY row for that user+metric).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { TargetMetric } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  const metricRaw = String(body.metric ?? "");
  const value = Number(body.value);
  if (!userId || !(Object.values(TargetMetric) as string[]).includes(metricRaw) || isNaN(value) || value < 0) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const metric = metricRaw as TargetMetric;

  // Look for an existing row for this user+metric+period — update in place if
  // found, otherwise insert. Latest startDate wins on read.
  const existing = await prisma.target.findFirst({
    where: { userId, metric, period: "DAILY" },
    orderBy: { startDate: "desc" },
  });
  if (existing) {
    await prisma.target.update({ where: { id: existing.id }, data: { value, startDate: new Date() } });
  } else {
    await prisma.target.create({ data: { userId, metric, period: "DAILY", value } });
  }

  await audit({ userId: me.id, action: "target.set", entity: "User", entityId: userId,
    meta: { metric, value }, request: reqMeta(req) });
  return NextResponse.json({ ok: true });
}
