"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Props {
  leadId: string;
  initialBody: string;
  initialUpdatedAt: string | null;
  /** API base for the sticky-note PUT. Defaults to "/api/leads" (the Lead view).
   *  Buyer Data passes "/api/buyer-data" to reuse this exact widget against its own
   *  per-user-per-buyer sticky note. The trigger event name + localStorage keys are
   *  derived from leadId so two records never collide. */
  apiBase?: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function StickyNoteWidget({ leadId, initialBody, initialUpdatedAt, apiBase = "/api/leads" }: Props) {
  const [visible, setVisible]       = useState(false);
  const [minimized, setMinimized]   = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [text, setText]             = useState(initialBody);
  const [isMobile, setIsMobile]     = useState(false);
  const [pos, setPos]               = useState<{ top: number; left: number } | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const widgetRef = useRef<HTMLDivElement>(null);
  const dragRef   = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);

  const LS_POS = `sticky-pos-${leadId}`;
  const LS_MIN = `sticky-min-${leadId}`;
  const LS_VIS = `sticky-vis-${leadId}`;

  // Restore position / minimized / visible state from localStorage
  useEffect(() => {
    const mobile = window.innerWidth < 640;
    setIsMobile(mobile);
    try {
      const savedPos = localStorage.getItem(LS_POS);
      if (savedPos) setPos(JSON.parse(savedPos));
      else setPos({ top: Math.max(60, window.innerHeight - 420), left: Math.max(0, window.innerWidth - 340) });
      if (localStorage.getItem(LS_MIN) === "true") setMinimized(true);
      const savedVis = localStorage.getItem(LS_VIS);
      if (savedVis === "true") setVisible(true);
      else if (initialBody) setVisible(true);
    } catch {
      setPos({ top: Math.max(60, window.innerHeight - 420), left: Math.max(0, window.innerWidth - 340) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // Listen for open-sticky trigger from the action bar button
  useEffect(() => {
    const handler = () => {
      setVisible(true);
      setMinimized(false);
      try { localStorage.setItem(LS_VIS, "true"); localStorage.setItem(LS_MIN, "false"); } catch {}
    };
    window.addEventListener(`open-sticky-${leadId}`, handler);
    return () => window.removeEventListener(`open-sticky-${leadId}`, handler);
  }, [leadId, LS_VIS, LS_MIN]);

  const saveToServer = useCallback((value: string) => {
    fetch(`${apiBase}/${leadId}/sticky-note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: value }),
    })
      .then(r => setSaveStatus(r.ok ? "saved" : "error"))
      .catch(() => setSaveStatus("error"));
  }, [leadId, apiBase]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveToServer(value), 1500);
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
      const newPos = {
        top:  Math.max(0, Math.min(window.innerHeight - 60, dragRef.current.startTop  + ev.clientY - dragRef.current.startY)),
        left: Math.max(0, Math.min(window.innerWidth  - 60, dragRef.current.startLeft + ev.clientX - dragRef.current.startX)),
      };
      setPos(newPos);
      try { localStorage.setItem(LS_POS, JSON.stringify(newPos)); } catch {}
    }
    function onUp() {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Status bar text
  const savedDateStr = initialUpdatedAt
    ? new Date(initialUpdatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  const statusText =
    saveStatus === "saving" ? "Saving…" :
    saveStatus === "saved"  ? "✓ Saved" :
    saveStatus === "error"  ? "⚠ Save failed" :
    savedDateStr            ? `Last saved: ${savedDateStr}` : "Not yet saved";

  if (!visible || pos === null) return null;

  // ── Mobile: full-screen bottom sheet ─────────────────────────────────────
  if (isMobile) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.4)" }}>
        <div className="flex-1" onClick={handleClose} />
        <div className="flex flex-col rounded-t-2xl" style={{ background: "#fffde7", maxHeight: "80vh" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 rounded-t-2xl cursor-grab" style={{ background: "#f5e642" }}>
            <span className="font-bold text-sm" style={{ color: "#4a3600" }}>
              📝 Sticky Note
              <span className="font-normal text-xs ml-1 opacity-60">· Private</span>
            </span>
            <button onClick={handleClose} className="w-7 h-7 rounded-full text-sm flex items-center justify-center" style={{ background: "#e6cc00", color: "#4a3600" }}>✕</button>
          </div>
          {/* Text area */}
          <textarea
            value={text}
            onChange={handleChange}
            placeholder={"Quick private note…\n\nExamples:\n• Decision maker is wife\n• Very price sensitive\n• Call after son's admission"}
            className="flex-1 p-4 text-sm outline-none resize-none"
            style={{ background: "#fffde7", color: "#2d1f00", minHeight: 180, fontFamily: "inherit" }}
          />
          {/* Status */}
          <div className="px-4 py-2 text-[10px]" style={{ color: "#8a6f00", background: "#fef9c3", borderTop: "1px solid #f0d900" }}>
            {statusText}
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop: minimized tab ───────────────────────────────────────────────
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

  // ── Desktop: draggable + resizable sticky note ───────────────────────────
  return (
    <div
      ref={widgetRef}
      className="fixed z-[9999] rounded-xl shadow-2xl flex flex-col"
      style={{
        top: pos.top + "px", left: pos.left + "px",
        width: 300, minWidth: 200, minHeight: 200, maxWidth: "90vw", maxHeight: "75vh",
        background: "#fffde7",
        resize: "both",
        overflow: "hidden",
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2 flex-shrink-0 select-none cursor-grab active:cursor-grabbing rounded-t-xl"
        style={{ background: "#f5e642", borderBottom: "1px solid #e6cc00" }}
      >
        <span className="text-xs font-bold" style={{ color: "#4a3600" }}>
          📝 Sticky Note
          <span className="font-normal opacity-60 ml-1">· Private</span>
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

      {/* Plain text area — the whole point */}
      <textarea
        value={text}
        onChange={handleChange}
        placeholder={"Quick private note…\n\nExamples:\n• Decision maker is wife\n• Very price sensitive\n• Broker involved\n• Call after 6 PM"}
        className="flex-1 p-3 text-sm outline-none resize-none"
        style={{
          background: "#fffde7",
          color: "#2d1f00",
          fontFamily: "inherit",
          lineHeight: "1.55",
          // fill remaining height even when the widget is resized
          minHeight: 0,
          height: "100%",
        }}
      />

      {/* Status bar */}
      <div className="px-3 py-1 text-[10px] flex-shrink-0 rounded-b-xl flex items-center justify-between"
        style={{ background: "#fef9c3", borderTop: "1px solid #f0d900", color: "#8a6f00" }}
      >
        <span>{statusText}</span>
        <span className="opacity-30">drag · resize ↘</span>
      </div>
    </div>
  );
}
