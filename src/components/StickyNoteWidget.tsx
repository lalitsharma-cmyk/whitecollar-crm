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
    <div className="relative mt-2" style={{ filter: "drop-shadow(3px 4px 8px rgba(0,0,0,0.18))" }}>
      {/* Red pushpin */}
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "radial-gradient(circle at 38% 32%, #ff8888, #cc1111)",
            border: "1.5px solid #991111",
            boxShadow: "0 2px 4px rgba(0,0,0,0.35)",
          }}
        />
        <div
          style={{
            width: 3,
            height: 10,
            background: "linear-gradient(to bottom, #999, #666)",
            borderRadius: "0 0 2px 2px",
            marginTop: -1,
          }}
        />
      </div>

      {/* Note body */}
      <div
        style={{
          background: "linear-gradient(160deg,#fef9c3 0%,#fde047 100%)",
          borderRadius: 3,
          padding: "2rem 1rem 1.5rem",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Bottom-right page curl shadow */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 28,
            height: 28,
            background: "linear-gradient(225deg, #d4a800 45%, transparent 50%)",
          }}
        />

        {/* Save status */}
        <div
          style={{
            fontSize: 10,
            color: status === "error" ? "#cc0000" : "rgba(78,52,0,0.55)",
            textAlign: "right",
            marginBottom: 6,
          }}
        >
          {statusLabel}
        </div>

        {/* Textarea */}
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
          rows={5}
          maxLength={4000}
          className="w-full bg-transparent border-0 focus:outline-none text-xs text-yellow-950 leading-relaxed resize-none placeholder:text-yellow-800/40"
          style={{ borderBottom: "1px solid rgba(161,120,0,0.2)" }}
        />
      </div>
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
