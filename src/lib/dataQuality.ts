import "server-only";
// Data-quality scan (Lalit-approved safe cron, 2026-07-02). DETECT + NOTIFY only —
// it never mutates production data (per the cron-safety rule during acceptance
// testing). Surfaces: terminal leads still carrying a follow-up (should be cleared
// on the status-change/import path), live leads missing India/UAE market, and
// duplicate real phone numbers. Notifies the manager (Lalit) only when a real
// anomaly appears — chronic dup-phone noise doesn't spam. Part of the self-healing
// CRM direction (detect → notify → a human/one-time script fixes).

import { prisma } from "@/lib/prisma";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";
import { notify } from "@/lib/notify";
import { resolveManagerUserId } from "@/lib/agentStatus";

const PLACEHOLDER = new Set(["9999999999", "0000000000", "1111111111", "1234567890"]);
const norm = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);

export interface DataQualityResult {
  orphanFollowups: number;
  marketNull: number;
  duplicatePhoneGroups: number;
  notified: boolean;
}

export async function runDataQualityScan(): Promise<DataQualityResult> {
  const [orphanFollowups, marketNull, withPhone] = await Promise.all([
    prisma.lead.count({ where: { deletedAt: null, followupDate: { not: null }, currentStatus: { in: TERMINAL_STATUSES } } }),
    prisma.lead.count({ where: { deletedAt: null, currentStatus: { notIn: TERMINAL_STATUSES }, market: null } }),
    prisma.lead.findMany({ where: { deletedAt: null, phone: { not: null } }, select: { phone: true } }),
  ]);

  const counts = new Map<string, number>();
  for (const l of withPhone) {
    const k = norm(l.phone);
    if (k.length < 10 || PLACEHOLDER.has(k)) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const duplicatePhoneGroups = [...counts.values()].filter((v) => v > 1).length;

  // Notify only on actionable anomalies (orphan follow-ups or market drift). Dup
  // phones are chronic + need human merge — surfaced in the value, not a repeat ping.
  let notified = false;
  if (orphanFollowups > 0 || marketNull > 0) {
    const mgr = await resolveManagerUserId();
    if (mgr) {
      const issues = [
        orphanFollowups > 0 ? `${orphanFollowups} terminal lead(s) with a stray follow-up` : null,
        marketNull > 0 ? `${marketNull} live lead(s) missing India/UAE market` : null,
      ].filter(Boolean).join(" · ");
      await notify({
        userId: mgr, kind: "SYSTEM", severity: "WARNING",
        title: `🧹 Data-quality scan flagged an issue`,
        body: `${issues}. (Duplicate-phone groups: ${duplicatePhoneGroups}.) Read-only scan — nothing was changed.`,
        linkUrl: "/dashboard", email: false,
      });
      notified = true;
    }
  }
  return { orphanFollowups, marketNull, duplicatePhoneGroups, notified };
}
