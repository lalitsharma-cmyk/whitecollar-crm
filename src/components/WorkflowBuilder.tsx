"use client";

// Visual IF/THEN workflow builder (spec §9.15).
//
// Three stacked sections per workflow:
//   WHEN  — trigger dropdown + optional trigger-specific config rows
//   IF    — optional condition rows (compiled to a URLSearchParams string
//           stored as Workflow.filterQuery — same format the engine's
//           leadMatchesQuery() already understands)
//   THEN  — action rows (chip-style cards with × delete)
//
// Each row is a chip card. The whole form posts to /api/admin/workflows
// (or PATCH /api/admin/workflows/[id] when editing an existing workflow).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, X, Pause, Play, Sparkles } from "lucide-react";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "@/lib/workflowTemplates";

// ── Types mirrored from prisma enums (kept manual to stay a client comp) ──
type TriggerType =
  | "LEAD_CREATED"
  | "STATUS_CHANGED"
  | "BANT_CHANGED"
  | "STAGE_TIME"
  | "NO_CONTACT_DAYS"
  | "NOT_PICKED_STREAK"
  | "COLD_PROMOTED";

type ActionType =
  | "SEND_WA"
  | "SEND_EMAIL"
  | "CREATE_TASK"
  | "NOTIFY_ADMIN"
  | "NOTIFY_OWNER"
  | "SET_FIELD"
  | "ADD_TAG";

const TRIGGER_OPTIONS: { value: TriggerType; label: string }[] = [
  { value: "LEAD_CREATED",      label: "New lead created" },
  { value: "STATUS_CHANGED",    label: "Lead status changed" },
  { value: "BANT_CHANGED",      label: "BANT verdict set" },
  { value: "STAGE_TIME",        label: "Time spent in stage" },
  { value: "NO_CONTACT_DAYS",   label: "No contact for N days" },
  { value: "NOT_PICKED_STREAK", label: "N consecutive not-picked" },
  { value: "COLD_PROMOTED",     label: "Cold data promoted to lead" },
];

const ACTION_OPTIONS: { value: ActionType; label: string }[] = [
  { value: "SEND_WA",      label: "Send WhatsApp" },
  { value: "SEND_EMAIL",   label: "Send email" },
  { value: "CREATE_TASK",  label: "Create task" },
  { value: "NOTIFY_ADMIN", label: "Notify admin / manager" },
  { value: "NOTIFY_OWNER", label: "Notify lead owner" },
  { value: "SET_FIELD",    label: "Set lead field" },
  { value: "ADD_TAG",      label: "Add tag" },
];

// Condition keys are restricted to what leadMatchesQuery() in
// src/lib/workflowEngine.ts actually supports.
const CONDITION_KEYS: { value: "team" | "ai" | "status"; label: string }[] = [
  { value: "team",   label: "Team is" },
  { value: "ai",     label: "AI score is" },
  { value: "status", label: "Status is" },
];

export interface Template { id: string; name: string; kind: string; trigger: string; }

interface ConditionRow { id: string; key: "team" | "ai" | "status"; value: string; }

interface ActionRow {
  id: string;
  type: ActionType;
  delayMinutes: number;
  config: Record<string, unknown>;
}

export interface WorkflowFormSeed {
  id?: string;
  name: string;
  description?: string | null;
  trigger: TriggerType;
  triggerConfig?: Record<string, unknown> | null;
  filterQuery?: string | null;
  actions: Array<{ id?: string; type: ActionType; delayMinutes: number; config: Record<string, unknown> }>;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

function parseFilterQuery(qs: string | null | undefined): ConditionRow[] {
  if (!qs) return [];
  const params = new URLSearchParams(qs);
  const rows: ConditionRow[] = [];
  for (const k of ["team", "ai", "status"] as const) {
    const v = params.get(k);
    if (v) rows.push({ id: uid(), key: k, value: v });
  }
  return rows;
}

function serializeConditions(rows: ConditionRow[]): string | null {
  const clean = rows.filter((r) => r.value.trim());
  if (clean.length === 0) return null;
  const params = new URLSearchParams();
  for (const r of clean) params.set(r.key, r.value.trim());
  return params.toString();
}

// ─────────────────────────────────────────────────────────────────────────

interface BuilderProps {
  /** Existing workflow to edit, or undefined for "new workflow" mode. */
  seed?: WorkflowFormSeed;
  /** Available templates for SEND_WA / SEND_EMAIL action pickers. */
  templates: Template[];
  /** Called when SAVE succeeds. */
  onClose: () => void;
}

function Builder({ seed, templates, onClose }: BuilderProps) {
  const router = useRouter();
  const isEdit = Boolean(seed?.id);

  const [name, setName] = useState(seed?.name ?? "");
  const [description, setDescription] = useState(seed?.description ?? "");
  const [trigger, setTrigger] = useState<TriggerType>(seed?.trigger ?? "LEAD_CREATED");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(seed?.triggerConfig ?? {});
  const [conditions, setConditions] = useState<ConditionRow[]>(parseFilterQuery(seed?.filterQuery));
  const [actions, setActions] = useState<ActionRow[]>(
    (seed?.actions ?? []).map((a) => ({ id: uid(), type: a.type, delayMinutes: a.delayMinutes, config: a.config }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addAction() {
    setActions((prev) => [
      ...prev,
      { id: uid(), type: "SEND_WA", delayMinutes: 0, config: {} },
    ]);
  }
  function updateAction(id: string, patch: Partial<ActionRow>) {
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  function removeAction(id: string) {
    setActions((prev) => prev.filter((a) => a.id !== id));
  }

  function addCondition() {
    setConditions((prev) => [...prev, { id: uid(), key: "team", value: "" }]);
  }
  function updateCondition(id: string, patch: Partial<ConditionRow>) {
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function removeCondition(id: string) {
    setConditions((prev) => prev.filter((c) => c.id !== id));
  }

  async function save() {
    setError(null);
    if (!name.trim()) { setError("Name is required."); return; }
    if (actions.length === 0) { setError("Add at least one action under THEN."); return; }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        description: description?.trim() || null,
        trigger,
        triggerConfig: Object.keys(triggerConfig).length > 0 ? triggerConfig : null,
        conditions: serializeConditions(conditions),
        actions: actions.map((a, i) => ({
          type: a.type,
          sequenceOrder: i,
          delayMinutes: Math.max(0, Number(a.delayMinutes) || 0),
          config: a.config,
        })),
      };
      const url = isEdit ? `/api/admin/workflows/${seed!.id}` : "/api/admin/workflows";
      const method = isEdit ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(String(j.error ?? `Failed (HTTP ${r.status})`));
        return;
      }
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const waTemplates = useMemo(() => templates.filter((t) => t.kind === "WHATSAPP"), [templates]);
  const emailTemplates = useMemo(() => templates.filter((t) => t.kind === "EMAIL"), [templates]);

  return (
    <div className="card p-4 sm:p-5 space-y-5 border-2 border-[#c9a24b]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workflow name (e.g. Welcome new leads)"
            className="w-full text-lg font-bold border-b border-gray-300 focus:border-[#c9a24b] outline-none bg-transparent pb-1"
          />
          <input
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description (optional)"
            className="w-full text-xs text-gray-600 border-b border-gray-200 focus:border-[#c9a24b] outline-none bg-transparent mt-2 pb-1"
          />
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="Cancel">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* ── WHEN ─────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <span className="chip chip-new text-[10px]">WHEN</span>
          <span className="text-xs text-gray-500">Trigger that starts the workflow</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center bg-indigo-50/40 border border-indigo-100 rounded-lg p-3">
          <select
            value={trigger}
            onChange={(e) => { setTrigger(e.target.value as TriggerType); setTriggerConfig({}); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {TRIGGER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          {trigger === "STATUS_CHANGED" && (
            <>
              <span className="text-xs text-gray-600">to status</span>
              <input
                value={String(triggerConfig.to ?? "")}
                onChange={(e) => setTriggerConfig({ to: e.target.value })}
                placeholder="e.g. SITE_VISIT"
                className="border border-gray-300 rounded px-2 py-1 text-sm w-40"
              />
            </>
          )}

          {trigger === "BANT_CHANGED" && (
            <>
              <span className="text-xs text-gray-600">to verdict</span>
              <select
                value={String(triggerConfig.to ?? "")}
                onChange={(e) => setTriggerConfig({ to: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              >
                <option value="">— any —</option>
                <option value="QUALIFIES">QUALIFIES</option>
                <option value="NOT_QUALIFIED">NOT_QUALIFIED</option>
              </select>
            </>
          )}

          {(trigger === "STAGE_TIME" || trigger === "NO_CONTACT_DAYS" || trigger === "NOT_PICKED_STREAK") && (
            <>
              <span className="text-xs text-gray-600">threshold</span>
              <input
                type="number"
                min={1}
                value={String(triggerConfig.threshold ?? "")}
                onChange={(e) => setTriggerConfig({ ...triggerConfig, threshold: Number(e.target.value) })}
                placeholder={trigger === "NO_CONTACT_DAYS" ? "days" : "count"}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-24"
              />
            </>
          )}
        </div>
      </section>

      {/* ── IF ───────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <span className="chip chip-warm text-[10px]">IF (optional)</span>
          <span className="text-xs text-gray-500">Only fire when the lead matches these conditions</span>
        </div>
        <div className="space-y-2">
          {conditions.length === 0 && (
            <div className="text-xs text-gray-400 italic">No conditions — fires for every matching lead.</div>
          )}
          {conditions.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 bg-amber-50/40 border border-amber-100 rounded-lg p-2">
              <select
                value={c.key}
                onChange={(e) => updateCondition(c.id, { key: e.target.value as ConditionRow["key"] })}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              >
                {CONDITION_KEYS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
              <input
                value={c.value}
                onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                placeholder={c.key === "team" ? "Dubai or India" : c.key === "ai" ? "HOT / WARM / COLD" : "e.g. NEW"}
                className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 min-w-[160px]"
              />
              <button onClick={() => removeCondition(c.id)} className="text-red-500 hover:text-red-700 p-1" title="Remove">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button onClick={addCondition} className="btn btn-ghost text-xs">
            <Plus className="w-3 h-3" /> Add condition
          </button>
        </div>
      </section>

      {/* ── THEN ─────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <span className="chip chip-won text-[10px]">THEN</span>
          <span className="text-xs text-gray-500">Actions to run (in order)</span>
        </div>
        <div className="space-y-2">
          {actions.length === 0 && (
            <div className="text-xs text-gray-400 italic">No actions yet — add at least one below.</div>
          )}
          {actions.map((a, idx) => (
            <ActionEditor
              key={a.id}
              index={idx}
              row={a}
              waTemplates={waTemplates}
              emailTemplates={emailTemplates}
              onChange={(patch) => updateAction(a.id, patch)}
              onRemove={() => removeAction(a.id)}
            />
          ))}
          <button onClick={addAction} className="btn btn-ghost text-xs">
            <Plus className="w-3 h-3" /> Add action
          </button>
        </div>
      </section>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">{error}</div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
        <button onClick={onClose} disabled={busy} className="btn btn-ghost text-sm">Cancel</button>
        <button onClick={save} disabled={busy} className="btn btn-primary text-sm">
          <Save className="w-3 h-3" /> {busy ? "Saving…" : isEdit ? "Save changes" : "Create workflow"}
        </button>
      </div>
    </div>
  );
}

// ── Per-action chip row ──────────────────────────────────────────────────

interface ActionEditorProps {
  index: number;
  row: ActionRow;
  waTemplates: Template[];
  emailTemplates: Template[];
  onChange: (patch: Partial<ActionRow>) => void;
  onRemove: () => void;
}

function ActionEditor({ index, row, waTemplates, emailTemplates, onChange, onRemove }: ActionEditorProps) {
  const cfg = row.config;
  function setCfg(patch: Record<string, unknown>) {
    onChange({ config: { ...cfg, ...patch } });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 bg-emerald-50/40 border border-emerald-100 rounded-lg p-2">
      <span className="text-[10px] font-bold text-emerald-700 bg-white border border-emerald-200 rounded-full px-2 py-0.5">
        {index + 1}
      </span>
      <select
        value={row.type}
        onChange={(e) => onChange({ type: e.target.value as ActionType, config: {} })}
        className="border border-gray-300 rounded px-2 py-1 text-sm"
      >
        {ACTION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {row.type === "SEND_WA" && (
        <select
          value={String(cfg.templateId ?? "")}
          onChange={(e) => setCfg({ templateId: e.target.value })}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="">— pick WA template —</option>
          {waTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      )}

      {row.type === "SEND_EMAIL" && (
        <select
          value={String(cfg.templateId ?? "")}
          onChange={(e) => setCfg({ templateId: e.target.value })}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="">— pick email template —</option>
          {emailTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      )}

      {row.type === "CREATE_TASK" && (
        <>
          <input
            value={String(cfg.title ?? "")}
            onChange={(e) => setCfg({ title: e.target.value })}
            placeholder="Task title"
            className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 min-w-[160px]"
          />
          <input
            type="number"
            min={0}
            value={Number(cfg.dueInMinutes ?? 60)}
            onChange={(e) => setCfg({ dueInMinutes: Number(e.target.value) })}
            placeholder="due-in (min)"
            className="border border-gray-300 rounded px-2 py-1 text-sm w-24"
          />
        </>
      )}

      {(row.type === "NOTIFY_ADMIN" || row.type === "NOTIFY_OWNER") && (
        <input
          value={String(cfg.message ?? "")}
          onChange={(e) => setCfg({ message: e.target.value })}
          placeholder="Notification message"
          className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 min-w-[160px]"
        />
      )}

      {row.type === "SET_FIELD" && (
        <>
          <select
            value={String(cfg.field ?? "")}
            onChange={(e) => setCfg({ field: e.target.value })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">— field —</option>
            <option value="status">status</option>
            <option value="currentStatus">currentStatus</option>
            <option value="todoNext">todoNext</option>
            <option value="needsManagerReview">needsManagerReview</option>
            <option value="categorization">categorization</option>
          </select>
          <input
            value={String(cfg.value ?? "")}
            onChange={(e) => setCfg({ value: e.target.value })}
            placeholder="value"
            className="border border-gray-300 rounded px-2 py-1 text-sm w-40"
          />
        </>
      )}

      {row.type === "ADD_TAG" && (
        <input
          value={String(cfg.tag ?? "")}
          onChange={(e) => setCfg({ tag: e.target.value })}
          placeholder="tag (e.g. HOT-LEAD)"
          className="border border-gray-300 rounded px-2 py-1 text-sm w-48"
        />
      )}

      <span className="text-xs text-gray-500 ml-auto">delay</span>
      <input
        type="number"
        min={0}
        value={row.delayMinutes}
        onChange={(e) => onChange({ delayMinutes: Math.max(0, Number(e.target.value) || 0) })}
        className="border border-gray-300 rounded px-2 py-1 text-sm w-20"
        title="Minutes after trigger to run this action"
      />
      <span className="text-xs text-gray-500">min</span>
      <button onClick={onRemove} className="text-red-500 hover:text-red-700 p-1" title="Remove action">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level orchestrator: lists workflow cards + handles add/edit/toggle/delete.

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  trigger: TriggerType;
  triggerConfig: string | null;
  filterQuery: string | null;
  active: boolean;
  actionCount: number;
  lastRunAt: Date | null;
  actions: Array<{ id: string; type: ActionType; delayMinutes: number; config: string; sequenceOrder: number }>;
}

interface PanelProps {
  workflows: WorkflowSummary[];
  templates: Template[];
}

function templateToSeed(t: WorkflowTemplate): WorkflowFormSeed {
  return {
    name: t.name,
    description: t.description,
    trigger: t.trigger as TriggerType,
    triggerConfig: t.triggerConfig ?? null,
    filterQuery: t.filterQuery ?? null,
    actions: t.actions.map((a) => ({
      type: a.type as ActionType,
      delayMinutes: a.delayMinutes,
      config: a.config,
    })),
  };
}

export default function WorkflowBuilderPanel({ workflows, templates }: PanelProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [starterSeed, setStarterSeed] = useState<WorkflowFormSeed | null>(null);
  const [showStarters, setShowStarters] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  async function seedAll() {
    if (!confirm("Create all 9 starter workflows? Existing same-named workflows will be skipped.")) return;
    setSeeding(true);
    try {
      const r = await fetch("/api/admin/workflows/seed", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(`Seed failed: ${j.error ?? `HTTP ${r.status}`}`);
        return;
      }
      alert(`Created ${j.created ?? 0}, skipped ${j.skipped ?? 0}`);
      router.refresh();
    } finally {
      setSeeding(false);
    }
  }

  function useStarter(t: WorkflowTemplate) {
    setStarterSeed(templateToSeed(t));
    setEditingId(null);
    setCreating(true);
  }

  function closeCreate() {
    setCreating(false);
    setStarterSeed(null);
  }

  async function toggle(wf: WorkflowSummary) {
    setBusyId(wf.id);
    try {
      const r = await fetch(`/api/admin/workflows/${wf.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !wf.active }),
      });
      if (r.ok) router.refresh();
    } finally { setBusyId(null); }
  }

  async function remove(wf: WorkflowSummary) {
    if (!confirm(`Delete workflow "${wf.name}"? This cannot be undone.`)) return;
    setBusyId(wf.id);
    try {
      const r = await fetch(`/api/admin/workflows/${wf.id}`, { method: "DELETE" });
      if (r.ok) router.refresh();
    } finally { setBusyId(null); }
  }

  function seedFor(wf: WorkflowSummary): WorkflowFormSeed {
    let tc: Record<string, unknown> | null = null;
    if (wf.triggerConfig) { try { tc = JSON.parse(wf.triggerConfig); } catch { /* ignore */ } }
    return {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      trigger: wf.trigger,
      triggerConfig: tc,
      filterQuery: wf.filterQuery,
      actions: wf.actions.map((a) => {
        let cfg: Record<string, unknown> = {};
        try { cfg = JSON.parse(a.config) ?? {}; } catch { /* ignore */ }
        return { id: a.id, type: a.type, delayMinutes: a.delayMinutes, config: cfg };
      }),
    };
  }

  return (
    <div className="space-y-4">
      {!creating && !editingId && (
        <section className="card p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#c9a24b]" />
              <h3 className="font-bold text-sm">Starter templates</h3>
              <span className="text-[11px] text-gray-500">
                One-click clone a proven workflow rule, then tweak before saving.
              </span>
            </div>
            <button
              onClick={() => setShowStarters((v) => !v)}
              className="btn btn-ghost text-xs"
            >
              {showStarters ? "Hide" : "Show"}
            </button>
          </div>
          {showStarters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {WORKFLOW_TEMPLATES.map((t) => (
                <div
                  key={t.id}
                  className="border border-gray-200 hover:border-[#c9a24b] rounded-lg p-3 flex flex-col gap-2 transition"
                >
                  <div className="font-semibold text-sm">{t.name}</div>
                  <p className="text-[11px] text-gray-600 line-clamp-3">{t.description}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="chip chip-new text-[10px]">
                      {TRIGGER_OPTIONS.find((o) => o.value === t.trigger)?.label ?? t.trigger}
                    </span>
                    {t.filterQuery && (
                      <span className="chip chip-warm text-[10px]">if: {t.filterQuery}</span>
                    )}
                    <span className="chip chip-won text-[10px]">
                      {t.actions.length} action{t.actions.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <button
                    onClick={() => useStarter(t)}
                    className="btn btn-ghost text-xs self-start mt-auto"
                    title="Prefill builder with this template"
                  >
                    <Plus className="w-3 h-3" /> Use this
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!creating && !editingId && (
        <div className="flex justify-end gap-2">
          <button
            onClick={seedAll}
            disabled={seeding}
            className="btn btn-ghost text-sm"
            title="Bulk-create every starter template that isn't already in the list"
          >
            🌱 {seeding ? "Seeding…" : "Seed starter workflows"}
          </button>
          <button onClick={() => { setStarterSeed(null); setCreating(true); }} className="btn btn-primary text-sm">
            <Plus className="w-4 h-4" /> New workflow
          </button>
        </div>
      )}

      {creating && (
        <Builder
          seed={starterSeed ?? undefined}
          templates={templates}
          onClose={closeCreate}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {workflows.map((wf) => {
          const isEditing = editingId === wf.id;
          if (isEditing) {
            return (
              <div key={wf.id} className="sm:col-span-2 lg:col-span-3">
                <Builder
                  seed={seedFor(wf)}
                  templates={templates}
                  onClose={() => setEditingId(null)}
                />
              </div>
            );
          }
          return (
            <div
              key={wf.id}
              className={`card p-4 border-l-4 transition ${
                wf.active ? "border-emerald-500" : "border-gray-300 opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <button
                  onClick={() => setEditingId(wf.id)}
                  className="text-left flex-1 min-w-0 hover:text-[#c9a24b]"
                  title="Edit"
                >
                  <div className="font-bold text-sm truncate">{wf.name}</div>
                  {wf.description && (
                    <div className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{wf.description}</div>
                  )}
                </button>
                <button
                  onClick={() => toggle(wf)}
                  disabled={busyId === wf.id}
                  className="btn btn-ghost text-xs"
                  title={wf.active ? "Pause" : "Resume"}
                >
                  {wf.active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => remove(wf)}
                  disabled={busyId === wf.id}
                  className="btn btn-ghost text-xs text-red-600"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                <span className="chip chip-new text-[10px]">
                  {TRIGGER_OPTIONS.find((t) => t.value === wf.trigger)?.label ?? wf.trigger}
                </span>
                {wf.filterQuery && (
                  <span className="chip chip-warm text-[10px]">if: {wf.filterQuery}</span>
                )}
                <span className="chip chip-won text-[10px]">
                  {wf.actionCount} action{wf.actionCount === 1 ? "" : "s"}
                </span>
                {!wf.active && <span className="chip chip-lost text-[10px]">PAUSED</span>}
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[10px] text-gray-400">
                  {wf.lastRunAt
                    ? `Last run: ${wf.lastRunAt.toLocaleString()}`
                    : "Never run yet"}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTestingId(testingId === wf.id ? null : wf.id)}
                    className="text-[10px] text-gray-500 hover:text-[#c9a24b] hover:underline whitespace-nowrap inline-flex items-center gap-0.5"
                    title="Dry-run this workflow against a specific lead"
                  >
                    🧪 Test
                  </button>
                  <Link
                    href={`/admin/workflows/${wf.id}/runs`}
                    className="text-[10px] text-gray-500 hover:text-[#c9a24b] hover:underline whitespace-nowrap"
                    title="View run history"
                  >
                    🕓 View runs
                  </Link>
                </div>
              </div>

              {testingId === wf.id && (
                <TestFirePanel
                  workflowId={wf.id}
                  workflowName={wf.name}
                  onClose={() => setTestingId(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {workflows.length === 0 && !creating && (
        <div className="card p-8 text-center">
          <div className="text-gray-500 mb-2">No workflows yet.</div>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            Click "+ New workflow" above to build your first IF/THEN automation.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 🧪 Test fire panel — inline form on a workflow card.
//
// Lets an admin pick a lead (via the global /api/quick-search endpoint),
// choose dry-run vs wet-run, and inspect what every action of THIS workflow
// would (or did) do against that lead.

interface LeadHit { id: string; name: string; phone: string | null; }

interface TestStep {
  sequenceOrder: number;
  action: string;
  delayMinutes: number;
  willDo: boolean;
  reason: string;
}

interface TestResult {
  dryRun: boolean;
  steps?: TestStep[];
  queued?: Array<{ actionId: string; runAt: string; immediate: boolean }>;
  dispatched?: { dispatched: number; failed: number };
  error?: string;
}

interface TestFirePanelProps {
  workflowId: string;
  workflowName: string;
  onClose: () => void;
}

function TestFirePanel({ workflowId, workflowName, onClose }: TestFirePanelProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<LeadHit | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setHits([]); return; }
    setSearching(true);
    try {
      const r = await fetch(`/api/quick-search?q=${encodeURIComponent(q.trim())}`);
      if (r.ok) {
        const j = await r.json();
        setHits(Array.isArray(j.leads) ? j.leads : []);
      }
    } finally {
      setSearching(false);
    }
  }

  async function runTest() {
    if (!selected) { setError("Pick a lead first."); return; }
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const r = await fetch(`/api/admin/workflows/${workflowId}/test-fire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.id, dryRun }),
      });
      const j = (await r.json().catch(() => ({}))) as TestResult;
      if (!r.ok) {
        setError(String(j.error ?? `Failed (HTTP ${r.status})`));
        return;
      }
      setResult(j);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-3 border-t border-dashed border-gray-200 pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-gray-700">
          🧪 Test fire: <span className="text-gray-500 font-normal">{workflowName}</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="Close">
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Lead picker */}
      <div className="relative">
        <input
          value={selected ? selected.name : query}
          onChange={(e) => { setSelected(null); search(e.target.value); }}
          placeholder="Search lead by name / phone / email…"
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
        />
        {!selected && query.trim().length >= 2 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow max-h-40 overflow-auto">
            {searching && <div className="px-2 py-1 text-[11px] text-gray-400">Searching…</div>}
            {!searching && hits.length === 0 && (
              <div className="px-2 py-1 text-[11px] text-gray-400">No matches.</div>
            )}
            {hits.map((h) => (
              <button
                key={h.id}
                onClick={() => { setSelected(h); setHits([]); }}
                className="block w-full text-left px-2 py-1 text-[11px] hover:bg-gray-100"
              >
                <span className="font-medium">{h.name}</span>
                {h.phone && <span className="text-gray-500"> · {h.phone}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="text-[11px] text-gray-600 inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="rounded"
          />
          Dry-run (don't actually send / mutate)
        </label>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn btn-ghost text-[11px]" disabled={running}>
            Close
          </button>
          <button
            onClick={runTest}
            disabled={running || !selected}
            className="btn btn-primary text-[11px]"
          >
            {running ? "Running…" : "Run test"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-[11px] p-1.5 rounded">{error}</div>
      )}

      {result && result.dryRun && Array.isArray(result.steps) && (
        <div className="space-y-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide">
            Dry-run plan ({result.steps.length} step{result.steps.length === 1 ? "" : "s"})
          </div>
          {result.steps.length === 0 && (
            <div className="text-[11px] text-gray-400 italic">No actions on this workflow.</div>
          )}
          {result.steps.map((s, i) => (
            <div
              key={i}
              className={`text-[11px] rounded border p-1.5 flex items-start gap-1.5 ${
                s.willDo ? "bg-emerald-50 border-emerald-200" : "bg-gray-50 border-gray-200"
              }`}
            >
              <span>{s.willDo ? "✅" : "❌"}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  {i + 1}. {s.action}
                  {s.delayMinutes > 0 && (
                    <span className="text-gray-500 font-normal"> (+{s.delayMinutes} min)</span>
                  )}
                </div>
                <div className="text-gray-600">{s.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {result && !result.dryRun && (
        <div className="bg-amber-50 border border-amber-200 rounded p-1.5 text-[11px] text-amber-800">
          ⚠️ Wet-run dispatched.{" "}
          {result.dispatched
            ? `${result.dispatched.dispatched} immediate action${
                result.dispatched.dispatched === 1 ? "" : "s"
              } executed, ${result.dispatched.failed} failed.`
            : ""}{" "}
          Check 🕓 View runs for full details.
        </div>
      )}
    </div>
  );
}
