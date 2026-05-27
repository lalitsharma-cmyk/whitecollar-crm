// Daily DB backup — emits a single JSON snapshot of critical tables.
//
// Auth: bearer CRON_SECRET. Hit nightly by the GitHub Actions cron
// (.github/workflows/cron.yml — db_backup job) which curls this endpoint
// to a file and uploads it as a workflow artifact (free, 90d retention).
//
// Privacy:
//   - NEVER includes User.passwordHash.
//   - NEVER includes VaultEntry.content (private agent journal — see schema notes).
//     Only the meta (kind / mood / userId / createdAt) is exported so the admin
//     still has a recoverable shell if restoring from backup, without leaking
//     anyone's private journal text into a downloaded JSON file.
//
// Time budget:
//   Vercel Hobby route default = 10s, can stretch to 30s. We cap maxDuration
//   at 30 and throttle the noisy append-only tables (Activity, CallLog) to
//   the last 90 days by default. Pass `?days=N` to override (admin manually).
//   Use `?days=0` to dump everything (only run from a long-running env).
//
// Why $queryRaw for the big tables:
//   Prisma's row-mapping adds non-trivial per-row overhead. The raw SQL path
//   returns plain objects ~3-4x faster on the append-only tables that
//   dominate row count (Activity, CallLog, Note).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
// Hobby plan: 30s ceiling for non-Pro accounts. Stay under it.
export const maxDuration = 30;

// BigInt isn't valid JSON. Coerce any bigint values (e.g. COUNT(*)::bigint)
// to Number so JSON.stringify doesn't throw. Safe for table sizes we expect.
function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
  ) as T;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  // Default 90d for append-only tables. `days=0` means "no cutoff".
  const days =
    daysParam === null
      ? 90
      : Math.max(0, Math.min(3650, Number.parseInt(daysParam, 10) || 0));
  const cutoff = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

  // ── Tables that are bounded in size: fetch the whole thing via Prisma. ──
  const [users, projects, units, leads, notes, vaultEntries] = await Promise.all([
    // User — strip passwordHash entirely.
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        team: true,
        phone: true,
        acefoneAgentId: true,
        companyWhatsAppNumber: true,
        photoUrl: true,
        managerId: true,
        avatarColor: true,
        active: true,
        xp: true,
        dailyStreak: true,
        followupStreak: true,
        coldCallStreak: true,
        lastStreakDay: true,
        badges: true,
        specializations: true,
        dailyCallTarget: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.project.findMany(),
    prisma.unit.findMany(),
    prisma.lead.findMany(),
    prisma.note.findMany(),
    // VaultEntry — meta only, NEVER the `content` field.
    prisma.vaultEntry.findMany({
      select: {
        id: true,
        userId: true,
        kind: true,
        mood: true,
        // content: OMITTED — see privacy note at top of file.
        tags: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
  ]);

  // ── Append-only tables that dominate row count: raw SQL + optional cutoff. ──
  // Using $queryRaw keeps Prisma's row-mapping out of the hot path.
  const activities = cutoff
    ? await prisma.$queryRaw<unknown[]>`
        SELECT * FROM "Activity" WHERE "createdAt" >= ${cutoff} ORDER BY "createdAt" DESC
      `
    : await prisma.$queryRaw<unknown[]>`
        SELECT * FROM "Activity" ORDER BY "createdAt" DESC
      `;

  const callLogs = cutoff
    ? await prisma.$queryRaw<unknown[]>`
        SELECT * FROM "CallLog" WHERE "startedAt" >= ${cutoff} ORDER BY "startedAt" DESC
      `
    : await prisma.$queryRaw<unknown[]>`
        SELECT * FROM "CallLog" ORDER BY "startedAt" DESC
      `;

  const generatedAt = new Date().toISOString();
  const datePart = generatedAt.slice(0, 10); // YYYY-MM-DD

  const payload = jsonSafe({
    generatedAt,
    schemaVersion: 1,
    cutoffDays: days,
    cutoff: cutoff ? cutoff.toISOString() : null,
    userCount: users.length,
    projectCount: projects.length,
    unitCount: units.length,
    leadCount: leads.length,
    noteCount: notes.length,
    vaultEntryCount: vaultEntries.length,
    activityCount: activities.length,
    callLogCount: callLogs.length,
    tables: {
      users,
      projects,
      units,
      leads,
      notes,
      vaultEntries,
      activities,
      callLogs,
    },
  });

  const body = JSON.stringify(payload);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="wcr-backup-${datePart}.json"`,
      "cache-control": "no-store",
    },
  });
}
