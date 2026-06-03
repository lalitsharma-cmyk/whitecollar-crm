"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Props {
  leadId: string;
  initialBody: string;
  initialUpdatedAt: string | null;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function StickyNoteWidget({ leadId, initialBody, initialUpdatedAt }: Props) {
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isMobile, setIsMobile] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRef = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);

  const LS_POS = `sticky-pos-${leadId}`;
  const LS_MIN = `sticky-min-${leadId}`;
  const LS_VIS = `sticky-vis-${leadId}`;

  useEffect(() => {
    const mobile = window.innerWidth < 640;
    setIsMobile(mobile);
    try {
      const savedPos = localStorage.getItem(LS_POS);
      if (savedPos) setPos(JSON.parse(savedPos));
      else setPos({ top: Math.max(60, window.innerHeight - 480), left: Math.max(0, window.innerWidth - 352) });

      const savedMin = localStorage.getItem(LS_MIN);
      if (savedMin === "true") setMinimized(true);

      const savedVis = localStorage.getItem(LS_VIS);
      if (savedVis === "true") setVisible(true);
      else if (initialBody) setVisible(true);
    } catch {
      setPos({ top: Math.max(60, window.innerHeight - 480), left: Math.max(0, window.innerWidth - 352) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // Seed contenteditable once
  useEffect(() => {
    if (editorRef.current && initialBody) {
      editorRef.current.innerHTML = initialBody;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for open-sticky trigger from action bar button
  useEffect(() => {
    const handler = () => {
      setVisible(true);
      setMinimized(false);
      try { localStorage.setItem(LS_VIS, "true"); localStorage.setItem(LS_MIN, "false"); } catch {}
    };
    const eventName = `open-sticky-${leadId}`;
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }, [leadId, LS_VIS, LS_MIN]);

  const saveToServer = useCallback((html: string) => {
    fetch(`/api/leads/${leadId}/sticky-note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: html }),
    }).then((r) => setSaveStatus(r.ok ? "saved" : "error"))
      .catch(() => setSaveStatus("error"));
  }, [leadId]);

  function handleInput() {
    const html = editorRef.current?.innerHTML ?? "";
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveToServer(html), 1500);
  }

  function fmt(cmd: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, undefined);
  }

  function handleClose() {
    setVisible(false);
    try { localStorage.setItem(LS_VIS, "false"); } catch {}
  }

  function handleMinimize() {
    const next = !minimized;
    setMinimized(next);
    try { localStorage.setItem(LS_MIN, String(next)); } catch {}
  }

  function handleDragStart(e: React.MouseEvent) {
    if (!pos) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startTop: pos.top, startLeft: pos.left };

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const newTop = Math.max(0, Math.min(window.innerHeight - 60, dragRef.current.startTop + ev.clientY - dragRef.current.startY));
      const newLeft = Math.max(0, Math.min(window.innerWidth - 60, dragRef.current.startLeft + ev.clientX - dragRef.current.startX));
      const newPos = { top: newTop, left: newLeft };
      setPos(newPos);
      try { localStorage.setItem(`sticky-pos-${leadId}`, JSON.stringify(newPos)); } catch {}
    }
    function onUp() {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const statusText =
    saveStatus === "saving" ? "Saving…" :
    saveStatus === "saved"  ? "✓ Saved" :
    saveStatus === "error"  ? "⚠ Save failed" :
    initialUpdatedAt ? `Saved ${new Date(initialUpdatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : "";

  const TOOLBAR = [
    { cmd: "bold",                label: "B",  cls: "font-bold" },
    { cmd: "italic",              label: "I",  cls: "italic" },
    { cmd: "underline",           label: "U",  cls: "underline" },
    { cmd: "insertUnorderedList", label: "•",  cls: "" },
    { cmd: "insertOrderedList",   label: "1.", cls: "" },
    { cmd: "removeFormat",        label: "⎌", cls: "" },
  ];

  if (!visible || pos === null) return null;

  // ── Mobile: full-screen bottom sheet ──────────────────────────────────────
  if (isMobile) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.4)" }}>
        <div className="flex-1" onClick={handleClose} />
        <div className="flex flex-col rounded-t-2xl" style={{ background: "#fffde7", maxHeight: "85vh" }}>
          <div className="flex items-center justify-between px-4 py-3 rounded-t-2xl" style={{ background: "#f5e642" }}>
            <span className="font-bold text-sm" style={{ color: "#4a3600" }}>
              📝 Sticky Note <span className="font-normal text-xs opacity-70">· Private to you</span>
            </span>
            <button onClick={handleClose} className="w-7 h-7 rounded-full text-sm flex items-center justify-center" style={{ background: "#e6cc00", color: "#4a3600" }}>✕</button>
          </div>
          <div className="flex gap-1 px-3 py-2" style={{ background: "#fef9c3", borderBottom: "1px solid #f0d900" }}>
            {TOOLBAR.map(({ cmd, label, cls }) => (
              <button key={cmd} type="button"
                onMouseDown={(e) => { e.preventDefault(); fmt(cmd); }}
                className={`w-8 h-8 rounded text-xs hover:bg-yellow-200 ${cls}`}
                style={{ color: "#4a3600" }}>{label}</button>
            ))}
          </div>
          <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={handleInput}
            className="flex-1 p-4 text-sm outline-none overflow-y-auto"
            style={{ minHeight: 200, background: "#fffde7" }}
          />
          <div className="px-4 py-2 text-[10px]" style={{ color: "#8a6f00", background: "#fef9c3", borderTop: "1px solid #f0d900" }}>
            {statusText}
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop: minimized tab ─────────────────────────────────────────────────
  if (minimized) {
    return (
      <button
        onClick={handleMinimize}
        className="fixed z-[9999] flex items-center gap-1.5 px-3 py-2 rounded-xl shadow-lg text-sm font-semibold"
        style={{ top: pos.top + "px", left: pos.left + "px", background: "#f5e642", color: "#4a3600" }}
      >
        📝 Note
      </button>
    );
  }

  // ── Desktop: full draggable + resizable window ─────────────────────────────
  return (
    <div
      ref={widgetRef}
      className="fixed z-[9999] rounded-xl shadow-2xl flex flex-col"
      style={{
        top: pos.top + "px",
        left: pos.left + "px",
        width: 320,
        minWidth: 220,
        minHeight: 220,
        maxWidth: "90vw",
        maxHeight: "80vh",
        background: "#fffde7",
        resize: "both",
        overflow: "auto",
      }}
    >
      {/* Drag handle / header */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2 flex-shrink-0 select-none cursor-grab active:cursor-grabbing rounded-t-xl"
        style={{ background: "#f5e642", borderBottom: "1px solid #e6cc00" }}
      >
        <span className="text-xs font-bold" style={{ color: "#4a3600" }}>
          📝 Sticky Note <span className="font-normal opacity-60">· Private</span>
        </span>
        <div className="flex gap-1">
          <button type="button" onClick={handleMinimize}
            className="w-5 h-5 rounded text-[11px] flex items-center justify-center hover:bg-yellow-300"
            style={{ color: "#4a3600" }} title="Minimize">—</button>
          <button type="button" onClick={handleClose}
            className="w-5 h-5 rounded text-[11px] flex items-center justify-center hover:bg-yellow-300"
            style={{ color: "#4a3600" }} title="Close">✕</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex gap-0.5 px-2 py-1 flex-shrink-0" style={{ background: "#fef9c3", borderBottom: "1px solid #f0d900" }}>
        {TOOLBAR.map(({ cmd, label, cls }) => (
          <button key={cmd} type="button"
            onMouseDown={(e) => { e.preventDefault(); fmt(cmd); }}
            className={`w-7 h-7 rounded text-xs hover:bg-yellow-200 ${cls}`}
            style={{ color: "#4a3600" }}>{label}</button>
        ))}
      </div>

      {/* Writing area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        className="flex-1 p-3 text-sm outline-none overflow-y-auto"
        style={{ background: "#fffde7", minHeight: 140 }}
      />

      {/* Status bar */}
      <div className="px-3 py-1.5 text-[10px] flex-shrink-0 rounded-b-xl" style={{ background: "#fef9c3", borderTop: "1px solid #f0d900", color: "#8a6f00" }}>
        {statusText}
        <span className="opacity-40 ml-1.5">· drag header · resize ↘</span>
      </div>
    </div>
  );
}
