"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Search, Upload, Link as LinkIcon, FileText, Image as ImageIcon, File as FileIcon,
  Copy, Trash2, Pencil, X, Check, Plus, Filter, CheckCircle2,
} from "lucide-react";
import { whatsappLink } from "@/lib/phone";
import { backdropProps } from "@/lib/useDismiss";
import { ActionButton } from "@/components/actions/ActionButton";
import WhatsAppGlyph from "@/components/actions/WhatsAppGlyph";
import {
  RESOURCE_CATEGORIES, formatFileSize, buildShareMessage, shareableLink, publicFileUrl,
  type ResourceTypeStr,
} from "@/lib/resources";

export interface ResourceItem {
  id: string;
  title: string;
  category: string;
  type: ResourceTypeStr;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  fileUrl: string | null;
  textContent: string | null;
  projectName: string | null;
  tags: string | null;
  uploadedById?: string | null;
  uploadedBy: { id: string; name: string } | null;
  createdAt: string;
  _count?: { shares: number };
}

interface Props {
  /** ADMIN/MANAGER → may edit/delete ANY resource. */
  canManageAll: boolean;
  /** The signed-in user's id — used to allow editing/deleting OWN uploads. */
  myUserId: string;
  initialItems: ResourceItem[];
}

const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "FILE", label: "Files" },
  { key: "URL", label: "Links" },
  { key: "TEXT", label: "Templates" },
];

function TypeIcon({ r, className }: { r: ResourceItem; className?: string }) {
  if (r.type === "TEXT") return <FileText className={className} />;
  if (r.type === "URL") return <LinkIcon className={className} />;
  if (r.mimeType?.startsWith("image/")) return <ImageIcon className={className} />;
  if (r.mimeType === "application/pdf") return <FileIcon className={className} />;
  return <FileIcon className={className} />;
}

export default function GalleryClient({ canManageAll, myUserId, initialItems }: Props) {
  const [items, setItems] = useState<ResourceItem[]>(initialItems);

  // Per-resource manage right: admins/managers manage everything; everyone else
  // manages only their OWN uploads. (uploadedById may arrive directly or via the
  // uploadedBy relation, depending on the payload source.)
  const canManageItem = useCallback(
    (r: ResourceItem) => canManageAll || (r.uploadedById ?? r.uploadedBy?.id ?? null) === myUserId,
    [canManageAll, myUserId],
  );
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [shareTarget, setShareTarget] = useState<ResourceItem[] | null>(null);
  const [editing, setEditing] = useState<ResourceItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); }, []);

  const reload = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (typeFilter) params.set("type", typeFilter);
    const r = await fetch(`/api/resources?${params.toString()}`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); setItems(j.items ?? []); }
  }, [q, category, typeFilter]);

  // Debounced reload on filter/search change.
  useEffect(() => {
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
  }, [reload]);

  const categories = useMemo(() => {
    const set = new Set<string>(RESOURCE_CATEGORIES as readonly string[]);
    items.forEach((i) => set.add(i.category));
    return Array.from(set);
  }, [items]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const selectedItems = items.filter((i) => selected.has(i.id));

  async function copyLink(r: ResourceItem) {
    const link = shareableLink(origin, r) ?? (r.type === "TEXT" ? r.textContent ?? "" : "");
    try {
      await navigator.clipboard.writeText(link);
      flash(r.type === "TEXT" ? "Template text copied" : "Link copied");
      // Copy-link counts as an ad-hoc share (no lead).
      recordShare([r], "ATTACH", null);
    } catch { flash("Could not copy"); }
  }

  async function recordShare(rs: ResourceItem[], channel: "WHATSAPP" | "EMAIL" | "ATTACH", recipient: string | null) {
    await Promise.all(rs.map((r) =>
      fetch("/api/resources/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: r.id, channel, recipient }),
      }).catch(() => {})
    ));
  }

  async function softDelete(r: ResourceItem) {
    if (!confirm(`Delete "${r.title}"? It moves to the recycle bin (reversible).`)) return;
    const res = await fetch(`/api/resources/${r.id}`, { method: "DELETE" });
    if (res.ok) { setItems((p) => p.filter((x) => x.id !== r.id)); flash("Deleted"); }
    else flash("Delete failed");
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, tags, project…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm outline-none focus:border-[#c9a24b]"
          />
        </div>
        {/* Upload is open to every active user (incl. agents) — direct upload. */}
        <button onClick={() => setShowUpload(true)} className="btn btn-gold justify-center whitespace-nowrap">
          <Plus className="w-4 h-4" /> Add Resource
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-gray-400" />
        {TYPE_FILTERS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTypeFilter(t.key)}
            className={`text-xs px-3 py-1 rounded-full font-semibold transition ${typeFilter === t.key ? "bg-[#0b1a33] text-white" : "bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300"}`}
          >{t.label}</button>
        ))}
        <span className="w-px h-5 bg-gray-200 dark:bg-slate-600 mx-1" />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="text-xs px-2 py-1 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700"
        >
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Multi-select action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">{selected.size} selected</span>
          <button onClick={() => setShareTarget(selectedItems)} className="btn btn-primary text-xs py-1">Share selected</button>
          <button onClick={() => setSelected(new Set())} className="text-xs underline text-gray-600 dark:text-slate-300">Clear</button>
        </div>
      )}

      {/* Grid */}
      {items.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No resources yet. Click “Add Resource” to upload.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((r) => {
            const isSel = selected.has(r.id);
            const isImage = r.type === "FILE" && r.mimeType?.startsWith("image/");
            return (
              <div
                key={r.id}
                className={`card overflow-hidden flex flex-col dark:bg-slate-800 dark:border-slate-700 transition ${isSel ? "ring-2 ring-[#c9a24b]" : ""}`}
              >
                {/* Thumb / preview */}
                <button
                  onClick={() => toggleSelect(r.id)}
                  className="relative h-28 bg-gray-50 dark:bg-slate-900 flex items-center justify-center text-gray-400 overflow-hidden"
                  title="Click to select"
                >
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={publicFileUrl(origin, r.id)} alt={r.title} className="w-full h-full object-cover" />
                  ) : r.type === "TEXT" ? (
                    <div className="text-[10px] text-gray-500 dark:text-slate-400 p-2 line-clamp-5 text-left w-full">{r.textContent}</div>
                  ) : (
                    <TypeIcon r={r} className="w-10 h-10 opacity-60" />
                  )}
                  {isSel && (
                    <span className="absolute top-1 right-1 bg-[#c9a24b] text-[#0b1a33] rounded-full p-0.5">
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                  )}
                </button>

                {/* Body */}
                <div className="p-2.5 flex-1 flex flex-col gap-1.5">
                  <div className="flex items-start gap-1.5">
                    <TypeIcon r={r} className="w-3.5 h-3.5 mt-0.5 flex-none text-gray-400" />
                    <div className="text-xs font-semibold leading-tight line-clamp-2 dark:text-slate-100">{r.title}</div>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="chip chip-new text-[10px]">{r.category}</span>
                    {r.fileSize ? <span className="text-[10px] text-gray-400">{formatFileSize(r.fileSize)}</span> : null}
                  </div>
                  {r.projectName && <div className="text-[10px] text-gray-500 dark:text-slate-400 truncate">📍 {r.projectName}</div>}

                  {/* Actions */}
                  <div className="mt-auto pt-1.5 flex items-center gap-1">
                    <button onClick={() => setShareTarget([r])} title="Share via WhatsApp" className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-[#25D366] text-white text-[10px] font-semibold hover:opacity-90">
                      <WhatsAppGlyph className="w-3 h-3" /> Share
                    </button>
                    <button onClick={() => copyLink(r)} title="Copy link / text" className="p-1.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200">
                      <Copy className="w-3 h-3" />
                    </button>
                    {canManageItem(r) && (
                      <>
                        <button onClick={() => setEditing(r)} title="Edit" className="p-1.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => softDelete(r)} title="Delete" className="p-1.5 rounded bg-red-50 dark:bg-red-900/30 text-red-600 hover:bg-red-100">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onCreated={() => { setShowUpload(false); reload(); flash("Resource added"); }} />}
      {editing && <EditModal resource={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); flash("Saved"); }} />}
      {shareTarget && (
        <ShareModal
          resources={shareTarget}
          origin={origin}
          onClose={() => setShareTarget(null)}
          onShared={(channel) => { setShareTarget(null); setSelected(new Set()); flash(`Shared via ${channel === "WHATSAPP" ? "WhatsApp" : "Email"}`); }}
          recordShare={recordShare}
        />
      )}

      {toast && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-[#0b1a33] text-white text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" /> {toast}
        </div>
      )}
    </div>
  );
}

// ── Share modal (single or multi) — pick WhatsApp or Email ────────────────────
function ShareModal({
  resources, origin, onClose, onShared, recordShare,
}: {
  resources: ResourceItem[];
  origin: string;
  onClose: () => void;
  onShared: (channel: "WHATSAPP" | "EMAIL") => void;
  recordShare: (rs: ResourceItem[], channel: "WHATSAPP" | "EMAIL" | "ATTACH", recipient: string | null) => Promise<void>;
}) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const combinedMessage = resources.map((r) => buildShareMessage(origin, r)).join("\n\n");

  function shareWhatsApp() {
    const link = whatsappLink(phone || undefined, combinedMessage);
    // wa.me works with or without a number (?text only opens the picker).
    const url = phone ? link : `https://wa.me/?text=${encodeURIComponent(combinedMessage)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    recordShare(resources, "WHATSAPP", phone || null);
    onShared("WHATSAPP");
  }
  function shareEmail() {
    const subject = encodeURIComponent(resources.length === 1 ? resources[0].title : `${resources.length} resources from White Collar Realty`);
    const body = encodeURIComponent(combinedMessage);
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
    recordShare(resources, "EMAIL", email || null);
    onShared("EMAIL");
  }

  return (
    <Modal onClose={onClose} title={`Share ${resources.length > 1 ? `${resources.length} resources` : "resource"}`}>
      <div className="space-y-3">
        <div className="text-xs text-gray-500 dark:text-slate-400 border border-[#e5e7eb] dark:border-slate-600 rounded-lg p-2 max-h-28 overflow-y-auto whitespace-pre-wrap">{combinedMessage}</div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">WhatsApp number (optional)</label>
          <div className="flex gap-2 mt-1">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+9715… or +9198…" className="flex-1 px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />
            {/* Central Action Design System — WhatsApp/Email send (was ad-hoc #25D366 + indigo). */}
            <ActionButton action="whatsapp" size="sm" onClick={shareWhatsApp} className="whitespace-nowrap" />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Email (optional)</label>
          <div className="flex gap-2 mt-1">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@email.com" className="flex-1 px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />
            <ActionButton action="email" size="sm" onClick={shareEmail} className="whitespace-nowrap" />
          </div>
        </div>
        <p className="text-[11px] text-gray-400">A link is sent (WhatsApp can’t attach files). Every share is tracked.</p>
      </div>
    </Modal>
  );
}

// ── Upload / create modal ─────────────────────────────────────────────────────
function UploadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [mode, setMode] = useState<"FILE" | "URL" | "TEXT">("FILE");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Brochure");
  const [projectName, setProjectName] = useState("");
  const [tags, setTags] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    setErr(""); setBusy(true);
    try {
      let res: Response;
      if (mode === "FILE") {
        const file = fileRef.current?.files?.[0];
        if (!file) { setErr("Choose a file"); setBusy(false); return; }
        const fd = new FormData();
        fd.set("file", file);
        fd.set("title", title || file.name);
        fd.set("category", category);
        fd.set("projectName", projectName);
        fd.set("tags", tags);
        res = await fetch("/api/resources", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/resources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: mode, title, category, projectName, tags, fileUrl, textContent }),
        });
      }
      if (res.ok) { onCreated(); }
      else { const j = await res.json().catch(() => ({})); setErr(j.error || "Upload failed"); }
    } catch { setErr("Upload failed"); }
    setBusy(false);
  }

  return (
    <Modal onClose={onClose} title="Add resource">
      <div className="space-y-3">
        <div className="flex gap-2">
          {(["FILE", "URL", "TEXT"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 ${mode === m ? "bg-[#0b1a33] text-white" : "bg-gray-100 dark:bg-slate-700 dark:text-slate-300"}`}>
              {m === "FILE" ? <Upload className="w-3.5 h-3.5" /> : m === "URL" ? <LinkIcon className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
              {m === "FILE" ? "Upload" : m === "URL" ? "Link" : "Template"}
            </button>
          ))}
        </div>

        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />

        <div className="grid grid-cols-2 gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm">
            {RESOURCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project (optional)" className="px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />
        </div>

        {mode === "FILE" && (
          <div>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="w-full text-sm" />
            <p className="text-[11px] text-gray-400 mt-1">Images or PDF, max 5 MB.</p>
          </div>
        )}
        {mode === "URL" && (
          <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://… (link to externally-hosted file)" className="w-full px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />
        )}
        {mode === "TEXT" && (
          <textarea value={textContent} onChange={(e) => setTextContent(e.target.value)} rows={5} placeholder="Template text the agent can send…" className="w-full px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />
        )}

        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (comma-separated, for search)" className="w-full px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />

        {err && <div className="text-xs text-red-600">{err}</div>}
        <button onClick={submit} disabled={busy} className="btn btn-gold w-full justify-center">{busy ? "Saving…" : "Save resource"}</button>
      </div>
    </Modal>
  );
}

// ── Edit modal (metadata + type-specific payload) ─────────────────────────────
function EditModal({ resource, onClose, onSaved }: { resource: ResourceItem; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(resource.title);
  const [category, setCategory] = useState(resource.category);
  const [projectName, setProjectName] = useState(resource.projectName ?? "");
  const [tags, setTags] = useState(resource.tags ?? "");
  const [fileUrl, setFileUrl] = useState(resource.fileUrl ?? "");
  const [textContent, setTextContent] = useState(resource.textContent ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    const res = await fetch(`/api/resources/${resource.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category, projectName, tags, fileUrl, textContent }),
    });
    if (res.ok) onSaved();
    else { const j = await res.json().catch(() => ({})); setErr(j.error || "Save failed"); }
    setBusy(false);
  }

  return (
    <Modal onClose={onClose} title="Edit resource">
      <div className="space-y-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm">
            {RESOURCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project" className="px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />
        </div>
        {resource.type === "URL" && <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />}
        {resource.type === "TEXT" && <textarea value={textContent} onChange={(e) => setTextContent(e.target.value)} rows={5} className="w-full px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />}
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags" className="w-full px-3 py-2 rounded-lg border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 text-sm" />
        {err && <div className="text-xs text-red-600">{err}</div>}
        <button onClick={save} disabled={busy} className="btn btn-gold w-full justify-center">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

// ── Shared modal shell (bottom-sheet on mobile, dialog on desktop) ─────────────
function Modal({ children, title, onClose }: { children: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" {...backdropProps(onClose)}>
      <div className="bg-white dark:bg-slate-800 sm:rounded-xl rounded-t-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb] dark:border-slate-700">
          <div className="font-semibold text-lg dark:text-slate-100">{title}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
