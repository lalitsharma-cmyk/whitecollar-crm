"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pause, Play, X } from "lucide-react";

interface Template { id: string; name: string; kind: "WHATSAPP" | "EMAIL" | string; trigger: string; }

interface PresetAction {
  type: "SEND_WA" | "SEND_EMAIL" | "CREATE_TASK" | "NOTIFY_ADMIN" | "NOTIFY_OWNER" | "SET_FIELD" | "ADD_TAG";
  delayMinutes?: number;
  config: Record<string, unknown>;
  /** Human label for the editor UI. */
  label: string;
}

interface Preset {
  name: string;
  description: string;
  trigger: "LEAD_CREATED" | "STATUS_CHANGED" | "BANT_CHANGED" | "COLD_PROMOTED";
  triggerConfig?: Record<string, unknown>;
  filterQuery?: string;
  /** Template lookup hints — pickedTemplateId is filled at submit time. */
  actions: PresetAction[];
}

const PRESETS: Preset[] = [
  {
    name: "Welcome new leads (drip)",
    description: "Every brand-new lead gets a WA welcome immediately, an email recap after 1h, and a follow-up reminder after 3 days.",
    trigger: "LEAD_CREATED",
    actions: [
      { type: "SEND_WA",    label: "WA: FIRST_QUERY template, immediately", config: { _triggerHint: "FIRST_QUERY", _kindHint: "WHATSAPP" } },
      { type: "SEND_EMAIL", delayMinutes: 60, label: "Email: FIRST_QUERY template, after 1 hour", config: { _triggerHint: "FIRST_QUERY", _kindHint: "EMAIL" } },
      { type: "CREATE_TASK", delayMinutes: 60 * 24 * 3, label: "Task: follow-up call, after 3 days", config: { title: "Follow up with new lead", dueInMinutes: 60 } },
    ],
  },
  {
    name: "Site visit booked → schedule reminder",
    description: "When a lead moves to SITE_VISIT stage, notify the owner immediately + send a confirmation WA.",
    trigger: "STATUS_CHANGED",
    triggerConfig: { to: "SITE_VISIT" },
    actions: [
      { type: "NOTIFY_OWNER", label: "Notify owner: site visit booked", config: { message: "Site visit booked — confirm cab + send brochure" } },
      { type: "SEND_WA", label: "WA: SCHEDULE_VISIT template, immediately", config: { _triggerHint: "SCHEDULE_VISIT", _kindHint: "WHATSAPP" } },
      { type: "CREATE_TASK", delayMinutes: 60 * 24, label: "Task: post-visit follow-up, after 24h", config: { title: "Post-visit follow-up", dueInMinutes: 0 } },
    ],
  },
  {
    name: "BANT qualified → fast-track",
    description: "When agent marks BANT = Qualifies, escalate to admin + create a 24h close-attempt task.",
    trigger: "BANT_CHANGED",
    triggerConfig: { to: "QUALIFIES" },
    actions: [
      { type: "NOTIFY_ADMIN", label: "Notify admin: qualified lead", config: { message: "Lead just BANT-qualified — push for booking" } },
      { type: "ADD_TAG", label: "Tag lead: BANT-Q", config: { tag: "BANT-Q" } },
      { type: "CREATE_TASK", delayMinutes: 60 * 24, label: "Task: closing attempt, after 24h", config: { title: "Push for booking / token", dueInMinutes: 0 } },
    ],
  },
  {
    name: "Cold-data promoted → welcome",
    description: "When cold data gets promoted to lead, send WA + create a same-day call task.",
    trigger: "COLD_PROMOTED",
    actions: [
      { type: "SEND_WA", label: "WA: AFTER_CALL template, immediately", config: { _triggerHint: "AFTER_CALL", _kindHint: "WHATSAPP" } },
      { type: "CREATE_TASK", label: "Task: same-day deep-dive call", config: { title: "Deep-dive call on freshly promoted lead", dueInMinutes: 60 * 4 } },
    ],
  },
];

interface Props {
  /** For the page-header (no workflow) → shows "+ New workflow" button + presets dialog. */
  templates?: Template[];
  /** For per-row controls → shows pause/resume + delete. */
  workflow?: { id: string; name: string; active: boolean };
}

export default function WorkflowControls({ templates, workflow }: Props) {
  const router = useRouter();
  const [showPresets, setShowPresets] = useState(false);
  const [busy, setBusy] = useState(false);

  // PER-ROW controls
  if (workflow) {
    async function toggleActive() {
      if (!workflow) return;
      setBusy(true);
      try {
        const r = await fetch(`/api/admin/workflows/${workflow.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !workflow.active }),
        });
        if (r.ok) router.refresh();
      } finally { setBusy(false); }
    }
    async function remove() {
      if (!workflow) return;
      if (!confirm(`Delete workflow "${workflow.name}"?`)) return;
      setBusy(true);
      try {
        const r = await fetch(`/api/admin/workflows/${workflow.id}`, { method: "DELETE" });
        if (r.ok) router.refresh();
      } finally { setBusy(false); }
    }
    return (
      <div className="flex gap-1">
        <button onClick={toggleActive} disabled={busy} className="btn btn-ghost text-xs" title={workflow.active ? "Pause workflow" : "Resume workflow"}>
          {workflow.active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        </button>
        <button onClick={remove} disabled={busy} className="btn btn-ghost text-xs text-red-600"><Trash2 className="w-3 h-3" /></button>
      </div>
    );
  }

  // HEADER controls — install-from-preset
  async function installPreset(preset: Preset) {
    if (busy) return;
    setBusy(true);
    try {
      // Resolve template hints → real templateIds. Pick the first matching template by kind+trigger.
      const actions = preset.actions.map(a => {
        const cfg = { ...a.config };
        const hint = cfg._triggerHint as string | undefined;
        const kindHint = cfg._kindHint as string | undefined;
        delete cfg._triggerHint; delete cfg._kindHint;
        if (hint && kindHint && templates) {
          const tpl = templates.find(t => t.kind === kindHint && t.trigger === hint);
          if (tpl) cfg.templateId = tpl.id;
        }
        return { type: a.type, delayMinutes: a.delayMinutes ?? 0, config: cfg };
      });
      const r = await fetch("/api/admin/workflows", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset.name,
          description: preset.description,
          trigger: preset.trigger,
          triggerConfig: preset.triggerConfig,
          actions,
        }),
      });
      if (r.ok) { setShowPresets(false); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => setShowPresets(true)} className="btn btn-primary text-xs"><Plus className="w-3 h-3" /> New workflow</button>
      {showPresets && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setShowPresets(false)}>
          <div className="bg-white rounded-xl max-w-2xl w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-semibold text-lg">📚 Install from preset</div>
                <p className="text-xs text-gray-500">Tap a preset → it installs immediately. You can pause / delete it anytime.</p>
              </div>
              <button onClick={() => setShowPresets(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2">
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => installPreset(p)}
                  disabled={busy}
                  className="w-full text-left p-3 border border-[#e5e7eb] rounded-lg hover:border-[#c9a24b] transition disabled:opacity-50"
                >
                  <div className="font-semibold text-sm">{p.name}</div>
                  <div className="text-xs text-gray-600 mt-1">{p.description}</div>
                  <div className="text-[10px] text-gray-500 mt-2">
                    🚦 <b>{p.trigger}</b>{p.triggerConfig ? ` (${Object.entries(p.triggerConfig).map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}
                    {" → "}
                    {p.actions.map((a) => a.label.replace(/template,?/g, "")).join(" · ")}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-3">
              💡 Custom workflow builder coming in next iteration. For now, install a preset + edit it via the API or ask Claude to add a custom one.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
