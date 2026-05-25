import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { formatDistanceToNow } from "date-fns";
import WorkflowControls from "@/components/WorkflowControls";

export const dynamic = "force-dynamic";

const TRIGGER_LABEL: Record<string, string> = {
  LEAD_CREATED:      "🆕 New lead",
  STATUS_CHANGED:    "🚦 Status changed",
  BANT_CHANGED:      "✅ BANT verdict set",
  STAGE_TIME:        "⏱ Time in stage",
  NO_CONTACT_DAYS:   "🧊 No contact for N days",
  NOT_PICKED_STREAK: "📵 N consecutive not-picked",
  COLD_PROMOTED:     "❄→🔥 Cold promoted to lead",
};

const ACTION_LABEL: Record<string, string> = {
  SEND_WA:       "💬 Send WhatsApp",
  SEND_EMAIL:    "✉ Send email",
  CREATE_TASK:   "📝 Create task",
  NOTIFY_ADMIN:  "🔔 Notify admin",
  NOTIFY_OWNER:  "🔔 Notify owner",
  SET_FIELD:     "✏ Set field",
  ADD_TAG:       "🏷 Add tag",
};

export default async function WorkflowsPage() {
  await requireRole("ADMIN", "MANAGER");
  const [workflows, templates] = await Promise.all([
    prisma.workflow.findMany({
      include: { actions: { orderBy: { sequenceOrder: "asc" } }, _count: { select: { runs: true } } },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    }),
    prisma.template.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">🤖 Workflow Rules</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Trigger → action automations. When a trigger fires, the system runs every action (some immediate, some delayed).
            All actions log to the lead's timeline.
          </p>
        </div>
        <WorkflowControls templates={templates.map(t => ({ id: t.id, name: t.name, kind: t.kind, trigger: t.trigger }))} />
      </div>

      {workflows.length === 0 && (
        <div className="card p-8 text-center">
          <div className="text-gray-500 mb-2">No workflows yet.</div>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            Click "+ New workflow" above to start. We've prepared 4 preset templates you can install in one tap.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {workflows.map(wf => {
          const safeConfig = (s: string | null) => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };
          return (
            <div key={wf.id} className={`card p-4 border-l-4 ${wf.active ? "border-emerald-500" : "border-gray-300 opacity-60"}`}>
              <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{wf.name}</span>
                    <span className="chip src text-[10px]">{TRIGGER_LABEL[wf.trigger] ?? wf.trigger}</span>
                    {wf.filterQuery && <span className="chip chip-warm text-[10px]">where: {wf.filterQuery}</span>}
                    {!wf.active && <span className="chip chip-lost text-[10px]">PAUSED</span>}
                  </div>
                  {wf.description && <div className="text-xs text-gray-600 mt-1">{wf.description}</div>}
                </div>
                <WorkflowControls workflow={{ id: wf.id, name: wf.name, active: wf.active }} />
              </div>

              {/* Action chain */}
              <div className="space-y-1 ml-1 mt-2">
                {wf.actions.map((a) => {
                  const cfg = safeConfig(a.config);
                  return (
                    <div key={a.id} className="text-xs text-gray-700 flex items-start gap-2">
                      <span className="text-gray-400 mt-0.5">{a.delayMinutes > 0 ? `⏰ +${a.delayMinutes}m` : "→"}</span>
                      <span className="font-semibold whitespace-nowrap">{ACTION_LABEL[a.type] ?? a.type}</span>
                      {cfg?.templateId && <span className="text-gray-500">· tpl: {templates.find(t => t.id === cfg.templateId)?.name ?? cfg.templateId}</span>}
                      {cfg?.title && <span className="text-gray-500">· "{String(cfg.title)}"</span>}
                      {cfg?.field && <span className="text-gray-500">· {String(cfg.field)} = {String(cfg.value ?? "")}</span>}
                      {cfg?.tag && <span className="text-gray-500">· #{String(cfg.tag)}</span>}
                      {cfg?.message && <span className="text-gray-500">· "{String(cfg.message)}"</span>}
                    </div>
                  );
                })}
              </div>

              <div className="text-[10px] text-gray-400 mt-2">
                {wf._count.runs} fires · created {formatDistanceToNow(wf.createdAt, { addSuffix: true })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
