// READ-ONLY — check 9 corrected. Delete after use.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const out: Record<string, unknown> = {};
  const clTotal = await prisma.callLog.count();
  // startedAt is non-nullable in schema (default now()). Confirm none are epoch-zero / absurd.
  const clOldest = await prisma.callLog.findFirst({ orderBy: { startedAt: "asc" }, select: { id: true, startedAt: true } });
  const clNewest = await prisma.callLog.findFirst({ orderBy: { startedAt: "desc" }, select: { id: true, startedAt: true } });
  // durationSec negative or absurd
  const clNegDur = await prisma.callLog.count({ where: { durationSec: { lt: 0 } } });
  // endedAt before startedAt (impossible)
  const withEnded = await prisma.callLog.findMany({ where: { endedAt: { not: null } }, select: { id: true, startedAt: true, endedAt: true } });
  const endedBeforeStart = withEnded.filter(c => c.endedAt && c.endedAt < c.startedAt);
  out.callLog = { total: clTotal, oldest: clOldest, newest: clNewest, negativeDuration: clNegDur, endedBeforeStarted: { count: endedBeforeStart.length, samples: endedBeforeStart.slice(0, 5).map(x => x.id) } };

  const actTotal = await prisma.activity.count();
  // ActivityStatus enum = PLANNED | DONE | OVERDUE | CANCELLED
  const doneNoTs = await prisma.activity.count({ where: { status: "DONE", completedAt: null } });
  const doneNoTsS = await prisma.activity.findMany({ where: { status: "DONE", completedAt: null }, select: { id: true, type: true, title: true, createdAt: true }, take: 5 });
  // completedAt set but status not DONE
  const tsNotDone = await prisma.activity.count({ where: { completedAt: { not: null }, NOT: { status: "DONE" } } });
  // noShow but marked DONE
  const noShowDone = await prisma.activity.count({ where: { isNoShow: true, status: "DONE" } });
  // endedAt before startedAt on visits
  const actEnded = await prisma.activity.findMany({ where: { endedAt: { not: null }, startedAt: { not: null } }, select: { id: true, startedAt: true, endedAt: true } });
  const actEndedBefore = actEnded.filter(a => a.endedAt && a.startedAt && a.endedAt < a.startedAt);
  out.activity = { total: actTotal, doneNoCompletedAt: { count: doneNoTs, samples: doneNoTsS }, completedAtButNotDone: tsNotDone, noShowButDone: noShowDone, endedBeforeStarted: { count: actEndedBefore.length, samples: actEndedBefore.slice(0, 5).map(x => x.id) } };

  console.log(JSON.stringify(out, null, 2));
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
