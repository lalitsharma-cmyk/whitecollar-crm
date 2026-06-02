// Revival engine — Agent I.
//
// Re-discovers leads that *were* hot, then went cold (no contact / no signal),
// and now in the last 24h have a new inbound signal worth a sales-rep's attention.
//
// Logic:
//   1. Find candidate leads matching:
//        - lead.aiScore = COLD now
//        - had been HOT at any point (we infer this from the AI re-score
//          STATUS_CHANGE activity titles created by rescoreLead — they look
//          like "🤖 AI re-score: 75 → 32 (HOT → COLD)")
//        - new inbound signal in the last 24h:
//            * any WhatsAppMessage with direction = INBOUND, receivedAt ≥ 24h,
//            * OR any CallLog with outcome = CONNECTED, startedAt ≥ 24h
//   2. Bump aiScore back to WARM (NOT HOT — let the next behavioural rescore
//      decide; we don't want a single inbound WA to fake HOT).
//   3. Create a REMINDER notification for the lead owner.
//   4. Audit-log `lead.revival_triggered` so we can measure how often this
//      pattern fires and tune the heuristics.
//
// Called by the daily /api/cron/revival-sweep route.

import "server-only";
import { prisma } from "@/lib/prisma";
import { AIScore, CallOutcome, WAMessageDirection } from "@prisma/client";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";

export interface RevivalSweepResult {
  scanned: number;
  revived: number;
  revivedLeadIds: string[];
}

const DAY = 24 * 60 * 60 * 1000;

export async function runRevivalSweep(): Promise<RevivalSweepResult> {
  const since = new Date(Date.now() - DAY);

  // 1. Find currently-COLD leads that have a fresh inbound signal in the last 24h.
  //    We over-fetch lightly and then filter by "was HOT in the past" below.
  const coldLeadsWithSignal = await prisma.lead.findMany({
    where: {
      aiScore: AIScore.COLD,
      OR: [
        {
          waMessages: {
            some: { direction: WAMessageDirection.INBOUND, receivedAt: { gte: since } },
          },
        },
        {
          callLogs: {
            some: { outcome: CallOutcome.CONNECTED, startedAt: { gte: since } },
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      ownerId: true,
      aiScoreValue: true,
    },
  });

  let scanned = 0;
  const revivedLeadIds: string[] = [];

  for (const lead of coldLeadsWithSignal) {
    scanned++;

    // 2. Was this lead EVER HOT? We look at the AI rescorer's STATUS_CHANGE
    //    activity trail. rescoreLead writes titles like "🤖 AI re-score: 75 →
    //    32 (HOT → COLD)" — if "HOT" appears anywhere in the title history,
    //    we count it as ever-HOT.
    const wasEverHot = await prisma.activity.findFirst({
      where: {
        leadId: lead.id,
        type: "STATUS_CHANGE",
        title: { contains: "HOT" },
      },
      select: { id: true },
    });
    if (!wasEverHot) continue;

    // 3. Bump aiScore COLD → WARM. We don't touch aiScoreValue (let the next
    //    full rescore set that with full provenance).
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        aiScore: AIScore.WARM,
        aiUpdatedAt: new Date(),
      },
    });

    // 4. Activity row so the lead detail timeline shows the revival.
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: "STATUS_CHANGE",
        status: "DONE",
        title: `🔄 Revival: was COLD, fresh inbound signal — bumped to WARM`,
        completedAt: new Date(),
      },
    });

    // 5. Notify the owner if there is one.
    if (lead.ownerId) {
      try {
        await notify({
          userId: lead.ownerId,
          kind: "REMINDER",
          severity: "INFO",
          title: `🔄 ${lead.name} re-engaged — was cold, now responsive`,
          body: `New inbound signal in the last 24h. Reach out today.`,
          linkUrl: `/leads/${lead.id}`,
          leadId: lead.id,
        });
      } catch (e) {
        console.warn("[revivalEngine] notify failed for", lead.id, e);
      }
    }

    // 6. Audit log entry.
    await audit({
      action: "lead.revival_triggered",
      entity: "Lead",
      entityId: lead.id,
      meta: { previousScoreValue: lead.aiScoreValue },
    });

    revivedLeadIds.push(lead.id);
  }

  return { scanned, revived: revivedLeadIds.length, revivedLeadIds };
}
