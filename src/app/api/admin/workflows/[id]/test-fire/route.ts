// Admin "🧪 Test fire" endpoint — dry-run (default) or actually execute a
// workflow against a specific lead BEFORE making it live.
//
// Dry-run mode: walks the workflow's actions in order, decides what WOULD
// happen for each (template found? lead has phone/email? field allowed?
// tag already present?), and returns a `{ steps: [...] }` array. NOTHING
// is written to the DB — no Activity rows, no template sends, no Lead
// mutations.
//
// Wet-run mode: queues runs through the same pipeline the cron uses (one
// WorkflowRun per action, immediate ones executed right away). Master + per-
// action dedupeKeys are prefixed `manualtest:<timestamp>:…` so they never
// collide with real production runs.
//
// We deliberately do NOT import private helpers from `workflowEngine.ts` —
// instead this file owns its own thin simulator. Keeping the simulator local
// means the engine stays untouched and the simulator can be refined without
// risk of regressing the live pipeline.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { WorkflowActionType, WorkflowRunStatus } from "@prisma/client";

interface SimStep {
  sequenceOrder: number;
  action: WorkflowActionType;
  delayMinutes: number;
  willDo: boolean;
  reason: string;
}

const SET_FIELD_ALLOWED = new Set([
  "status",
  "currentStatus",
  "todoNext",
  "needsManagerReview",
  "categorization",
]);

function safeJson(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const j = JSON.parse(s);
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole("ADMIN");
  const { id: workflowId } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    leadId?: unknown;
    dryRun?: unknown;
  };
  const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";
  // Default ON — we never want admins to accidentally hit a real lead.
  const dryRun = body.dryRun === false ? false : true;

  if (!leadId) {
    return NextResponse.json({ error: "leadId is required" }, { status: 400 });
  }

  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: { actions: { orderBy: { sequenceOrder: "asc" } } },
  });
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // ── DRY RUN ────────────────────────────────────────────────────────
  if (dryRun) {
    const steps: SimStep[] = [];
    // Pre-fetch template ids referenced by SEND_WA / SEND_EMAIL actions to
    // tell the admin whether they actually exist (catches typo'd / deleted
    // template references before going live).
    const referencedTemplateIds = new Set<string>();
    for (const a of workflow.actions) {
      const cfg = safeJson(a.config);
      const tid = typeof cfg.templateId === "string" ? cfg.templateId : "";
      if (tid && (a.type === "SEND_WA" || a.type === "SEND_EMAIL")) {
        referencedTemplateIds.add(tid);
      }
    }
    const templates = referencedTemplateIds.size
      ? await prisma.template.findMany({
          where: { id: { in: [...referencedTemplateIds] } },
          select: { id: true, kind: true, name: true },
        })
      : [];
    const tplById = new Map(templates.map((t) => [t.id, t]));

    const existingTags = (lead.tags ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const a of workflow.actions) {
      const cfg = safeJson(a.config);
      let willDo = false;
      let reason = "";

      switch (a.type) {
        case "SEND_WA": {
          const tid = typeof cfg.templateId === "string" ? cfg.templateId : "";
          const tpl = tid ? tplById.get(tid) : null;
          if (!tid) {
            reason = "No template selected on action config.";
          } else if (!tpl) {
            reason = `Template ${tid} not found (deleted?).`;
          } else if (tpl.kind !== "WHATSAPP") {
            reason = `Template "${tpl.name}" is not a WhatsApp template.`;
          } else if (!lead.phone) {
            reason = "Lead has no phone number — WhatsApp would be skipped.";
          } else {
            willDo = true;
            reason = `Would send WhatsApp template "${tpl.name}" to ${lead.phone}.`;
          }
          break;
        }
        case "SEND_EMAIL": {
          const tid = typeof cfg.templateId === "string" ? cfg.templateId : "";
          const tpl = tid ? tplById.get(tid) : null;
          if (!tid) {
            reason = "No template selected on action config.";
          } else if (!tpl) {
            reason = `Template ${tid} not found (deleted?).`;
          } else if (tpl.kind !== "EMAIL") {
            reason = `Template "${tpl.name}" is not an Email template.`;
          } else if (!lead.email) {
            reason = "Lead has no email — email would be skipped.";
          } else {
            willDo = true;
            reason = `Would send email template "${tpl.name}" to ${lead.email}.`;
          }
          break;
        }
        case "CREATE_TASK": {
          const title = String(cfg.title ?? "Workflow follow-up");
          const due = Number(cfg.dueInMinutes ?? 60);
          willDo = true;
          reason = `Would create task "${title}" due in ${due} min${
            lead.ownerId ? "" : " (no owner — task will be unassigned)"
          }.`;
          break;
        }
        case "NOTIFY_ADMIN": {
          const msg = String(cfg.message ?? `Workflow alert on ${lead.name}`);
          willDo = true;
          reason = `Would notify ADMIN + MANAGER: "${msg}".`;
          break;
        }
        case "NOTIFY_OWNER": {
          if (!lead.ownerId) {
            reason = "Lead has no owner — notification would be skipped.";
          } else {
            willDo = true;
            const msg = String(cfg.message ?? `Workflow alert on ${lead.name}`);
            reason = `Would notify owner: "${msg}".`;
          }
          break;
        }
        case "SET_FIELD": {
          const field = String(cfg.field ?? "");
          if (!field) {
            reason = "No field selected on action config.";
          } else if (!SET_FIELD_ALLOWED.has(field)) {
            reason = `Field "${field}" is not in the allowed whitelist.`;
          } else {
            willDo = true;
            reason = `Would set lead.${field} = ${JSON.stringify(cfg.value ?? null)}.`;
          }
          break;
        }
        case "ADD_TAG": {
          const tag = String(cfg.tag ?? "").trim();
          if (!tag) {
            reason = "No tag value on action config.";
          } else if (existingTags.includes(tag)) {
            reason = `Lead already has tag "${tag}" — no-op.`;
          } else {
            willDo = true;
            reason = `Would add tag "${tag}" to lead.`;
          }
          break;
        }
        default: {
          reason = `Unknown action type — engine would silently skip.`;
        }
      }

      steps.push({
        sequenceOrder: a.sequenceOrder,
        action: a.type,
        delayMinutes: a.delayMinutes,
        willDo,
        reason,
      });
    }

    return NextResponse.json({
      dryRun: true,
      workflow: { id: workflow.id, name: workflow.name },
      lead: { id: lead.id, name: lead.name },
      steps,
    });
  }

  // ── WET RUN ────────────────────────────────────────────────────────
  // Queue actions through the standard pipeline. We bypass filterQuery /
  // triggerConfig checks because this is a manual admin test against a
  // specific lead — those gates only matter for organic triggers.
  // Lazy-import the engine (server-only) to avoid pulling it into client
  // bundles via the route's type graph.
  const { dispatchDuePendingActions } = await import("@/lib/workflowEngine");

  const now = new Date();
  const eventTs = now.getTime();
  // Distinctive prefix so manual tests are easy to spot in WorkflowRun rows
  // and never collide with real prod dedupe keys.
  const tag = `manualtest:${eventTs}`;

  // Master row marking that the workflow "fired" via manual test.
  await prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      leadId: lead.id,
      runAt: now,
      status: WorkflowRunStatus.DONE,
      startedAt: now,
      finishedAt: now,
      dedupeKey: `${tag}:${workflow.id}:${lead.id}:master`,
    },
  });

  const queued: Array<{ actionId: string; runAt: Date; immediate: boolean }> = [];
  for (const a of workflow.actions) {
    const runAt = new Date(eventTs + a.delayMinutes * 60_000);
    const dedupeKey = `${tag}:${workflow.id}:${lead.id}:${a.id}`;
    try {
      await prisma.workflowRun.create({
        data: {
          workflowId: workflow.id,
          actionId: a.id,
          leadId: lead.id,
          runAt,
          status: WorkflowRunStatus.PENDING,
          dedupeKey,
        },
      });
      queued.push({ actionId: a.id, runAt, immediate: a.delayMinutes === 0 });
    } catch {
      // Unique-constraint dupe — admin double-clicked, fine.
    }
  }

  // Trigger the dispatcher so any 0-delay runs we just queued execute now
  // (same as the cron does every minute, just on-demand).
  const result = await dispatchDuePendingActions().catch(() => ({
    dispatched: 0,
    failed: 0,
  }));

  return NextResponse.json({
    dryRun: false,
    workflow: { id: workflow.id, name: workflow.name },
    lead: { id: lead.id, name: lead.name },
    queued,
    dispatched: result,
  });
}
