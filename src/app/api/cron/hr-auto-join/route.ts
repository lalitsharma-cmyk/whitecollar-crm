// HR auto-join — daily. Flips candidates EXPECTED_JOINING → JOINED once their
// joiningDate (IST) has been reached, and logs a CANDIDATE_JOINED activity so the
// timeline + reports reflect it. Idempotent: only EXPECTED_JOINING rows with a
// past/today joiningDate move; re-running is a no-op. Reversible — a recruiter can
// set the status back if a candidate didn't actually join.
//
// Auth: bearer CRON_SECRET (same pattern as every other /api/cron route).
// ?dryRun=1 returns the plan (count + sample) WITHOUT writing — for verification.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Start of tomorrow in IST, expressed as a UTC Date. A joiningDate < this means
 *  the joining day is today or earlier, regardless of the time-of-day it was stored. */
function startOfTomorrowIST(now: Date): Date {
  const IST = 5.5 * 3600 * 1000;
  const ist = new Date(now.getTime() + IST);
  const tomorrowMidnightUTCms = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1, 0, 0, 0);
  return new Date(tomorrowMidnightUTCms - IST);
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const cutoff = startOfTomorrowIST(new Date());

  const runId = await startCronRun("hr-auto-join");
  try {
    const due = await prisma.hRCandidate.findMany({
      where: { status: "EXPECTED_JOINING", deletedAt: null, joiningDate: { not: null, lt: cutoff } },
      select: { id: true, name: true, joiningDate: true, primaryOwnerId: true },
    });

    if (dryRun) {
      await finishCronRun(runId, "OK", undefined, { wouldJoin: due.length, dryRun: true });
      return NextResponse.json({ ok: true, dryRun: true, wouldJoin: due.length, sample: due.slice(0, 10).map(d => ({ name: d.name, joiningDate: d.joiningDate })) });
    }

    let joined = 0;
    for (const c of due) {
      await prisma.$transaction([
        prisma.hRCandidate.update({ where: { id: c.id }, data: { status: "JOINED" } }),
        prisma.hRActivity.create({
          data: {
            candidateId: c.id,
            userId: c.primaryOwnerId ?? null,
            type: "CANDIDATE_JOINED",
            oldStatus: "EXPECTED_JOINING",
            newStatus: "JOINED",
            notes: "Auto-marked Joined — expected joining date reached.",
          },
        }),
      ]);
      joined += 1;
    }

    await finishCronRun(runId, "OK", undefined, { joined });
    return NextResponse.json({ ok: true, joined });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}
