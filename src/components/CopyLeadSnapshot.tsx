"use client";

// CopyLeadSnapshot — one-tap "copy a clean text summary of this lead" button.
// Lalit's team shares lead context with each other over WhatsApp constantly;
// this saves them re-typing the same fields. Pure client, no API — the page
// passes the (already-authorized) lead fields as serializable props.

import { useState } from "react";

interface Props {
  leadId: string;
  name: string;
  phone: string | null;
  budget: string | null;       // pre-formatted, e.g. "AED 5.0 M"
  status: string;
  aiScore: string | null;
  owner: string | null;
  lastTouched: string | null;  // pre-formatted relative, e.g. "2 hours ago"
  nextFollowup: string | null; // pre-formatted, e.g. "Tomorrow 4pm IST"
  projects: string[];          // ["Burj Vista (Dubai)", ...]
  whoIsClient: string | null;
}

export default function CopyLeadSnapshot(props: Props) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(false);

  function build(): string {
    const lines: string[] = [];
    lines.push(`📋 LEAD SNAPSHOT — ${props.name}`);
    if (props.phone) lines.push(`📞 ${props.phone}`);
    if (props.budget) lines.push(`💰 Budget: ${props.budget}`);
    lines.push(`🏷 Status: ${props.status.replaceAll("_", " ")}${props.aiScore ? ` · ${props.aiScore}` : ""}`);
    if (props.owner) lines.push(`👤 Owner: ${props.owner}`);
    if (props.lastTouched) lines.push(`🕐 Last touched: ${props.lastTouched}`);
    if (props.nextFollowup) lines.push(`📅 Next followup: ${props.nextFollowup}`);
    if (props.projects.length > 0) {
      lines.push("");
      lines.push("Projects discussed:");
      for (const p of props.projects) lines.push(`- ${p}`);
    }
    if (props.whoIsClient && props.whoIsClient.trim()) {
      lines.push("");
      lines.push("Who is the client:");
      lines.push(props.whoIsClient.trim());
    }
    lines.push("");
    lines.push("───");
    lines.push(`View in CRM: https://crm.whitecollarrealty.com/leads/${props.leadId}`);
    return lines.join("\n");
  }

  async function copy() {
    const text = build();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older mobile browsers / non-secure contexts.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setErr(false);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setErr(true);
      window.setTimeout(() => setErr(false), 2500);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="btn btn-ghost text-xs w-full justify-center"
      title="Copy a clean text summary to share via WhatsApp / email"
    >
      {copied ? "✅ Copied — paste anywhere" : err ? "⚠ Copy failed" : "📋 Copy lead snapshot"}
    </button>
  );
}
