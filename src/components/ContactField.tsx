"use client";

// Contact value (email / phone / alt-phone) for the lead detail "Client
// information" card. One self-contained cell that:
//   • renders the value as a mailto:/tel: link (truncated + full-value tooltip
//     so long emails never break the 2-column grid alignment),
//   • has a copy-to-clipboard icon (✓ flash on success),
//   • lets admins/managers edit inline via a pencil (same flow as LinkedInField),
//   • shows the "Add value" placeholder when empty,
//   • or renders plain read-only text (agent's MASKED primary phone — passed as
//     `readOnlyText` so an agent can't copy/dial the real number).
//
// PII rule: primary phone + email are admin/manager-only to EDIT, enforced
// server-side in /api/leads/[id]/update (ADMIN_ONLY_FIELDS). Alt-phone is
// editable by everyone. tel: links initiate a call on mobile; mailto: opens the
// default mail client.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Copy, Check } from "lucide-react";

type Kind = "email" | "phone";

interface Props {
  leadId: string;
  field: "email" | "phone" | "altPhone" | "altEmail";
  value: string | null;
  kind: Kind;
  /** Show the pencil + allow inline editing. */
  editable?: boolean;
  /** When set, render ONLY this text (e.g. a masked phone) — no link/copy/edit. */
  readOnlyText?: string;
  placeholder?: string;
}

/** tel: wants digits and a leading +, nothing else. */
function telHref(v: string): string {
  return `tel:${v.replace(/[^\d+]/g, "")}`;
}

export default function ContactField({
  leadId, field, value, kind, editable = false, readOnlyText, placeholder = "Add value",
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API blocked (insecure context) — ignore */
    }
  }

  async function save() {
    if (busy) return;
    const clean = v.trim();
    if (kind === "phone" && clean) {
      const digits = clean.replace(/\D/g, "");
      if (digits.length < 10) { setErr("Phone must have at least 10 digits."); return; }
    }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: clean }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Save failed (${r.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 60)}`);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setV(value ?? "");
    setEditing(false);
    setErr(null);
  }

  // Forced read-only (agent's masked primary phone) — plain text, nothing else.
  if (readOnlyText !== undefined) {
    return (
      <div className="mt-0.5 text-sm dark:text-slate-200">
        {readOnlyText ? readOnlyText : <span className="text-gray-400">—</span>}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="mt-0.5">
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type={kind === "email" ? "email" : "tel"}
            inputMode={kind === "email" ? "email" : "tel"}
            value={v}
            onChange={e => setV(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            placeholder={kind === "email" ? "name@email.com" : "+91 or +971…"}
            className="border border-[#c9a24b] rounded px-2 py-1 text-sm w-full bg-white dark:bg-slate-700 dark:text-slate-100"
          />
          <button onClick={save} disabled={busy} aria-label="Save"
            className="text-emerald-600 hover:bg-emerald-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✓</button>
          <button onClick={cancel} aria-label="Cancel"
            className="text-red-600 hover:bg-red-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✕</button>
        </div>
        {err && <div className="text-[11px] text-red-600 mt-1">⚠ {err}</div>}
      </div>
    );
  }

  // Empty → "Add value" (editable) or a dash (read-only viewer).
  if (!value || !value.trim()) {
    if (!editable) return <div className="mt-0.5 text-sm text-gray-400">—</div>;
    return (
      <button type="button" onClick={() => setEditing(true)}
        className="mt-0.5 text-sm text-gray-400 italic hover:bg-amber-50 dark:hover:bg-slate-700 rounded px-1 -mx-1"
        title={`Click to add ${kind}`}>
        {placeholder}
      </button>
    );
  }

  const href = kind === "email" ? `mailto:${value}` : telHref(value);

  // Saved → clickable link (truncate + full-value tooltip) + copy + optional edit.
  return (
    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
      <a href={href}
        className="text-sm text-blue-600 hover:underline dark:text-blue-400 truncate min-w-0"
        title={value}>
        {value}
      </a>
      <button type="button" onClick={copy} aria-label={`Copy ${kind}`} title={copied ? "Copied!" : "Copy"}
        className="flex-none text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {editable && (
        <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${kind}`} title="Edit"
          className="flex-none text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
