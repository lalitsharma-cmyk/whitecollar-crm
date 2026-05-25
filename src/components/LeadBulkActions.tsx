"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Mail } from "lucide-react";

interface Agent { id: string; name: string; team: string | null; }
interface EmailTpl { id: string; name: string; subject: string | null; }

export default function LeadBulkActions({ selectedIds, agents, onClear }: { selectedIds: string[]; agents: Agent[]; onClear: () => void; }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [emailTpls, setEmailTpls] = useState<EmailTpl[]>([]);
  const [emailTplId, setEmailTplId] = useState("");
  const [emailMsg, setEmailMsg] = useState<string | null>(null);

  // Lazy-load email templates when user opens the modal
  useEffect(() => {
    if (!showEmail || emailTpls.length > 0) return;
    (async () => {
      const r = await fetch("/api/admin/templates");
      if (r.ok) {
        const j = await r.json();
        const items = (j.items ?? []).filter((t: { kind: string }) => t.kind === "EMAIL");
        setEmailTpls(items);
        if (items[0]) setEmailTplId(items[0].id);
      }
    })();
  }, [showEmail, emailTpls.length]);

  // ESC to clear selection
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClear(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClear]);

  if (selectedIds.length === 0) return null;

  async function bulkReassign() {
    if (!picked) return;
    setBusy(true);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reassign", ids: selectedIds, userId: picked }),
      });
      if (r.ok) { onClear(); router.refresh(); }
    } finally { setBusy(false); }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"} permanently? This can't be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids: selectedIds }),
      });
      if (r.ok) { onClear(); router.refresh(); }
    } finally { setBusy(false); }
  }

  async function sendBulkEmail() {
    if (!emailTplId || busy) return;
    setBusy(true); setEmailMsg(null);
    try {
      const r = await fetch("/api/leads/bulk-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, templateId: emailTplId }),
      });
      const j = await r.json();
      if (!r.ok) { setEmailMsg(j.error ?? "Failed"); return; }
      setEmailMsg(`✓ Sent ${j.sent} email${j.sent === 1 ? "" : "s"}${j.skipped ? ` · ${j.skipped} skipped (no email address)` : ""}${j.errors?.length ? ` · ${j.errors.length} errors` : ""}`);
      if (j.sent > 0) {
        setTimeout(() => { setShowEmail(false); onClear(); router.refresh(); }, 2500);
      }
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-[#0b1a33] text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 flex-wrap max-w-[95vw]">
        <div className="text-sm font-semibold">{selectedIds.length} selected</div>
        <div className="w-px h-6 bg-white/20" />
        <select value={picked} onChange={(e) => setPicked(e.target.value)} className="bg-white/10 text-white border-0 rounded-lg px-2 py-1 text-xs">
          <option value="">Reassign to…</option>
          {agents.map(a => <option key={a.id} value={a.id} className="text-black">{a.name} ({a.team ?? "—"})</option>)}
        </select>
        <button onClick={bulkReassign} disabled={busy || !picked} className="text-xs font-semibold bg-[#c9a24b] text-[#0b1a33] px-3 py-1 rounded-lg">Reassign</button>
        <button onClick={() => setShowEmail(true)} disabled={busy} className="text-xs font-semibold bg-sky-600 text-white px-3 py-1 rounded-lg flex items-center gap-1"><Mail className="w-3 h-3" /> Email</button>
        <button onClick={bulkDelete} disabled={busy} className="text-xs font-semibold bg-red-600 text-white px-3 py-1 rounded-lg">Delete</button>
        <button onClick={onClear} className="text-xs text-white/70 hover:text-white">Clear</button>
      </div>

      {showEmail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setShowEmail(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg">📧 Send email to {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}</div>
              <button onClick={() => setShowEmail(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <label className="text-xs font-semibold text-gray-600">Template</label>
            <select value={emailTplId} onChange={(e) => setEmailTplId(e.target.value)} className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
              {emailTpls.length === 0 && <option value="">(no email templates — create one in /admin/templates)</option>}
              {emailTpls.map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.subject ? ` — ${t.subject}` : ""}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mb-3">
              Placeholders like <code>{`{{name}}`}</code> are filled per-recipient. Leads without an email are skipped.
              Sends via Resend (rate-limited to avoid spam flags).
            </p>
            {emailMsg && <div className={`text-xs mb-3 ${emailMsg.startsWith("✓") ? "text-emerald-700" : "text-red-700"}`}>{emailMsg}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowEmail(false)} disabled={busy} className="btn btn-ghost text-sm">Cancel</button>
              <button onClick={sendBulkEmail} disabled={busy || !emailTplId} className="btn btn-primary text-sm">{busy ? "Sending…" : `Send ${selectedIds.length}`}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
