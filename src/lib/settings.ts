// Tiny settings helper backed by the Setting model.
// All settings are stored as TEXT — callers parse to the right shape.

import { prisma } from "@/lib/prisma";

const DEFAULTS = {
  "travel.perKmInr": "10",     // ₹10 per km — admin can change in /settings
  "speedToLead.enabled": "true", // auto-WA + email on every new lead (admin kill-switch)
  // Round-robin auto-assign kill-switch. When OFF, the 5-min reconciler skips
  // every orphan — every new lead stays unassigned until admin manually routes.
  // Flip OFF before bulk imports of existing-client data.
  "roundRobin.enabled": "true",
};

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) return row.value;
  return (DEFAULTS as Record<string, string>)[key] ?? "";
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

// Typed accessors
export async function getTravelRatePerKmInr(): Promise<number> {
  const raw = await getSetting("travel.perKmInr");
  const n = Number(raw);
  return isNaN(n) || n < 0 ? 10 : n;
}

export async function getSpeedToLeadEnabled(): Promise<boolean> {
  const raw = await getSetting("speedToLead.enabled");
  if (!raw) return true; // default ON
  return raw.toLowerCase() !== "false";
}

export async function getRoundRobinEnabled(): Promise<boolean> {
  const raw = await getSetting("roundRobin.enabled");
  if (!raw) return true; // default ON
  return raw.toLowerCase() !== "false";
}
