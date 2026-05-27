// Admin-only health dashboard for /api/cron/* jobs.
//
// Each cron route writes a CronRun row (via src/lib/cronRun.ts) when it
// starts and updates it with OK/ERROR when it finishes. This page lists
// every known cron alongside its last run so Lalit's tech-savvier helpers
// can confirm at a glance that the scheduled jobs are actually firing.
//
// A cron that hasn't run in >25h is shown in red (stale) — most crons run
// daily or more often, so a 25h cutoff catches "nothing fired today".

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { fmtIST12 } from "@/lib/datetime";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Hardcoded catalog of crons we expect to see firing. Order matches the
// readme/spec; expected schedule strings come from vercel.json and
// .github/workflows/cron.yml.
const CRONS: Array<{ name: string; schedule: string; purpose: string }> = [
  { name: "morning-reminder", schedule: "Daily 10:00 IST", purpose: "Daily greeting + today's follow-ups + reports to managers" },
  { name: "evening-reminder", schedule: "Daily 18:00 IST", purpose: "EOD reminder — missed follow-ups + uncalled hot leads" },
  { name: "pre-meeting-reminder", schedule: "Every 5 min", purpose: "30-min meeting + 10-min callback push notifications" },
  { name: "workflows", schedule: "Every 1 min", purpose: "Dispatch due workflow actions (drip campaigns)" },
  { name: "rescore-all", schedule: "Daily 08:30 IST", purpose: "Behavioural re-score of every open lead" },
  { name: "sync-projects", schedule: "Daily", purpose: "Resync projects from whitecollarrealty.com/locations" },
  { name: "warm", schedule: "Every 5 min", purpose: "Keep Neon DB connection warm (avoid scale-to-zero)" },
  { name: "db-backup", schedule: "Nightly", purpose: "JSON snapshot of critical tables (GitHub Actions artifact)" },
];

const STALE_MS = 25 * 60 * 60 * 1000; // 25 hours

function statusChip(run: { status: string; startedAt: Date } | null): { label: string; cls: string } {
  if (!run) return { label: "Never run", cls: "chip-hot" };
  const age = Date.now() - run.startedAt.getTime();
  if (age > STALE_MS) return { label: "Stale", cls: "chip-hot" };
  if (run.status === "ERROR") return { label: "Error", cls: "chip-hot" };
  if (run.status === "RUNNING") return { label: "Running", cls: "chip-warm" };
  if (run.status === "OK") return { label: "OK", cls: "chip-new" };
  return { label: run.status, cls: "chip-lost" };
}

function durationLabel(run: { startedAt: Date; finishedAt: Date | null } | null): string {
  if (!run) return "—";
  if (!run.finishedAt) return "in progress";
  const ms = run.finishedAt.getTime() - run.startedAt.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export default async function CronHealthPage() {
  await requireRole("ADMIN");

  // Last run per cron, in parallel.
  const rows = await Promise.all(
    CRONS.map(async (c) => {
      const last = await prisma.cronRun.findFirst({
        where: { name: c.name },
        orderBy: { startedAt: "desc" },
      });
      return { ...c, last };
    }),
  );

  const staleCount = rows.filter((r) => {
    if (!r.last) return true;
    return Date.now() - r.last.startedAt.getTime() > STALE_MS || r.last.status === "ERROR";
  }).length;

  return (
    <>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">🩺 Cron Health</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Last-run status of every scheduled job. {staleCount > 0
              ? <span className="text-red-600 font-medium">{staleCount} cron{staleCount === 1 ? "" : "s"} need attention.</span>
              : <span className="text-green-600 font-medium">All systems green.</span>}
          </p>
        </div>
        <Link
          href="/admin/cron-health"
          prefetch={false}
          className="chip chip-lost text-xs"
        >🔄 Refresh</Link>
      </div>

      {/* MOBILE: card list */}
      <div className="lg:hidden space-y-2">
        {rows.map((r) => {
          const chip = statusChip(r.last);
          return (
            <div key={r.name} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="font-mono text-sm font-semibold">{r.name}</div>
                <span className={`chip ${chip.cls} text-[10px]`}>{chip.label}</span>
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">{r.schedule} · {r.purpose}</div>
              <div className="text-xs mt-2">
                <b>Last run:</b>{" "}
                {r.last
                  ? <>{fmtIST12(r.last.startedAt)} IST <span className="text-gray-500">({formatDistanceToNow(r.last.startedAt, { addSuffix: true })})</span></>
                  : <span className="text-red-600">never</span>}
              </div>
              <div className="text-xs text-gray-600">
                <b>Duration:</b> {durationLabel(r.last)}
              </div>
              {r.last?.error && (
                <pre className="text-[10px] text-red-700 mt-1 whitespace-pre-wrap break-all font-mono bg-red-50 p-2 rounded max-h-32 overflow-y-auto">{r.last.error}</pre>
              )}
            </div>
          );
        })}
      </div>

      {/* DESKTOP: table */}
      <div className="card overflow-x-auto hidden lg:block">
        <table className="tbl min-w-[920px]">
          <thead>
            <tr>
              <th>Cron name</th>
              <th>Expected schedule</th>
              <th>Last run</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Last error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const chip = statusChip(r.last);
              const isStale = !r.last || Date.now() - r.last.startedAt.getTime() > STALE_MS;
              return (
                <tr key={r.name} className={isStale ? "bg-red-50" : ""}>
                  <td className="text-xs font-mono font-semibold">
                    {r.name}
                    <div className="text-[10px] text-gray-500 font-sans font-normal">{r.purpose}</div>
                  </td>
                  <td className="text-xs whitespace-nowrap">{r.schedule}</td>
                  <td className="text-xs whitespace-nowrap">
                    {r.last ? (
                      <>
                        {fmtIST12(r.last.startedAt)} IST
                        <div className="text-[10px] text-gray-500">{formatDistanceToNow(r.last.startedAt, { addSuffix: true })}</div>
                      </>
                    ) : (
                      <span className="text-red-600 font-medium">never</span>
                    )}
                  </td>
                  <td className="text-xs whitespace-nowrap">{durationLabel(r.last)}</td>
                  <td><span className={`chip ${chip.cls} text-[10px]`}>{chip.label}</span></td>
                  <td>
                    {r.last?.error && (
                      <pre className="text-[10px] text-red-700 whitespace-pre-wrap break-all font-mono max-w-md max-h-24 overflow-y-auto">{r.last.error}</pre>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
