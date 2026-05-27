"use client";
import { useState } from "react";

/**
 * Fires a self-test Web Push at the current user. Shows inline feedback
 * based on whether the server found any active push subscriptions for them
 * — saves the user a trip to DevTools when push silently no-ops.
 */
export default function TestPushButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);

  async function fire() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/test-push", { method: "POST" });
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; subscriptions?: number; sent?: number };
      if (!r.ok || !data.ok) {
        setMsg({ tone: "err", text: "❌ Request failed — try again or re-login." });
        return;
      }
      const subs = data.subscriptions ?? 0;
      if (subs === 0) {
        setMsg({ tone: "err", text: "❌ No active subscriptions — enable push first (bell icon)." });
        return;
      }
      setMsg({ tone: "ok", text: `✅ Sent! Check for the notification (${subs} device${subs === 1 ? "" : "s"}).` });
    } catch {
      setMsg({ tone: "err", text: "❌ Network error — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={fire}
        disabled={busy}
        className="px-3 py-1.5 text-xs font-medium bg-[#c9a24b] hover:bg-[#b8902f] text-[#0b1a33] rounded disabled:opacity-60"
      >
        {busy ? "Sending…" : "🔔 Send test notification"}
      </button>
      {msg && (
        <p
          className={`text-xs mt-2 ${
            msg.tone === "ok" ? "text-emerald-700" : msg.tone === "err" ? "text-rose-700" : "text-gray-600"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
