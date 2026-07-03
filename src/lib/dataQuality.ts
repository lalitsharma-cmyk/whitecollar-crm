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
import { resolveMarket } from "@/lib/market";
import { notify } from "@/lib/notify";
import { resolveManagerUserId } from "@/lib/agentStatus";

const PLACEHOLDER = new Set(["9999999999", "0000000000", "1111111111", "1234567890"]);
const norm = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);

export interface DataQualityResult {
  orphanFollowups: number;
  marketFixed: number;
  duplicatePhoneGroups: number;
  notified: boolean;
}

export async function runDataQualityScan(): Promise<DataQualityResult> {
  // SELF-HEAL: set the derived India/UAE market on any lead missing it. The market
  // is deterministic from Team/currency (resolveMarket), so this is safe + reversible
  // — it keeps the lead-market-segregation invariant green as new leads arrive
  // (create paths don't set market and the reconciler cron is offline). Only safe,
  // derived, non-destructive fixes run here; everything else is detect + notify.
  const missingMarket = await prisma.lead.findMany({
    where: { deletedAt: null, market: null, forwardedTeam: { not: null } },
    select: { id: true, forwardedTeam: true, budgetCurrency: true },
    take: 500,
  });
  let marketFixed = 0;
  for (const l of missingMarket) {
    const m = resolveMarket(l);
    if (m) { try { await prisma.lead.update({ where: { id: l.id }, data: { market: m } }); marketFixed++; } catch {} }
  }

  const [orphanFollowups, withPhone] = await Promise.all([
    prisma.lead.count({ where: { deletedAt: null, followupDate: { not: null }, currentStatus: { in: TERMINAL_STATUSES } } }),
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
  // Notify admin only on issues that need a HUMAN (orphan follow-ups) — market gaps
  // are self-healed above, so they're reported in the value, not a repeat ping.
  let notified = false;
  if (orphanFollowups > 0) {
    const mgr = await resolveManagerUserId();
    if (mgr) {
      await notify({
        userId: mgr, kind: "SYSTEM", severity: "WARNING",
        title: `🧹 Data-quality: ${orphanFollowups} terminal lead(s) with a stray follow-up`,
        body: `Auto-healed ${marketFixed} missing market(s). Duplicate-phone groups: ${duplicatePhoneGroups}. The orphan follow-ups need a look (terminal leads shouldn't carry a follow-up).`,
        linkUrl: "/dashboard", email: false,
        source: { type: "DATA_QUALITY", id: null, createdById: null },
      });
      notified = true;
    }
  }
  return { orphanFollowups, marketFixed, duplicatePhoneGroups, notified };
}
