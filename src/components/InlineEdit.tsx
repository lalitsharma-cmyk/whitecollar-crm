"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isPastISTLocalInput } from "@/lib/datetime";
import DateTimeIST from "./DateTimeIST";
import { parseBudget } from "@/lib/budgetParse";

type FieldType = "text" | "textarea" | "number" | "date" | "select" | "phone";

interface Props {
  // Optional so this shared editor can target non-lead detail routes (e.g. buyer
  // data). When `endpoint` is omitted the legacy `/api/leads/${leadId}/update`
  // path is used, so EVERY existing lead call-site (which passes leadId and no
  // endpoint) behaves exactly as before.
  leadId?: string;
  // Optional PATCH target. When set, save() PATCHes this URL instead of the
  // default lead update route. Lets Revival/Buyer reuse InlineEdit unchanged.
  endpoint?: string;
  field: string;       // backend field name
  label?: string;      // display label
  value: string | number | null;
  type?: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  multiline?: boolean;
  prefix?: string;     // displayed before value when read-only (e.g. "₹ ")
  className?: string;
  // Optional formatted-display override. When set, the read-only view shows
  // this string instead of the raw value. Used for budget cells so the
  // qualification card shows "12M AED" / "1.2 Cr" — never "12000000".
  // Edit mode still operates on the raw `value` so the user can type new
  // numbers (or K/M/L/Cr shorthand if `parseAs="budget"` is also set).
  display?: string;
  // Optional shorthand parser. String values only — functions can't cross
  // the RSC server→client boundary. "budget" → parseBudget() runs locally
  // inside this client component on save, converting "2.5M"/"30L"/"3Cr" to
  // the numeric value before PATCHing the API.
  parseAs?: "budget";
  // Hint shown below the input in edit mode (e.g. "type 30L · 3Cr · 500K").
  editHint?: string;
}

export default function InlineEdit({ leadId, endpoint, field, label, value, type = "text", options, placeholder, prefix, className, display, parseAs, editHint }: Props) {
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
    if (type === "phone" && v) {
      const digits = v.replace(/\D/g, "");
      if (digits.length < 10) {
        setErr("Phone must have at least 10 digits.");
        setBusy(false);
        return;
      }
    }
    try {
      // For datetime fields, append explicit IST offset so the server parses
      // the user's IST wall-clock as the correct UTC instant. Without this,
      // "2026-05-26T18:00" gets parsed in Vercel's UTC and saved as 18:00 UTC
      // (= 11:30pm IST — 5.5 hours off).
      let payload: string | number | null = type === "date" && v ? `${v}:00+05:30` : v;
      // Optional shorthand → numeric. Used by budget cells so the agent can
      // type "2.5M" / "30L" / "3Cr" and we save the parsed number. The parser
      // lives in this client file (imported above) because functions can't be
      // passed as props from a Server Component.
      if (parseAs === "budget" && v) {
        const parsed = parseBudget(v);
        if (parsed == null) {
          setErr("Couldn't parse — try 2.5M, 30L, 3Cr, or just digits.");
          setBusy(false);
          return;
        }
        payload = parsed;
      }
      // Default to the lead update route; an explicit `endpoint` overrides it so
      // non-lead detail pages (buyer, etc.) reuse this same editor + save flow.
      const url = endpoint ?? `/api/leads/${leadId}/update`;
      const r = await fetch(url, {
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

  // ── Lock-after-selection fix ────────────────────────────────────────────────
  // A select field appeared "locked" once a value was set: if the current stored
  // value was NOT present in `options` (legacy/custom value, or a list that was
  // derived from the DB and didn't include this row's value), the <select> fell
  // back to rendering the FIRST option (the "—" placeholder). Re-opening then
  // showed a mismatched/blank dropdown, so the field looked un-editable / stuck.
  // FIX: ALWAYS guarantee the current value is a selectable option. We build
  // `selectOptions` = the passed options, with the current value injected at the
  // top when it's missing. The dropdown therefore always reflects the saved value
  // AND always lets you pick a different one — reopenable any number of times.
  const selectOptions = (() => {
    if (type !== "select" || !options) return options;
    const cur = value == null ? "" : String(value);
    if (cur === "" || options.some(o => o.value === cur)) return options;
    // Current value isn't in the list → prepend it so it's visible + selectable.
    return [{ value: cur, label: cur }, ...options];
  })();

  // For select fields: resolve the option label for the read-only view so the
  // agent sees "30 Days" not "THIRTY_DAYS". Strip leading emoji if present.
  const resolvedDisplay = (() => {
    if (display) return display;
    if (type === "select" && selectOptions && value != null && value !== "") {
      const found = selectOptions.find(o => o.value === String(value));
      if (found) return found.label.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\s]+/u, "").trim();
    }
    return null;
  })();

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
            ? <span className="text-gray-400 italic">{placeholder ?? "Add Value"}</span>
            : <>{prefix}{pretty}</>}
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
          ? <span className="text-gray-400 italic">{placeholder ?? "Add Value"}</span>
          : <>{prefix}{resolvedDisplay ?? String(value)}</>}
      </span>
    );
  }

  const inputCls = "border border-[#c9a24b] rounded px-2 py-1 text-sm w-full";

  const errLine = err ? <div className="text-[11px] text-red-600 mt-1">⚠ {err}</div> : null;

  if (type === "select" && selectOptions) {
    return (
      <div className="inline-flex flex-col">
        <div className="flex items-center gap-1">
          <select value={v} onChange={(e) => setV(e.target.value)} className="min-w-[90px] border border-[#c9a24b] rounded px-2 py-1 text-sm" autoFocus>
            <option value="">—</option>
            {selectOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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

  if (type === "phone") {
    return (
      <span className="inline-flex flex-col">
        <span className="inline-flex items-center gap-1">
          <input
            type="text"
            inputMode="tel"
            pattern="[0-9+\s\-()]+"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            className={inputCls}
            autoFocus
          />
          <button onClick={save} disabled={busy} aria-label="Save" className="text-emerald-600 hover:bg-emerald-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✓</button>
          <button onClick={cancel} aria-label="Cancel" className="text-red-600 hover:bg-red-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✕</button>
        </span>
        <div className="text-[11px] text-gray-400 mt-1">Numbers only, min 10 digits. Include country code (e.g. +971 or +91)</div>
        {errLine}
      </span>
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

  // If parseAs is set (e.g. budget cells accepting "2.5M"), use a text
  // input even when type="number" so K/M/L/Cr letters can be typed.
  const useTextInput = !!parseAs || type !== "number";
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1">
        <input
          type={useTextInput ? "text" : "number"}
          value={v}
          onChange={(e) => setV(useTextInput ? e.target.value : e.target.value.replace(/^-/, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
          className={inputCls}
          {...(useTextInput ? {} : { min: 0, inputMode: "numeric" as const })}
          autoFocus
        />
        <button onClick={save} disabled={busy} aria-label="Save" className="text-emerald-600 hover:bg-emerald-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✓</button>
        <button onClick={cancel} aria-label="Cancel" className="text-red-600 hover:bg-red-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✕</button>
      </span>
      {editHint && <span className="text-[10px] text-gray-500 mt-0.5">{editHint}</span>}
      {errLine}
    </span>
  );
}
