// ─────────────────────────────────────────────────────────────────────────────
// Sales follow-up auto-rollover (Lalit, 2026-06-21).
//
// Run nightly ~11 PM IST (end of the working day, via the /api/cron/warm heartbeat) so
// today's still-open follow-ups are never bumped early. Any SALES lead whose follow-up date is today-or-earlier
// (IST) and is still pending gets its follow-up moved to the NEXT calendar day
// (same IST time-of-day), so stale dates never pile up when an agent forgets to
// reschedule. Example (today = 20 Jun): follow-ups on 18/19/20 Jun → 21 Jun.
//
// NEVER touched: closed leads, rejected/lost leads, deleted / recycle-bin leads,
// leads with no follow-up date, and HR data (HR lives in separate models — the
// Lead table is sales-only). Remarks / conversation history are never modified.
// Every move is recorded in LeadFieldHistory (source = "system-rollover").
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";

const IST = 330 * 60 * 1000; // +05:30

function fmtIST(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
}

export interface RolloverResult {
  moved: number;
  cutoffISO: string;   // start of tomorrow IST (UTC instant) — everything before this moved
  targetDateLabel: string;
  examples: { id: string; name: string | null; from: string; to: string }[];
  dryRun: boolean;
}

/**
 * Move every pending, today-or-earlier sales follow-up to tomorrow (IST).
 * @param now   injected for testability.
 * @param opts.dryRun  when true, computes + returns the plan WITHOUT writing.
 */
export async function runFollowupRollover(now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<RolloverResult> {
  const dryRun = !!opts.dryRun;

  // IST "today" → start of tomorrow IST as a UTC instant (the cutoff).
  const istShiftedNow = new Date(now.getTime() + IST);
  const istMidnightShifted = new Date(istShiftedNow); istMidnightShifted.setUTCHours(0, 0, 0, 0);
  const startOfTomorrowUTC = new Date(istMidnightShifted.getTime() + 24 * 3600 * 1000 - IST);
  // Tomorrow's IST calendar components (to rebuild the target keeping time-of-day).
  const tomorrowShifted = new Date(istMidnightShifted.getTime() + 24 * 3600 * 1000);
  const tY = tomorrowShifted.getUTCFullYear(), tM = tomorrowShifted.getUTCMonth(), tD = tomorrowShifted.getUTCDate();

  // Pending, today-or-earlier follow-ups on live, non-terminal sales leads.
  const leads = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      followupDate: { not: null, lt: startOfTomorrowUTC },
      currentStatus: { notIn: TERMINAL_STATUSES },
    },
    select: { id: true, name: true, followupDate: true },
  });

  const targetLabelExample = fmtIST(new Date(Date.UTC(tY, tM, tD, 6, 30) ));
  const examples: RolloverResult["examples"] = [];
  let moved = 0;

  for (const l of leads) {
    const old = l.followupDate!;
    // Keep the original IST time-of-day, on tomorrow's IST date.
    const oldIST = new Date(old.getTime() + IST);
    const target = new Date(Date.UTC(tY, tM, tD, oldIST.getUTCHours(), oldIST.getUTCMinutes(), oldIST.getUTCSeconds()) - IST);

    if (examples.length < 12) examples.push({ id: l.id, name: l.name, from: fmtIST(old), to: fmtIST(target) });
    if (dryRun) { moved++; continue; }

    try {
      await prisma.$transaction([
        // followupReminderSentAt reset → the ~10-min callback reminder re-arms for the new date.
        prisma.lead.update({ where: { id: l.id }, data: { followupDate: target, followupReminderSentAt: null } }),
        prisma.leadFieldHistory.create({
          data: { leadId: l.id, field: "followupDate", oldValue: old.toISOString(), newValue: target.toISOString(), changedById: null, source: "system-rollover" },
        }),
      ]);
      moved++;
    } catch {
      // skip a single bad row; the sweep continues
    }
  }

  return { moved, cutoffISO: startOfTomorrowUTC.toISOString(), targetDateLabel: targetLabelExample, examples, dryRun };
}
