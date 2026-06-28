"use client";
import { useEffect, useMemo, useState } from "react";
import { MessageSquare, X, PenLine, FileText, Sparkles } from "lucide-react";

// ─── Candidate context for variable substitution ─────────────────────────────
// Built from HRCandidate fields. The detail page passes a flat object; missing
// fields render as empty strings (never throw).
export interface HRTemplateContext {
  name: string;
  firstName: string;
  phone: string | null;
  whatsappPhone: string | null;
  email: string | null;
  position: string | null;
  company: string | null;
  city: string | null;
  location: string | null;
  recruiter: string;
  recruiterFirst: string;
}

// A template row, normalised from whatever the server returns. Body is required;
// name is best-effort. We store an optional rendered body once substituted.
interface Tpl { id: string; name: string; body: string; subject?: string | null }

// Defensive normaliser: the backend may expose GET /api/hr/templates returning
// [{id,name,body}] OR { items:[…] }, OR the Sales admin list returning
// { items:[{id,name,body,kind,active,…}] }. Read either shape, keep WHATSAPP
// (or kind-less) rows, and coerce to {id,name,body}.
function normalizeTemplates(json: unknown): Tpl[] {
  const arr: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { items?: unknown[] })?.items)
    ? (json as { items: unknown[] }).items
    : Array.isArray((json as { templates?: unknown[] })?.templates)
    ? (json as { templates: unknown[] }).templates
    : [];
  const out: Tpl[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const body = typeof r.body === "string" ? r.body : typeof r.text === "string" ? r.text : "";
    if (!body.trim()) continue;
    // If a kind exists, only keep WhatsApp templates; kind-less rows are kept.
    const kind = typeof r.kind === "string" ? r.kind.toUpperCase() : null;
    if (kind && kind !== "WHATSAPP") continue;
    // Respect an explicit active=false flag if present.
    if (r.active === false) continue;
    const id = typeof r.id === "string" ? r.id : String(r.id ?? out.length);
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Template";
    const subject = typeof r.subject === "string" ? r.subject : null;
    out.push({ id, name, body, subject });
  }
  return out;
}

// {{key}} substitution — case-insensitive, whitespace-tolerant; also supports the
// legacy {key} style used by the built-in templates. Missing → empty string.
export function renderHRTemplate(body: string, ctx: HRTemplateContext): string {
  const map: Record<string, string> = {
    name: ctx.firstName || ctx.name || "",
    fullname: ctx.name || "",
    firstname: ctx.firstName || "",
    position: ctx.position || "",
    positionapplied: ctx.position || "",
    role: ctx.position || "",
    company: ctx.company || "",
    city: ctx.city || "",
    location: ctx.location || ctx.city || "",
    phone: ctx.phone || "",
    email: ctx.email || "",
    agent: ctx.recruiterFirst || "",
    agent_full: ctx.recruiter || "",
    recruiter: ctx.recruiterFirst || "",
  };
  const sub = (key: string) => map[key.toLowerCase().trim()] ?? "";
  return body
    .replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, k) => sub(k))
    .replace(/\{\s*([\w]+)\s*\}/g, (_m, k) => sub(k));
}

// Built-in quick templates — used as a fallback when the server returns none,
// and always shown so the agent has instant choices even offline.
const BUILTIN: Tpl[] = [
  { id: "builtin-intro", name: "Intro", body: "Hi {{name}}, this is {{recruiter}} from White Collar Realty regarding a job opportunity. Is now a good time to talk?" },
  { id: "builtin-interview", name: "Interview", body: "Hi {{name}}, confirming your interview with White Collar Realty. Please reply to confirm your availability." },
  { id: "builtin-followup", name: "Follow-up", body: "Hi {{name}}, following up on your application with White Collar Realty — are you still interested in the role?" },
  { id: "builtin-offer", name: "Offer", body: "Hi {{name}}, great news — we'd like to discuss an offer with you. When can we connect?" },
  { id: "builtin-docs", name: "Docs", body: "Hi {{name}}, please share your latest resume and a convenient time for a quick call." },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Candidate context for placeholder substitution. */
  ctx: HRTemplateContext;
  /** Digits-only / E.164-ish WhatsApp number; if empty, no wa.me link opens. */
  waPhone: string;
  /** Called with the final rendered text once the agent picks/types — the parent
   *  opens wa.me and logs the WhatsApp activity (keeps existing log working). */
  onSend: (renderedText: string, templateId: string | undefined) => void;
}

/**
 * HR WhatsApp quick-send template picker. Fetches templates defensively (HR
 * endpoint first, Sales admin list as fallback), substitutes candidate
 * variables client-side ({{name}}, {{position}}, …), and hands the rendered
 * text back to the parent which opens wa.me + logs the activity. Also offers a
 * free-type mode and a set of built-in quick templates that always work.
 */
export default function HRWhatsAppTemplatePicker({ open, onClose, ctx, waPhone, onSend }: Props) {
  const [server, setServer] = useState<Tpl[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState(false);
  const [freeText, setFreeText] = useState("");

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      // Try the HR-specific list first; fall back to the Sales admin list. Either
      // may 403/404 for an AGENT — that's fine, we still have built-ins.
      let tpls: Tpl[] = [];
      for (const path of ["/api/hr/templates?kind=WHATSAPP", "/api/hr/templates", "/api/admin/templates"]) {
        try {
          const res = await fetch(path, { cache: "no-store" });
          if (!res.ok) continue;
          const json = await res.json().catch(() => null);
          const norm = normalizeTemplates(json);
          if (norm.length) { tpls = norm; break; }
        } catch { /* network — ignore, keep trying / fall back */ }
      }
      if (!cancelled) { setServer(tpls); setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [open, loaded]);

  // Built-ins first (instant, familiar), then any server templates not duplicating a built-in name.
  const all = useMemo<Tpl[]>(() => {
    const seen = new Set(BUILTIN.map(b => b.name.toLowerCase()));
    return [...BUILTIN, ...server.filter(t => !seen.has(t.name.toLowerCase()))];
  }, [server]);

  if (!open) return null;

  function pick(t: Tpl) {
    const rendered = renderHRTemplate(t.body, ctx);
    onSend(rendered, t.id.startsWith("builtin-") ? undefined : t.id);
    reset();
  }
  function sendFree() {
    const body = freeText.trim();
    if (!body) return;
    onSend(body, undefined);
    reset();
  }
  function reset() { setTyping(false); setFreeText(""); onClose(); }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={reset}>
      <div className="bg-white dark:bg-slate-900 sm:rounded-xl rounded-t-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb] dark:border-slate-700">
          <div>
            <div className="font-semibold text-lg text-gray-900 dark:text-white inline-flex items-center gap-2"><MessageSquare size={18} className="text-green-600" />Quick-send WhatsApp</div>
            <div className="text-xs text-gray-500 dark:text-slate-400">Placeholders filled with {ctx.firstName || ctx.name || "candidate"}&apos;s details</div>
          </div>
          <button type="button" onClick={reset} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200"><X size={20} /></button>
        </div>

        {!waPhone && (
          <div className="mx-3 mt-3 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
            No WhatsApp/phone number on file — the message will be prepared but no chat will open.
          </div>
        )}

        <div className="overflow-y-auto p-3 space-y-2">
          {typing ? (
            <div className="border-2 border-emerald-400 rounded-lg p-3 bg-emerald-50 dark:bg-emerald-950/30 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-sm flex items-center gap-2 text-gray-900 dark:text-slate-100"><PenLine size={16} />Type your message</div>
                <button type="button" onClick={() => setTyping(false)} className="text-xs text-gray-500 dark:text-slate-400 underline">← back to templates</button>
              </div>
              <textarea
                value={freeText}
                onChange={e => setFreeText(e.target.value)}
                placeholder={`Hi ${ctx.firstName || ctx.name || ""}, …`}
                rows={6}
                autoFocus
                className="w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100 font-mono text-[13px]"
              />
              <button type="button" onClick={sendFree} disabled={!freeText.trim()} className="btn w-full justify-center text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-40">
                <MessageSquare size={15} className="mr-1.5" />Send WhatsApp
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setTyping(true)} className="w-full text-left p-3 border-2 border-dashed border-emerald-300 dark:border-emerald-800 rounded-lg hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition flex items-center gap-2">
              <PenLine size={16} className="text-emerald-700 dark:text-emerald-400" />
              <div className="flex-1">
                <div className="font-semibold text-sm text-emerald-800 dark:text-emerald-300">Type your own message</div>
                <div className="text-xs text-emerald-700 dark:text-emerald-400">Skip templates — write a one-off message right here.</div>
              </div>
            </button>
          )}

          {!typing && (
            <>
              <div className="text-[10px] uppercase font-bold tracking-widest text-gray-500 dark:text-slate-400 pt-2 pb-1">Or pick a template</div>
              {!loaded && <div className="text-sm text-gray-500 dark:text-slate-400 text-center py-2">Loading templates…</div>}
              {all.map(t => {
                const preview = renderHRTemplate(t.body, ctx);
                const isBuiltin = t.id.startsWith("builtin-");
                return (
                  <button key={t.id} type="button" onClick={() => pick(t)} className="w-full text-left p-3 border border-[#e5e7eb] dark:border-slate-700 rounded-lg hover:border-[#c9a24b] dark:hover:border-amber-600 transition">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm text-gray-900 dark:text-slate-100 inline-flex items-center gap-1.5">
                        {isBuiltin ? <Sparkles size={12} className="text-amber-500" /> : <FileText size={12} className="text-gray-400" />}{t.name}
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-slate-300 mt-1 line-clamp-3 whitespace-pre-wrap">{preview}</div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
