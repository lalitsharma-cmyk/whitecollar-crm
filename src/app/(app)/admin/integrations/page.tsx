// Admin-only integrations status page.
//
// One-glance health check for every external service the CRM talks to:
//   • Push (Web Push VAPID)
//   • Acefone (telephony)
//   • Resend (email)
//   • WhatsApp (wa.me draft links — no API, always-on)
//   • Cron health (CronRun rows in last 24h, link to /admin/cron-health)
//   • Database (Neon ping + commit SHA)
//
// Status colors:
//   green  = configured + actively used
//   amber  = configured but no recent activity / partial wiring
//   red    = missing required env / down
//
// We deliberately DO NOT make outbound HTTP calls (no Resend ping, no
// Acefone heartbeat). Just env-presence + DB counts. Outbound checks are
// flaky, slow, and can rate-limit us; this page must stay fast.
//
// Cron coverage uses the same 8-cron catalog as /admin/cron-health (kept
// in sync there). "All 8 fired in last 24h" = green, otherwise amber/red.

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { pushEnabled } from "@/lib/push";
import { acefoneEnabled } from "@/lib/acefone";
import { fmtIST12 } from "@/lib/datetime";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Same catalog as /admin/cron-health — kept in sync.
const EXPECTED_CRONS = [
  "morning-reminder",
  "evening-reminder",
  "pre-meeting-reminder",
  "workflows",
  "rescore-all",
  "sync-projects",
  "warm",
  "db-backup",
] as const;

type Status = "green" | "amber" | "red";

interface CardProps {
  title: string;
  emoji: string;
  status: Status;
  statusLabel: string;
  description: string;
  lastActivity?: Date | null;
  lastActivityLabel?: string;
  settingsHref?: string;
  settingsLabel?: string;
}

function StatusCard({
  title, emoji, status, statusLabel, description,
  lastActivity, lastActivityLabel, settingsHref, settingsLabel,
}: CardProps) {
  const chipCls =
    status === "green" ? "chip-new" :
    status === "amber" ? "chip-warm" :
    "chip-hot";
  const borderCls =
    status === "green" ? "border-l-green-500" :
    status === "amber" ? "border-l-amber-500" :
    "border-l-red-500";
  return (
    <div className={`card p-4 border-l-4 ${borderCls} flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-bold text-sm">
          <span className="mr-1">{emoji}</span>
          {title}
        </div>
        <span className={`chip ${chipCls} text-[10px] whitespace-nowrap`}>{statusLabel}</span>
      </div>
      <p className="text-[11px] text-gray-600 leading-snug min-h-[2.4em]">{description}</p>
      <div className="text-[11px] text-gray-500 mt-auto pt-1 border-t border-gray-100">
        {lastActivity
          ? <><b>Last activity:</b> {formatDistanceToNow(lastActivity, { addSuffix: true })}</>
          : lastActivityLabel
            ? <><b>Last activity:</b> {lastActivityLabel}</>
            : <span className="text-gray-400">No activity tracking</span>}
      </div>
      {settingsHref && (
        <Link
          href={settingsHref}
          className="chip chip-lost text-[10px] self-start"
          prefetch={false}
        >
          {settingsLabel ?? "Settings →"}
        </Link>
      )}
    </div>
  );
}

export default async function IntegrationsPage() {
  await requireRole("ADMIN");

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // ── Env probes (cheap, sync-ish) ──────────────────────────────────────
  const pushOn = pushEnabled();
  const acefoneOn = acefoneEnabled();
  const resendKey = !!process.env.RESEND_API_KEY;
  // WhatsApp here is the FREE wa.me draft-link path (src/lib/wa.ts). No env
  // required, never down. We show it as green and surface the per-agent
  // companyWhatsAppNumber coverage as the "activity" signal.
  const waEnabled = true;

  // ── DB probes — all in parallel ───────────────────────────────────────
  const dbPingP = prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`
    .then(() => true)
    .catch(() => false);

  const [
    pushSubCount,
    pushLastSub,
    acefoneMappedUsers,
    waConfiguredAgents,
    waActiveAgents,
    lastEmailAudit,
    emailSentLast24,
    cronsLast24,
    lastCronRun,
    dbOk,
  ] = await Promise.all([
    prisma.pushSubscription.count(),
    prisma.pushSubscription.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.user.count({ where: { acefoneAgentId: { not: null }, active: true } }),
    prisma.user.count({ where: { companyWhatsAppNumber: { not: null }, active: true } }),
    prisma.user.count({ where: { active: true } }),
    // AuditLog tracks "*.email.sent"-style actions (e.g. speedToLead.email.sent).
    prisma.auditLog.findFirst({
      where: { action: { contains: "email" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.auditLog.count({
      where: { action: { contains: "email" }, createdAt: { gte: dayAgo } },
    }),
    prisma.cronRun.findMany({
      where: { startedAt: { gte: dayAgo } },
      distinct: ["name"],
      select: { name: true, startedAt: true },
    }),
    prisma.cronRun.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    dbPingP,
  ]);

  // ── Derive status per integration ─────────────────────────────────────

  // 1. PUSH
  let pushStatus: Status;
  let pushLabel: string;
  if (!pushOn) { pushStatus = "red"; pushLabel = "Missing keys"; }
  else if (pushSubCount === 0) { pushStatus = "amber"; pushLabel = "No subscribers"; }
  else { pushStatus = "green"; pushLabel = `${pushSubCount} sub${pushSubCount === 1 ? "" : "s"}`; }
  const pushDesc = pushOn
    ? `Web Push via VAPID — fires hot-lead + reminder notifications to browsers/PWA. ${pushSubCount} active subscription${pushSubCount === 1 ? "" : "s"}.`
    : "VAPID keys not set (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Push notifications are silently disabled.";

  // 2. ACEFONE
  let aceStatus: Status;
  let aceLabel: string;
  if (!acefoneOn) { aceStatus = "red"; aceLabel = "Disabled"; }
  else if (acefoneMappedUsers === 0) { aceStatus = "amber"; aceLabel = "No agents mapped"; }
  else { aceStatus = "green"; aceLabel = `${acefoneMappedUsers} mapped`; }
  const aceDesc = acefoneOn
    ? `Click-to-call telephony. ${acefoneMappedUsers} of ${waActiveAgents} active agent${waActiveAgents === 1 ? "" : "s"} have an acefoneAgentId.`
    : "ACEFONE_API_KEY or ACEFONE_DID_NUMBER not set. Call-via-Acefone buttons hidden.";

  // 3. RESEND
  let resendStatus: Status;
  let resendLabel: string;
  if (!resendKey) { resendStatus = "red"; resendLabel = "No API key"; }
  else if (emailSentLast24 === 0) { resendStatus = "amber"; resendLabel = "Idle (24h)"; }
  else { resendStatus = "green"; resendLabel = `${emailSentLast24} sent`; }
  const resendDesc = resendKey
    ? `Transactional email via Resend. ${emailSentLast24} email-tagged audit event${emailSentLast24 === 1 ? "" : "s"} in the last 24h.`
    : "RESEND_API_KEY not set. Auto-reports + speed-to-lead emails are skipped.";

  // 4. WHATSAPP — free wa.me draft links, always available
  let waStatus: Status;
  let waLabel: string;
  if (waConfiguredAgents === 0) { waStatus = "amber"; waLabel = "No agent numbers"; }
  else { waStatus = "green"; waLabel = `${waConfiguredAgents} agent${waConfiguredAgents === 1 ? "" : "s"}`; }
  const waDesc = `Free WhatsApp draft links (wa.me) — no API needed. ${waConfiguredAgents} of ${waActiveAgents} active agent${waActiveAgents === 1 ? "" : "s"} have a companyWhatsAppNumber set.`;

  // 5. CRON HEALTH
  const firedNames = new Set(cronsLast24.map((c) => c.name));
  const firedExpected = EXPECTED_CRONS.filter((n) => firedNames.has(n)).length;
  const missing = EXPECTED_CRONS.length - firedExpected;
  let cronStatus: Status;
  let cronLabel: string;
  if (missing === 0) { cronStatus = "green"; cronLabel = "All firing"; }
  else if (missing <= 2) { cronStatus = "amber"; cronLabel = `${missing} missing`; }
  else { cronStatus = "red"; cronLabel = `${missing} missing`; }
  const cronDesc = `${firedExpected} of ${EXPECTED_CRONS.length} expected cron jobs have fired in the last 24h. Drill into /admin/cron-health for per-job timing.`;

  // 6. DATABASE
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);
  const dbStatus: Status = dbOk ? "green" : "red";
  const dbLabel = dbOk ? "Connected" : "Down";
  const dbDesc = dbOk
    ? `Neon Postgres connection healthy. Build ${commit}.`
    : "SELECT 1 ping failed. The database is unreachable — check DATABASE_URL + Neon dashboard.";

  return (
    <>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">🔌 Integrations</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Live status of every external service the CRM talks to.
          </p>
        </div>
        <Link
          href="/admin/integrations"
          prefetch={false}
          className="chip chip-lost text-xs"
        >
          🔄 Refresh
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <StatusCard
          title="Push (Web Push / VAPID)"
          emoji="🔔"
          status={pushStatus}
          statusLabel={pushLabel}
          description={pushDesc}
          lastActivity={pushLastSub?.createdAt ?? null}
          lastActivityLabel={pushLastSub ? undefined : "No subscriptions yet"}
          settingsHref="/help"
          settingsLabel="Push setup docs →"
        />

        <StatusCard
          title="Acefone (telephony)"
          emoji="📞"
          status={aceStatus}
          statusLabel={aceLabel}
          description={aceDesc}
          lastActivityLabel={acefoneOn ? `${acefoneMappedUsers}/${waActiveAgents} agents wired` : "Not configured"}
          settingsHref="/team"
          settingsLabel="Map agents →"
        />

        <StatusCard
          title="Resend (email)"
          emoji="✉️"
          status={resendStatus}
          statusLabel={resendLabel}
          description={resendDesc}
          lastActivity={lastEmailAudit?.createdAt ?? null}
          lastActivityLabel={lastEmailAudit ? undefined : "No email sends logged"}
          settingsHref="/admin/templates"
          settingsLabel="Email templates →"
        />

        <StatusCard
          title="WhatsApp (draft links)"
          emoji="💬"
          status={waStatus}
          statusLabel={waLabel}
          description={waDesc}
          lastActivityLabel="Always available (wa.me)"
          settingsHref="/team"
          settingsLabel="Set agent numbers →"
        />

        <StatusCard
          title="Cron health"
          emoji="⏰"
          status={cronStatus}
          statusLabel={cronLabel}
          description={cronDesc}
          lastActivity={lastCronRun?.startedAt ?? null}
          lastActivityLabel={lastCronRun ? undefined : "Never run"}
          settingsHref="/admin/cron-health"
          settingsLabel="Open cron health →"
        />

        <StatusCard
          title="Database (Neon)"
          emoji="🗄️"
          status={dbStatus}
          statusLabel={dbLabel}
          description={dbDesc}
          lastActivityLabel={dbOk ? `Build ${commit}` : "Ping failed"}
          settingsHref="/admin/health"
          settingsLabel="System health →"
        />
      </div>

      <div className="text-[11px] text-gray-500 pt-2 border-t border-gray-100">
        Last refreshed: {fmtIST12(now)} IST · No outbound calls were made — checks are env-presence + DB counts only.
      </div>
    </>
  );
}
