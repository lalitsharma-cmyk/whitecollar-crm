// Workflow engine — fires actions when triggers match.
//
// Two entry points:
//   fireWorkflowTrigger(trigger, leadId, eventData?) — call this from your
//     business code (e.g. after creating a lead). It finds matching active
//     Workflows, evaluates each Workflow's filterQuery against the lead, and
//     queues every action as a WorkflowRun (immediate or delayed).
//
//   dispatchDuePendingActions() — called by a cron every minute. Picks up all
//     PENDING runs whose runAt <= now() and executes them. Idempotent.
//
// Action execution is in this same file (executeAction()) so the engine has
// one place to read.

import { prisma } from "@/lib/prisma";
import { WorkflowTrigger, WorkflowActionType, WorkflowRunStatus, Prisma } from "@prisma/client";
import { renderTemplate } from "@/lib/templates";
import { audit } from "@/lib/audit";
import { notify, notifyRoles } from "@/lib/notify";
import { sendAfterHoursWelcome } from "@/lib/whatsappOutbound";

type EventData = Record<string, unknown>;

/**
 * Called from business code to signal that a trigger event happened.
 * Fire-and-forget: callers wrap with `.catch(() => {})` so workflow failures
 * never break the user action.
 */
export async function fireWorkflowTrigger(
  trigger: WorkflowTrigger,
  leadId: string,
  eventData: EventData = {},
): Promise<void> {
  const workflows = await prisma.workflow.findMany({
    where: { trigger, active: true },
    include: { actions: { orderBy: { sequenceOrder: "asc" } } },
  });
  if (workflows.length === 0) return;

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  const now = new Date();
  const eventTs = now.getTime();

  for (const wf of workflows) {
    // Check filterQuery — applies only if lead matches
    if (wf.filterQuery && !leadMatchesQuery(lead, wf.filterQuery)) continue;
    // Check trigger-specific config (e.g. STATUS_CHANGED { to: "QUALIFIED" })
    if (!triggerConfigMatches(wf.trigger, wf.triggerConfig, eventData)) continue;

    // Has THIS workflow already fired for THIS lead? (idempotency for one-shot triggers)
    const masterKey = `${wf.id}:${leadId}:master`;
    const existingMaster = await prisma.workflowRun.findUnique({ where: { dedupeKey: masterKey } });
    if (existingMaster && isOnceOnlyTrigger(wf.trigger)) continue;

    // Mark workflow as fired (master run)
    if (!existingMaster) {
      await prisma.workflowRun.create({
        data: {
          workflowId: wf.id, leadId, runAt: now,
          status: WorkflowRunStatus.DONE,
          startedAt: now, finishedAt: now,
          dedupeKey: masterKey,
        },
      });
    }

    // Queue every action
    for (const a of wf.actions) {
      const runAt = new Date(eventTs + a.delayMinutes * 60_000);
      const dedupeKey = a.delayMinutes === 0
        ? `${wf.id}:${leadId}:${a.id}`
        : `${wf.id}:${leadId}:${a.id}:${eventTs}`;
      try {
        const run = await prisma.workflowRun.create({
          data: { workflowId: wf.id, actionId: a.id, leadId, runAt, status: WorkflowRunStatus.PENDING, dedupeKey },
        });
        // If immediate, execute right now (still asynchronously)
        if (a.delayMinutes === 0) {
          executeRun(run.id).catch(() => {});
        }
      } catch {
        // Unique-constraint violation = already queued/run, fine
      }
    }
  }
}

/** Run all PENDING actions whose runAt <= now. Called by /api/cron/workflows. */
export async function dispatchDuePendingActions(): Promise<{ dispatched: number; failed: number }> {
  const due = await prisma.workflowRun.findMany({
    where: { status: WorkflowRunStatus.PENDING, runAt: { lte: new Date() }, actionId: { not: null } },
    take: 100,
    orderBy: { runAt: "asc" },
  });
  let dispatched = 0, failed = 0;
  for (const r of due) {
    try {
      await executeRun(r.id);
      dispatched++;
    } catch {
      failed++;
    }
  }
  return { dispatched, failed };
}

/** Execute a single WorkflowRun. Marks it RUNNING → DONE / FAILED. */
async function executeRun(runId: string): Promise<void> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: { action: true },
  });
  if (!run || !run.action) return;
  if (run.status !== WorkflowRunStatus.PENDING) return; // already handled

  // Mark RUNNING
  await prisma.workflowRun.update({ where: { id: runId }, data: { status: WorkflowRunStatus.RUNNING, startedAt: new Date() } });

  try {
    await executeAction(run.action.type, run.action.config, run.leadId);
    await prisma.workflowRun.update({
      where: { id: runId },
      data: { status: WorkflowRunStatus.DONE, finishedAt: new Date() },
    });
  } catch (e) {
    await prisma.workflowRun.update({
      where: { id: runId },
      data: { status: WorkflowRunStatus.FAILED, finishedAt: new Date(), error: String(e).slice(0, 500) },
    });
    throw e;
  }
}

/** The action dispatch table. Add new action types here. */
async function executeAction(type: WorkflowActionType, configJson: string, leadId: string): Promise<void> {
  const config: Record<string, unknown> = (configJson ? safeJson(configJson) : null) ?? {};
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { owner: true, interestedUnits: { include: { unit: { include: { project: true } } }, take: 1 } },
  });
  if (!lead) return;
  const project = lead.interestedUnits[0]?.unit.project ?? null;
  const agent = lead.owner ?? (await prisma.user.findFirst({ where: { role: "ADMIN" } }));
  const ctx = { lead, agent: agent ?? { name: "White Collar Realty", email: "", companyWhatsAppNumber: null }, project };

  switch (type) {
    case "SEND_WA": {
      const tplId = String(config.templateId ?? "");
      const tpl = tplId ? await prisma.template.findUnique({ where: { id: tplId } }) : null;
      if (!tpl || tpl.kind !== "WHATSAPP" || !lead.phone) return;
      const body = renderTemplate(tpl.body, ctx);
      await sendAfterHoursWelcome(leadId, lead.phone, lead.name); // reuses stub/real sender pattern
      await prisma.activity.create({
        data: { leadId, userId: agent?.id, type: "WHATSAPP", status: "DONE",
          title: `🤖 Workflow WA: ${tpl.name}`, description: body, completedAt: new Date() },
      });
      return;
    }
    case "SEND_EMAIL": {
      const tplId = String(config.templateId ?? "");
      const tpl = tplId ? await prisma.template.findUnique({ where: { id: tplId } }) : null;
      if (!tpl || tpl.kind !== "EMAIL" || !lead.email) return;
      const RESEND_KEY = process.env.RESEND_API_KEY;
      const RESEND_FROM = process.env.RESEND_FROM ?? `WCR CRM <noreply@crm.whitecollarrealty.com>`;
      const subject = tpl.subject ? renderTemplate(tpl.subject, ctx) : "Following up";
      const text = renderTemplate(tpl.body, ctx);
      if (RESEND_KEY) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: RESEND_FROM, to: [lead.email], subject, text }),
        });
      }
      await prisma.activity.create({
        data: { leadId, userId: agent?.id, type: "EMAIL", status: "DONE",
          title: `🤖 Workflow email: ${tpl.name}`,
          description: `Subject: ${subject}\n\n${text.slice(0, 400)}`,
          completedAt: new Date() },
      });
      return;
    }
    case "CREATE_TASK": {
      const title = String(config.title ?? "Workflow follow-up");
      const dueInMinutes = Number(config.dueInMinutes ?? 60);
      await prisma.activity.create({
        data: { leadId, userId: lead.ownerId, type: "TASK", status: "PLANNED",
          title: `🤖 ${title}`,
          scheduledAt: new Date(Date.now() + dueInMinutes * 60_000) },
      });
      return;
    }
    case "NOTIFY_ADMIN": {
      const message = String(config.message ?? `Workflow alert on lead ${lead.name}`);
      await notifyRoles(["ADMIN", "MANAGER"], {
        kind: "REMINDER", severity: "WARNING",
        title: `🤖 ${message}`,
        body: `Lead: ${lead.name} (${lead.phone ?? lead.email ?? "—"})`,
        linkUrl: `/leads/${leadId}`, leadId,
      });
      return;
    }
    case "NOTIFY_OWNER": {
      if (!lead.ownerId) return;
      const message = String(config.message ?? `Workflow alert on ${lead.name}`);
      await notify({
        userId: lead.ownerId,
        kind: "REMINDER", severity: "INFO",
        title: `🤖 ${message}`,
        body: `Lead: ${lead.name}`,
        linkUrl: `/leads/${leadId}`, leadId,
      });
      return;
    }
    case "SET_FIELD": {
      const field = String(config.field ?? "");
      const value = config.value ?? null;
      const ALLOWED_FIELDS = new Set(["status", "currentStatus", "todoNext", "needsManagerReview", "categorization"]);
      if (!ALLOWED_FIELDS.has(field)) return;
      await prisma.lead.update({ where: { id: leadId }, data: { [field]: value } as never });
      return;
    }
    case "ADD_TAG": {
      const tag = String(config.tag ?? "").trim();
      if (!tag) return;
      const existing = (lead.tags ?? "").split(",").map(s => s.trim()).filter(Boolean);
      if (!existing.includes(tag)) {
        await prisma.lead.update({ where: { id: leadId }, data: { tags: [...existing, tag].join(",") } });
      }
      return;
    }
  }
}

// ── trigger-config matching ──────────────────────────────────────────

function triggerConfigMatches(trigger: WorkflowTrigger, configJson: string | null, event: EventData): boolean {
  if (!configJson) return true;
  const cfg = safeJson(configJson);
  if (typeof cfg !== "object" || cfg === null) return true;

  switch (trigger) {
    case "STATUS_CHANGED": {
      const want = (cfg as { to?: string }).to;
      if (want && event.newStatus !== want) return false;
      return true;
    }
    case "BANT_CHANGED": {
      const want = (cfg as { to?: string }).to;
      if (want && event.newBant !== want) return false;
      return true;
    }
    default:
      return true;
  }
}

function isOnceOnlyTrigger(trigger: WorkflowTrigger): boolean {
  return trigger === "LEAD_CREATED" || trigger === "COLD_PROMOTED";
}

// ── tiny lead-query matcher (subset of /leads filters) ───────────────

function leadMatchesQuery(lead: { team?: string | null; forwardedTeam?: string | null; aiScore?: string | null; status?: string; isColdCall?: boolean }, qs: string): boolean {
  const p = new URLSearchParams(qs);
  if (p.get("team") && lead.forwardedTeam !== p.get("team")) return false;
  if (p.get("ai") && lead.aiScore !== p.get("ai")) return false;
  if (p.get("status") && lead.status !== p.get("status")) return false;
  return true;
}

function safeJson(s: string): Record<string, unknown> | null {
  try { const j = JSON.parse(s); return typeof j === "object" ? j : null; } catch { return null; }
}
