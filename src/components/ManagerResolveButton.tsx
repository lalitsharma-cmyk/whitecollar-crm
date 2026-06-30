"use client";
// "Mark resolved" control on the lead-detail "Needs manager attention" banner.
// Shown only to admins/managers (Lalit). Optional resolution note is sent to the
// agent who raised the escalation. Resolving clears the flag + refreshes the view.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ManagerResolveButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function resolve() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/manager-resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: comment.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not resolve");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to resolve");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        ✅ Mark resolved
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Resolution note for the agent (optional)…"
        rows={2}
        className="w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-sm text-gray-800 outline-none focus:border-amber-500"
      />
      {err && <div className="text-xs font-semibold text-rose-600">{err}</div>}
      <div className="flex gap-2">
        <button
          onClick={resolve}
          disabled={busy}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "Resolving…" : "Resolve escalation"}
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
