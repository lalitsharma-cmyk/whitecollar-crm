"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Trash2, Pencil, Plus } from "lucide-react";

type Kind = "WHATSAPP" | "EMAIL";
type Trigger = "FIRST_QUERY" | "AFTER_CALL" | "AFTER_NOT_PICKED" | "SCHEDULE_VISIT" | "POST_VISIT" | "NEGOTIATION" | "REENGAGE_COLD" | "GENERIC";

interface Template {
  id: string; kind: Kind; trigger: Trigger; name: string; subject: string | null; body: string;
}

interface Props {
  mode: "new" | "edit";
  template?: Template;
}

const TRIGGERS: { v: Trigger; label: string }[] = [
  { v: "FIRST_QUERY",      label: "🆕 First query" },
  { v: "AFTER_CALL",       label: "📞 After a call" },
  { v: "AFTER_NOT_PICKED", label: "📵 After not picked" },
  { v: "SCHEDULE_VISIT",   label: "📅 Schedule visit" },
  { v: "POST_VISIT",       label: "🚗 After site visit" },
  { v: "NEGOTIATION",      label: "🤝 Negotiating" },
  { v: "REENGAGE_COLD",    label: "🧊 Re-engage cold" },
  { v: "GENERIC",          label: "🔧 Generic" },
];

export default function TemplateEditor({ mode, template }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    kind: template?.kind ?? "WHATSAPP" as Kind,
    trigger: template?.trigger ?? "GENERIC" as Trigger,
    name: template?.name ?? "",
    subject: template?.subject ?? "",
    body: template?.body ?? "",
  });

  async function save() {
    if (busy) return;
    if (!form.name.trim() || !form.body.trim()) { setErr("Name and body are required"); return; }
    setBusy(true); setErr(null);
    try {
      const url = mode === "edit" ? `/api/admin/templates/${template!.id}` : "/api/admin/templates";
      const method = mode === "edit" ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          subject: form.kind === "EMAIL" ? form.subject : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed"); return; }
      setOpen(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Delete template "${template?.name}"?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/templates/${template!.id}`, { method: "DELETE" });
      if (r.ok) { setOpen(false); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <>
      {mode === "new" ? (
        <button onClick={() => setOpen(true)} className="btn btn-primary text-xs justify-center self-start"><Plus className="w-3 h-3" /> New template</button>
      ) : (
        <button onClick={() => setOpen(true)} className="btn btn-ghost text-[11px]"><Pencil className="w-3 h-3" /> Edit</button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-xl max-w-lg w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg">{mode === "new" ? "New template" : "Edit template"}</div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-gray-600">Type</label>
                  <select value={form.kind} onChange={(e) => setForm(f => ({ ...f, kind: e.target.value as Kind }))} className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
                    <option value="WHATSAPP">💬 WhatsApp</option>
                    <option value="EMAIL">✉ Email</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Trigger</label>
                  <select value={form.trigger} onChange={(e) => setForm(f => ({ ...f, trigger: e.target.value as Trigger }))} className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
                    {TRIGGERS.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Name (internal)</label>
                <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Site-visit invite (WA)" className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm" />
              </div>
              {form.kind === "EMAIL" && (
                <div>
                  <label className="text-xs font-semibold text-gray-600">Email subject</label>
                  <input value={form.subject} onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="e.g. {{project}} — details we discussed" className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm" />
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-gray-600">Body (placeholders: {`{{name}} {{agent}} {{project}} {{budget}}`})</label>
                <textarea value={form.body} onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))} rows={8} placeholder="Hi {{name}}, this is {{agent}} from White Collar Realty…" className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm font-mono text-[13px]" />
              </div>
              {err && <div className="text-xs text-red-700">{err}</div>}
            </div>
            <div className="flex gap-2 mt-4 justify-between">
              {mode === "edit" ? (
                <button onClick={remove} disabled={busy} className="btn btn-ghost text-xs text-red-700"><Trash2 className="w-3 h-3" /> Delete</button>
              ) : <div />}
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} disabled={busy} className="btn btn-ghost text-sm">Cancel</button>
                <button onClick={save} disabled={busy} className="btn btn-primary text-sm">{busy ? "Saving…" : "Save"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
