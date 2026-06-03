import { prisma } from "@/lib/prisma";

export interface DailyTargets {
  calls: number;
  connected: number;
  virtual: number;
  f2f: number;
  fresh: number;
  deals: number;
}

export const DEFAULT_TARGETS: DailyTargets = {
  calls: 150,
  connected: 50,
  virtual: 2,
  f2f: 1,
  fresh: 5,
  deals: 5,
};

export async function getDailyTargets(): Promise<DailyTargets> {
  const row = await prisma.setting.findUnique({ where: { key: "dailyTargets" } });
  if (!row) return DEFAULT_TARGETS;
  try {
    return { ...DEFAULT_TARGETS, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_TARGETS;
  }
}
