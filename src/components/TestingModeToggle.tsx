"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props { initial: boolean; canEdit: boolean; }

/**
 * MASTER kill-switch — turns OFF every automated outbound action and every
 * nagging escalation at once. Use while importing real client data so nothing
 * leaks to phone numbers or floods admins with fake SLA breaches.
 *
 * What flipping ON pauses:
 *   • Round-robin auto-assign (5-min orphan sweep)
 *   • 15-min call SLA escalation (no admin/agent alerts)
 *   • "🚩 Needs You" auto-flagging (no banners on stale leads)
 *   • Overnight auto-WhatsApp welcome (10pm-10am IST)
 *   • Speed-to-lead first-touch WA + email (sub-60s response)
 *
 * Manual actions (logging calls, sending one-off WA, etc.) still work normally.
 */
export default function TestingModeToggle({ initial, canEdit }: Props) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return (
      <div className="text-sm mt-2">
        {on
          ? "🧪 Testing mode is ON — auto-actions paused (admin can change)"
          : "✅ Live mode — all automations active (admin can change)"}
      </div>
    );
  }

  async function toggle() {
    setBusy(true);
    try {
      const r = await fetch("/api/settings/testing-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !on }),
      });
      if (r.ok) { setOn(!on); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-3 mt-2">
      <button
        onClick={toggle}
        disabled={busy}
        className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${on ? "bg-amber-500" : "bg-emerald-500"}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${on ? "translate-x-8" : "translate-x-1"}`} />
      </button>
      <span className={`text-sm font-semibold ${on ? "text-amber-800" : "text-emerald-800"}`}>
        {busy ? "Saving…" : on
          ? "🧪 TESTING MODE ON — every auto-action paused"
          : "✅ LIVE MODE — all automations active"}
      </span>
    </div>
  );
}
