"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  leadId: string;
  initialBody: string;
  initialUpdatedAt: string | null;
}

const MINIMIZE_KEY = (id: string) => `sticky-minimized-${id}`;

/**
 * Zoho-style floating sticky-note widget.
 * Floats over page content (position: fixed, bottom-right).
 * Supports rich-text editing via contenteditable + execCommand.
 * Auto-saves with a 1.5s debounce. Minimize state is persisted in localStorage.
 */
export default function StickyNoteWidget({ leadId, initialBody, initialUpdatedAt }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(initialBody);

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(initialUpdatedAt);
  const [minimized, setMinimized] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Relative-time ticker — re-renders every 30s
  const [, forceRender] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceRender((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Read persisted minimize state on mount, then seed editor content
  useEffect(() => {
    try {
      const stored = localStorage.getItem(MINIMIZE_KEY(leadId));
      if (stored === "1") setMinimized(true);
    } catch {
      // localStorage unavailable (e.g. SSR guard — shouldn't reach here, but safe)
    }
  }, [leadId]);

  // Seed contenteditable on mount
  useEffect(() => {
    if (!editorRef.current) return;
    // Render as HTML if the body contains HTML tags, otherwise as plain text
    if (/<[a-z][\s\S]*>/i.test(initialBody)) {
      editorRef.current.innerHTML = initialBody;
    } else {
      editorRef.current.innerText = initialBody;
    }
  // Only run on mount — we intentionally ignore initialBody changes after mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist minimize state
  const toggleMinimize = useCallback(() => {
    setMinimized((prev) => {
      const next = !prev;
      try {
        if (next) {
          localStorage.setItem(MINIMIZE_KEY(leadId), "1");
        } else {
          localStorage.removeItem(MINIMIZE_KEY(leadId));
        }
      } catch {/* ignore */}
      return next;
    });
  }, [leadId]);

  // Save logic
  const save = useCallback(async () => {
    if (!editorRef.current) return;
    const current = editorRef.current.innerHTML;
    if (current === lastSavedRef.current) return;
    setStatus("saving");
    try {
      const r = await fetch(`/api/leads/${leadId}/sticky-note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: current }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      lastSavedRef.current = current;
      setSavedAt(j.updatedAt ?? new Date().toISOString());
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, [leadId]);

  // Debounced save trigger
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(save, 1500);
  }, [save]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Toolbar command helper — e.preventDefault() is critical to keep focus
  function execCmd(cmd: string, value?: string) {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
    scheduleSave();
  }

  // Status label
  const relTime = savedAt ? relativeTime(savedAt) : null;
  const statusLabel =
    status === "saving"
      ? "Saving…"
      : status === "error"
      ? "Save failed"
      : relTime
      ? `Saved ${relTime}`
      : "Saved just now";

  // If hidden (X was clicked), render nothing visible — but keep state alive
  if (hidden) return null;

  // ── Minimized tab ──────────────────────────────────────────────────────────
  if (minimized) {
    return (
      <button
        type="button"
        onClick={toggleMinimize}
        style={{
          position: "fixed",
          bottom: 80,
          right: 16,
          zIndex: 9999,
          background: "#f5e642",
          border: "1.5px solid #d4c200",
          borderRadius: "8px 8px 4px 4px",
          padding: "6px 14px",
          fontSize: 13,
          fontWeight: 600,
          color: "#5a4800",
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          userSelect: "none",
        }}
      >
        📝 <span>Note</span>
      </button>
    );
  }

  // ── Expanded widget ────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: "fixed",
        bottom: 80,
        right: 16,
        zIndex: 9999,
        width: 320,
        boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
        borderRadius: 12,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: "inherit",
      }}
    >
      {/* ── Header bar ───────────────────────────────────────────────────── */}
      <div
        style={{
          background: "#f5e642",
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #d4c200",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "#5a4800", display: "flex", alignItems: "center", gap: 5 }}>
          📝 Sticky Note
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {/* Minimize */}
          <button
            type="button"
            title="Minimize"
            onClick={toggleMinimize}
            style={headerBtnStyle}
            onMouseEnter={(e) => Object.assign((e.target as HTMLElement).style, headerBtnHover)}
            onMouseLeave={(e) => Object.assign((e.target as HTMLElement).style, headerBtnStyle)}
          >
            _
          </button>
          {/* Close / hide */}
          <button
            type="button"
            title="Hide"
            onClick={() => setHidden(true)}
            style={headerBtnStyle}
            onMouseEnter={(e) => Object.assign((e.target as HTMLElement).style, headerBtnHover)}
            onMouseLeave={(e) => Object.assign((e.target as HTMLElement).style, headerBtnStyle)}
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div
        style={{
          background: "#fef9c3",
          borderBottom: "1px solid #e9d800",
          display: "flex",
          alignItems: "center",
          padding: "3px 6px",
          gap: 2,
        }}
      >
        {(
          [
            { label: "B", cmd: "bold", title: "Bold", style: { fontWeight: "bold" } },
            { label: "I", cmd: "italic", title: "Italic", style: { fontStyle: "italic" } },
            { label: "U", cmd: "underline", title: "Underline", style: { textDecoration: "underline" } },
            { label: "•", cmd: "insertUnorderedList", title: "Bullets" },
            { label: "1.", cmd: "insertOrderedList", title: "Numbered list" },
          ] as Array<{ label: string; cmd: string; title: string; style?: React.CSSProperties }>
        ).map(({ label, cmd, title, style: btnLabelStyle }) => (
          <button
            key={cmd}
            type="button"
            title={title}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus in contenteditable
              execCmd(cmd);
            }}
            style={toolbarBtnStyle}
            onMouseEnter={(e) => Object.assign((e.target as HTMLElement).style, toolbarBtnHover)}
            onMouseLeave={(e) => Object.assign((e.target as HTMLElement).style, toolbarBtnStyle)}
          >
            <span style={btnLabelStyle}>{label}</span>
          </button>
        ))}

        {/* Clear formatting */}
        <button
          type="button"
          title="Clear formatting"
          onMouseDown={(e) => {
            e.preventDefault();
            execCmd("removeFormat");
          }}
          style={{ ...toolbarBtnStyle, marginLeft: "auto" }}
          onMouseEnter={(e) => Object.assign((e.target as HTMLElement).style, { ...toolbarBtnHover, marginLeft: "auto" })}
          onMouseLeave={(e) => Object.assign((e.target as HTMLElement).style, { ...toolbarBtnStyle, marginLeft: "auto" })}
        >
          <span title="Clear formatting">⎎</span>
        </button>
      </div>

      {/* ── Writing area ─────────────────────────────────────────────────── */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={scheduleSave}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter triggers immediate save
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            save();
          }
        }}
        data-placeholder="Scratch notes only you can see…"
        style={{
          background: "#fffde7",
          minHeight: 160,
          padding: "10px 12px",
          fontSize: 13,
          lineHeight: 1.6,
          color: "#3b2f00",
          outline: "none",
          overflowY: "auto",
          maxHeight: 360,
          wordBreak: "break-word",
        }}
      />

      {/* ── Status bar ───────────────────────────────────────────────────── */}
      <div
        style={{
          background: "#fafafa",
          borderTop: "1px solid #e5e7eb",
          padding: "4px 10px",
          fontSize: 11,
          color: status === "error" ? "#cc0000" : "#6b7280",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        💾 {statusLabel}
      </div>

      {/* Placeholder CSS injected as a style tag scoped to this widget */}
      <style>{`
        [contenteditable][data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: rgba(120,100,0,0.35);
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

// ── Shared style objects ─────────────────────────────────────────────────────

const headerBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  borderRadius: 4,
  width: 22,
  height: 22,
  cursor: "pointer",
  fontSize: 13,
  color: "#5a4800",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
  padding: 0,
};

const headerBtnHover: React.CSSProperties = {
  ...headerBtnStyle,
  background: "rgba(0,0,0,0.12)",
};

const toolbarBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 4,
  width: 26,
  height: 24,
  cursor: "pointer",
  fontSize: 12,
  color: "#5a4800",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

const toolbarBtnHover: React.CSSProperties = {
  ...toolbarBtnStyle,
  background: "#fde047",
  border: "1px solid #d4c200",
};

// ── Relative-time helper ─────────────────────────────────────────────────────

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
