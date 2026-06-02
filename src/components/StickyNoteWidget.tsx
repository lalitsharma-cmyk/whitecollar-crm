"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  leadId: string;
  initialBody: string;
  initialUpdatedAt: string | null;
}

/**
 * Sticky note widget — private per-agent scratchpad pinned at the top of the
 * lead-detail right rail. Backed by the StickyNote model (one row per
 * leadId + userId). Auto-saves on blur. Other agents never see this content.
 *
 * Layout decision: `position: sticky; top: 80px` so the note stays visible as
 * the agent scrolls long call histories. The 80px offset clears the global
 * navbar (~64px) + a bit of breathing room.
 */
export default function StickyNoteWidget({ leadId, initialBody, initialUpdatedAt }: Props) {
  const [body, setBody] = useState(initialBody);
  const [savedAt, setSavedAt] = useState<string | null>(initialUpdatedAt);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSavedRef = useRef(initialBody);

  // Auto-save on blur. We also save on Cmd/Ctrl+Enter so power users can
  // commit without losing focus.
  async function save() {
    if (body === lastSavedRef.current) return;
    setStatus("saving");
    try {
      const r = await fetch(`/api/leads/${leadId}/sticky-note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      lastSavedRef.current = body;
      setSavedAt(j.updatedAt ?? new Date().toISOString());
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  // "Saved 3s ago" relative-time refresher — re-renders every 30s while
  // mounted. Cheap and avoids needing a date-fns import here.
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const relTime = savedAt ? relativeTime(savedAt) : null;
  const statusLabel =
    status === "saving"
      ? "Saving…"
      : status === "error"
      ? "Save failed — retry by blurring the box"
      : relTime
      ? `Saved · ${relTime}`
      : "Private to you — auto-saves on blur";

  return (
    <div className="card p-3 border-l-4 border-amber-400 bg-amber-50 sticky top-[80px] z-10">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
          📌 Your sticky note
          <span className="text-[10px] text-amber-700 font-normal">— private to you</span>
        </div>
        <div
          className={`text-[10px] ${
            status === "error" ? "text-red-600" : "text-amber-700"
          }`}
        >
          {statusLabel}
        </div>
      </div>
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          if (status === "saved" || status === "error") setStatus("idle");
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        placeholder="Scratch notes only you can see. e.g. 'wife is decision maker, call after 7pm IST, mentioned Burj Vista'."
        rows={4}
        className="w-full border border-amber-200 rounded p-2 text-xs bg-white resize-y focus:outline-none focus:ring-1 focus:ring-amber-400 leading-relaxed"
        maxLength={4000}
      />
    </div>
  );
}

// Compact "Xs ago" / "Xm ago" / "Xh ago" / "Xd ago" without pulling date-fns
// into a client bundle. The widget refreshes every 30s so we don't need
// minute-precision in the formatter.
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "just now";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
