"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// The 5 per-feature automation toggles (round-robin has its own card). Notifications
// and reminders ALWAYS fire — these govern only automated ACTIONS, each default OFF.
const CONTROLS: { key: string; label: string; on: string; off: string }[] = [
  { key: "automation.autoAssignment", label: "📥 Auto Assignment",
    on: "New unowned leads get an owner automatically", off: "New leads stay unassigned until an admin routes them" },
  { key: "automation.whatsapp", label: "💬 WhatsApp Automation",
    on: "Auto outbound WhatsApp (welcome / speed-to-lead / workflows)", off: "No automatic WhatsApp is sent" },
  { key: "automation.email", label: "✉️ Email Automation",
    on: "Auto outbound email (speed-to-lead / workflows)", off: "No automatic email is sent" },
  { key: "automation.scheduledActions", label: "⏱ Scheduled Actions",
    on: "Workflow drip / scheduled actions run automatically", off: "Scheduled workflow actions do not run" },
  { key: "automation.autoEscalation", label: "🚩 Auto Escalation Actions",
    on: "System auto-flags stalled leads for manager review", off: "No automatic escalation actions (alerts still fire)" },
];

function Toggle({ k, initial, canEdit }: { k: string; initial: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (!canEdit) return;
    setBusy(true);
    try {
      const r = await fetch("/api/settings/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: k, enabled: !on }),
      });
      if (r.ok) { setOn(!on); router.refresh(); }
    } finally { setBusy(false); }
  }
  return (
    <button
      onClick={toggle}
      disabled={busy || !canEdit}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 disabled:opacity-60 ${on ? "bg-emerald-500" : "bg-gray-300"}`}
      aria-pressed={on}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

export default function AutomationControlsCard({ flags, canEdit }: { flags: Record<string, boolean>; canEdit: boolean }) {
  return (
    <div className="card p-5 max-w-2xl border-l-4 border-[#0b1a33]">
      <div className="font-semibold flex items-center gap-2 text-base">⚙️ Automation Controls</div>
      <p className="text-xs text-gray-600 mt-1">
        Every automated <b>action</b> is OFF until you switch it on here. <b className="text-emerald-700">Notifications, reminders,
        escalation alerts, lunch &amp; attendance reminders always work</b> regardless of these toggles.
      </p>
      <div className="mt-3 divide-y divide-gray-100">
        {CONTROLS.map((c) => {
          const on = flags[c.key] === true;
          return (
            <div key={c.key} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800">{c.label}</div>
                <div className={`text-[11px] ${on ? "text-emerald-700" : "text-gray-500"}`}>{on ? c.on : c.off}</div>
              </div>
              <Toggle k={c.key} initial={on} canEdit={canEdit} />
            </div>
          );
        })}
      </div>
      {!canEdit && <div className="text-[10px] text-gray-500 mt-2">Only an admin can change these.</div>}
    </div>
  );
}
