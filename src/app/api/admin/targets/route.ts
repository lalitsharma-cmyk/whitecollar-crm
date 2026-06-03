import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_TARGETS, type DailyTargets } from "@/lib/targets";

export async function GET() {
  await requireRole("ADMIN");
  const row = await prisma.setting.findUnique({ where: { key: "dailyTargets" } });
  const data: DailyTargets = row ? { ...DEFAULT_TARGETS, ...JSON.parse(row.value) } : DEFAULT_TARGETS;
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const allowed: (keyof DailyTargets)[] = ["calls", "connected", "virtual", "f2f", "fresh", "deals"];
  const existing = await prisma.setting.findUnique({ where: { key: "dailyTargets" } });
  const current: DailyTargets = existing ? { ...DEFAULT_TARGETS, ...JSON.parse(existing.value) } : { ...DEFAULT_TARGETS };
  for (const key of allowed) {
    if (typeof body[key] === "number" && body[key] >= 0) {
      current[key] = Math.floor(body[key]);
    }
  }
  await prisma.setting.upsert({
    where: { key: "dailyTargets" },
    update: { value: JSON.stringify(current) },
    create: { key: "dailyTargets", value: JSON.stringify(current) },
  });
  return NextResponse.json(current);
}
