"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isPastISTLocalInput } from "@/lib/datetime";
import DateTimeIST from "./DateTimeIST";

type FieldType = "text" | "textarea" | "number" | "date" | "select";

interface Props {
  leadId: string;
  field: string;       // backend field name
  label?: string;      // display label
  value: string | number | null;
  type?: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  multiline?: boolean;
  prefix?: string;     // displayed before value when read-only (e.g. "₹ ")
  className?: string;
}

export default function InlineEdit({ leadId, field, label, value, type = "text", options, placeholder, prefix, className }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<string>(value == null ? "" : String(value));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    // Client-side guard for date pickers: reject past IST dates before hitting
    // the server. Belt-and-braces — the input also has min={nowISTLocalInput()}.
    if (type === "date" && v && isPastISTLocalInput(v)) {
      setErr("Pick a future date/time (IST). Past dates aren't allowed for scheduling.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      // For datetime fields, append explicit IST offset so the server parses
      // the user's IST wall-clock as the correct UTC instant. Without this,
      // "2026-05-26T18:00" gets parsed in Vercel's UTC and saved as 18:00 UTC
      // (= 11:30pm IST — 5.5 hours off).
      const payload = type === "date" && v ? `${v}:00+05:30` : v;
      const r = await fetch(`/api/leads/${leadId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: payload }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Save failed (${r.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBusy(false); }
  }

  function cancel() { setV(value == null ? "" : String(value)); setEditing(false); setErr(null); }

  if (!editing) {
    // Textarea fields (remarks, whoIsClient, etc.) preserve line breaks + multi-line
    // formatting in the read-only view — otherwise multi-line imported text from
    // Google Sheets collapses to one visual line.
    //
    // Special-case: Lalit's MIS remarks cells use runs of `,,,,` as visual
    // separators instead of newlines. The full conversation history IS in the
    // string (e.g. 1664 chars / 9 call entries for Shivam) but renders as one
    // unreadable comma-blob. Pretty-print here: collapse runs of 2+ commas
    // (optionally surrounded by whitespace) to a paragraph break. Doesn't
    // mutate the stored value — purely for display.
    if (type === "textarea") {
      const raw = value == null ? "" : String(value);
      const pretty = raw
        .replace(/(\s*,\s*){2,}/g, "\n\n")      // 2+ commas → blank line
        .replace(/\n{3,}/g, "\n\n")              // collapse triple+ newlines
        .replace(/^[\s,]+|[\s,]+$/g, "");        // trim leading/trailing junk
      // QA caught: if remarks is just whitespace/commas, `pretty` becomes empty
      // but `raw === ""` is false, so the placeholder didn't fire — card looked
      // visually blank. Show the placeholder whenever pretty is empty.
      const isEffectivelyEmpty = pretty.trim() === "";
      return (
        <div
          onClick={() => setEditing(true)}
          className={`cursor-pointer hover:bg-amber-50 rounded p-1 -mx-1 whitespace-pre-wrap leading-relaxed ${className ?? ""}`}
          title="Click to edit"
        >
          {isEffectivelyEmpty
            ? <span className="text-gray-400 italic">{placeholder ?? "click to set"}</span>
            : <>{prefix}{pretty}</>}
          <span className="text-[10px] text-gray-400 ml-1">✎</span>
        </div>
      );
    }
    return (
      <span
        onClick={() => setEditing(true)}
        className={`cursor-pointer hover:bg-amber-50 rounded px-1 -mx-1 inline-block ${className ?? ""}`}
        title="Click to edit"
      >
        {value == null || value === ""
          ? <span className="text-gray-400 italic">{placeholder ?? "click to set"}</span>
          : <>{prefix}{String(value)}</>}
        <span className="text-[10px] text-gray-400 ml-1">✎</span>
      </span>
    );
  }

  const inputCls = "border border-[#c9a24b] rounded px-2 py-1 text-sm w-full";

  const errLine = err ? <div className="text-[11px] text-red-600 mt-1">⚠ {err}</div> : null;

  if (type === "select" && options) {
    return (
      <div className="inline-flex flex-col">
        <div className="inline-flex items-center gap-1">
          <select value={v} onChange={(e) => setV(e.target.value)} className={inputCls} autoFocus>
            <option value="">—</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={save} disabled={busy} aria-label="Save" className="text-emerald-600 hover:bg-emerald-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✓</button>
          <button onClick={cancel} aria-label="Cancel" className="text-red-600 hover:bg-red-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✕</button>
        </div>
        {errLine}
      </div>
    );
  }

  if (type === "textarea") {
    // For long imported remarks (which can be 1500+ chars / 9 call entries),
    // 4 rows was way too short — agents thought entries were missing because
    // they couldn't see past the scroll. Auto-size between 10 and 24 rows based
    // on the current text length.
    const lines = (v.match(/\n/g)?.length ?? 0) + Math.ceil(v.length / 80);
    const rows = Math.min(24, Math.max(10, lines));
    return (
      <div>
        <textarea value={v} onChange={(e) => setV(e.target.value)} rows={rows} className={inputCls + " min-h-[200px] font-mono text-[12px] leading-relaxed"} autoFocus onKeyDown={(e) => { if (e.key === "Escape") cancel(); }} />
        <div className="flex gap-2 mt-1">
          <button onClick={save} disabled={busy} className="btn btn-primary text-xs py-1">{busy ? "..." : "Save"}</button>
          <button onClick={cancel} className="text-xs text-gray-500">Cancel</button>
        </div>
        {errLine}
      </div>
    );
  }

  // Date type uses the split DateTimeIST picker (visible time portion on mobile).
  // Lalit reported "time anywhere is not clickable" — the combined datetime-local
  // hides the time on Android. DateTimeIST renders two side-by-side inputs.
  if (type === "date") {
    return (
      <div className="flex flex-col gap-2">
        <DateTimeIST value={v} onChange={setV} futureOnly />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy}
            aria-label="Save"
            className="btn btn-primary text-xs flex-1 justify-center min-h-11"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            onClick={cancel}
            aria-label="Cancel"
            className="btn btn-ghost text-xs flex-1 justify-center min-h-11"
          >
            Cancel
          </button>
        </div>
        {errLine}
      </div>
    );
  }

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1">
        <input
          type={type === "number" ? "number" : "text"}
          value={v}
          onChange={(e) => setV(type === "number" ? e.target.value.replace(/^-/, "") : e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
          className={inputCls}
          {...(type === "number" ? { min: 0, inputMode: "numeric" as const } : {})}
          autoFocus
        />
        <button onClick={save} disabled={busy} aria-label="Save" className="text-emerald-600 hover:bg-emerald-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✓</button>
        <button onClick={cancel} aria-label="Cancel" className="text-red-600 hover:bg-red-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✕</button>
      </span>
      {errLine}
    </span>
  );
}
