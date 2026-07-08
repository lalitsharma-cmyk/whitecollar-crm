"use client";
import { useCallback, useEffect, useState } from "react";
import {
  FolderOpen, Search, X, FileText, Link as LinkIcon,
  Image as ImageIcon, File as FileIcon, CheckCircle2, Send,
} from "lucide-react";
import { whatsappLink } from "@/lib/phone";
import { ActionButton } from "@/components/actions/ActionButton";
import { buildShareMessage, type ResourceTypeStr } from "@/lib/resources";
import { backdropProps } from "@/lib/useDismiss";

interface ResItem {
  id: string;
  title: string;
  category: string;
  type: ResourceTypeStr;
  mimeType: string | null;
  fileUrl: string | null;
  textContent: string | null;
  projectName: string | null;
}

interface ShareRow {
  id: string;
  channel: "WHATSAPP" | "EMAIL" | "ATTACH";
  sharedAt: string;
  sharedBy: { id: string; name: string } | null;
  resource: { id: string; title: string; type: string; category: string } | null;
}

interface Props {
  leadId: string;
  leadName: string;
  phone: string | null;
  email: string | null;
}

function TypeIcon({ r, className }: { r: ResItem; className?: string }) {
  if (r.type === "TEXT") return <FileText className={className} />;
  if (r.type === "URL") return <LinkIcon className={className} />;
  if (r.mimeType?.startsWith("image/")) return <ImageIcon className={className} />;
  return <FileIcon className={className} />;
}

/**
 * Lead-detail "Share Resource" affordance. Opens the resource library in a
 * picker, lets the agent select one or more, and share to THIS lead via
 * WhatsApp (wa.me to the lead's phone) or Email (mailto). Each share writes a
 * ResourceShare(leadId, channel, resourceId) so admin can track which file went
 * to which client. Shows the lead's share history beneath the button.
 */
export default function LeadResourceShare({ leadId, leadName, phone, email }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ResItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<ShareRow[]>([]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const loadHistory = useCallback(async () => {
    const r = await fetch(`/api/resources/shares?leadId=${leadId}`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); setHistory(j.items ?? []); }
  }, [leadId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const loadItems = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const r = await fetch(`/api/resources?${params.toString()}`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); setItems(j.items ?? []); setLoaded(true); }
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(loadItems, 200);
    return () => clearTimeout(t);
  }, [open, loadItems]);

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const chosen = items.filter((i) => selected.has(i.id));
  const message = chosen.map((r) => buildShareMessage(origin, r)).join("\n\n");

  async function record(channel: "WHATSAPP" | "EMAIL", recipient: string | null) {
    await Promise.all(chosen.map((r) =>
      fetch("/api/resources/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: r.id, leadId, channel, recipient }),
      }).catch(() => {})
    ));
    await loadHistory();
  }

  function shareWA() {
    if (chosen.length === 0) return;
    const url = phone ? whatsappLink(phone, message) : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    record("WHATSAPP", phone);
    close();
  }
  function shareEmail() {
    if (chosen.length === 0) return;
    const subject = encodeURIComponent(chosen.length === 1 ? chosen[0].title : `Resources from White Collar Realty`);
    window.location.href = `mailto:${email ?? ""}?subject=${subject}&body=${encodeURIComponent(message)}`;
    record("EMAIL", email);
    close();
  }
  function close() { setOpen(false); setSelected(new Set()); }

  function fmtWhen(iso: string) {
    try { return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#0b1a33] text-white text-xs font-semibold hover:opacity-90 transition min-h-10"
      >
        <FolderOpen className="w-4 h-4" /> Share Resource from Gallery
      </button>

      {/* Lead share history */}
      {history.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-[10px] uppercase font-bold tracking-widest text-gray-400">Shared with this client</div>
          {history.slice(0, 6).map((h) => (
            <div key={h.id} className="text-[11px] text-gray-600 dark:text-slate-400 flex items-center gap-1.5">
              <Send className="w-3 h-3 flex-none text-emerald-500" />
              <span className="font-medium truncate">{h.resource?.title ?? "Resource"}</span>
              <span className="text-gray-400">· {h.channel === "WHATSAPP" ? "WhatsApp" : h.channel === "EMAIL" ? "Email" : "CRM"} · {fmtWhen(h.sharedAt)}</span>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" {...backdropProps(close)}>
          <div className="bg-white dark:bg-slate-800 sm:rounded-xl rounded-t-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb] dark:border-slate-700">
              <div>
                <div className="font-semibold text-base dark:text-slate-100">Share with {leadName}</div>
                <div className="text-xs text-gray-500">Pick resources, then send via WhatsApp or Email</div>
              </div>
              <button onClick={close} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-3 border-b border-[#e5e7eb] dark:border-slate-700">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search resources…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />
              </div>
            </div>

            <div className="overflow-y-auto p-2 flex-1">
              {!loaded && <div className="text-sm text-gray-500 text-center py-6">Loading…</div>}
              {loaded && items.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-6">No resources. <a href="/gallery" className="underline">Open Gallery →</a></div>
              )}
              {items.map((r) => {
                const sel = selected.has(r.id);
                return (
                  <button key={r.id} onClick={() => toggle(r.id)} className={`w-full text-left p-2.5 rounded-lg border mb-1.5 flex items-center gap-2 transition ${sel ? "border-[#c9a24b] bg-amber-50 dark:bg-amber-900/20" : "border-[#e5e7eb] dark:border-slate-600"}`}>
                    <TypeIcon r={r} className="w-4 h-4 flex-none text-gray-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate dark:text-slate-100">{r.title}</div>
                      <div className="text-[11px] text-gray-500">{r.category}{r.projectName ? ` · ${r.projectName}` : ""}</div>
                    </div>
                    {sel && <CheckCircle2 className="w-4 h-4 text-[#c9a24b] flex-none" />}
                  </button>
                );
              })}
            </div>

            <div className="p-3 border-t border-[#e5e7eb] dark:border-slate-700 space-y-2">
              {chosen.length > 0 && <div className="text-[11px] text-gray-500">{chosen.length} selected</div>}
              {/* Central Action Design System — WhatsApp/Email resource share
                  (was ad-hoc #25D366 + indigo). Disabled states + titles kept. */}
              <div className="grid grid-cols-2 gap-2 [&>*]:w-full">
                <ActionButton action="whatsapp" size="sm" onClick={shareWA} disabled={chosen.length === 0 || !phone} title={!phone ? "No phone on this lead" : undefined} />
                <ActionButton action="email" size="sm" onClick={shareEmail} disabled={chosen.length === 0 || !email} title={!email ? "No email on this lead" : undefined} />
              </div>
              <p className="text-[10px] text-gray-400 text-center">A link is sent (WhatsApp can’t attach files). Each share is tracked on this lead.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
