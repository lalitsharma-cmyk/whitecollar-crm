"use client";
import { useEffect, useState } from "react";
import { Mail, X, Sparkles, PenLine, FolderOpen } from "lucide-react";
import { whatsappLink } from "@/lib/phone";
import { ACTION_TOKENS } from "@/lib/actionDesign";
import WhatsAppGlyph from "@/components/actions/WhatsAppGlyph";
import { buildShareMessage, type ResourceTypeStr } from "@/lib/resources";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import FollowupNextPopup from "./FollowupNextPopup";

interface Lead { id: string; name: string; phone: string | null; email: string | null; }
interface Tpl {
  id: string; kind: "WHATSAPP" | "EMAIL"; trigger: string; name: string;
  subject: string | null; body: string;
  /** Rendered preview from the server, with placeholders substituted for THIS lead. */
  rendered: { body: string; subject: string | null };
}
interface GalleryRes {
  id: string; title: string; category: string; type: ResourceTypeStr;
  fileUrl: string | null; textContent: string | null;
}

interface Props {
  lead: Lead;
  kind: "WHATSAPP" | "EMAIL";
  /** Pre-suggested trigger (e.g. "POST_VISIT" if lead just had a visit). Optional. */
  suggestedTrigger?: string;
  /** When true, render a horizontal compact button matching the new
   *  lead-detail action bar (smaller padding, inline icon+label, mobile-first). */
  compact?: boolean;
}

/**
 * Replaces the bare WhatsApp / Email buttons on lead detail. Tap → opens a
 * picker showing all templates of the given kind, with the suggested one(s)
 * pinned at the top. Selecting one opens wa.me / mailto with the rendered
 * message body. Logs the click as an Activity via /api/whatsapp/log (for WA).
 */
export default function TemplatePickerButton({ lead, kind, suggestedTrigger, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [loaded, setLoaded] = useState(false);
  useBodyScrollLock(open);
  // "Type your own" free-text mode. Lalit asked: "There should be both option
  // to Type or choose template, if agent choose template then show him options
  // of templates." The picker now opens with two big choices at the top —
  // "✍ Type your own" or pick from the saved templates below.
  const [typing, setTyping] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [freeSubject, setFreeSubject] = useState("");
  // Gallery / Resource Library — shareable files + URL links + text templates,
  // surfaced so the agent can insert a resource into the message they compose.
  const [resources, setResources] = useState<GalleryRes[]>([]);
  // Follow-up date is intentionally NOT collected when sending a WhatsApp message
  // (Lalit's rule: an agent must NEVER set/edit the follow-up while logging a
  // call or WhatsApp — the follow-up changes ONLY via Complete / Snooze /
  // Escalate / Reschedule / Admin). After a send, the "What next?" popup opens so
  // the agent closes the follow-up through those shared actions.
  // Post-send "What next?" prompt — opens after a WhatsApp send so the agent closes
  // the follow-up (Complete / Snooze / Escalate). WhatsApp only (email isn't logged).
  const [showNextPrompt, setShowNextPrompt] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    (async () => {
      const [tr, rr] = await Promise.all([
        fetch(`/api/templates/render?leadId=${lead.id}&kind=${kind}`),
        fetch(`/api/resources`, { cache: "no-store" }),
      ]);
      if (tr.ok) { const j = await tr.json(); setTpls(j.items ?? []); }
      if (rr.ok) { const j = await rr.json(); setResources(j.items ?? []); }
      setLoaded(true);
    })();
  }, [open, loaded, lead.id, kind]);

  // Insert a gallery resource: its share message becomes the body, and we record
  // a ResourceShare(leadId) so admin tracks which file went to which client.
  function pickResource(r: GalleryRes) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const body = buildShareMessage(origin, r);
    fetch("/api/resources/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId: r.id, leadId: lead.id, channel: kind === "WHATSAPP" ? "WHATSAPP" : "EMAIL" }),
    }).catch(() => {});
    sendMessage(body, r.title, undefined);
  }

  function pick(t: Tpl) {
    sendMessage(t.rendered.body, t.rendered.subject ?? "", t.id);
  }

  function sendFreeText() {
    const body = freeText.trim();
    if (!body) return;
    sendMessage(body, freeSubject.trim(), undefined);
  }

  function sendMessage(body: string, subject: string, templateId: string | undefined) {
    if (kind === "WHATSAPP" && lead.phone) {
      const url = whatsappLink(lead.phone, body);
      window.open(url, "_blank", "noopener,noreferrer");
      // Log the send as a touch — but NOT a follow-up (the follow-up is set only
      // via Complete / Snooze / Escalate, surfaced by the popup below).
      fetch("/api/whatsapp/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, kind: "send", message: body, templateId }),
      }).catch(() => {});
      // A WhatsApp send is a logged contact attempt — open the "What next?" prompt
      // so the agent closes the follow-up (Complete / Snooze / Escalate).
      setShowNextPrompt(true);
    } else if (kind === "EMAIL" && lead.email) {
      const s = encodeURIComponent(subject);
      const b = encodeURIComponent(body);
      window.location.href = `mailto:${lead.email}?subject=${s}&body=${b}`;
    }
    setOpen(false);
    setTyping(false);
    setFreeText("");
    setFreeSubject("");
  }

  // Sort: suggested trigger first, then by trigger name
  const sorted = [...tpls].sort((a, b) => {
    if (suggestedTrigger) {
      if (a.trigger === suggestedTrigger && b.trigger !== suggestedTrigger) return -1;
      if (a.trigger !== suggestedTrigger && b.trigger === suggestedTrigger) return 1;
    }
    return a.name.localeCompare(b.name);
  });

  // Colours now come from the central Action Design System (src/lib/actionDesign.ts):
  // WhatsApp = the whatsapp token (brand green + glyph), Email = the email token
  // (blue). Keeps this template-picker entry point visually identical to the
  // plain WhatsApp/Email actions elsewhere. (Supersedes the earlier ad-hoc
  // indigo email colour — email is unified to the system blue.)
  const labelColor = kind === "WHATSAPP" ? ACTION_TOKENS.whatsapp.solid : ACTION_TOKENS.email.solid;
  const isDisabled = kind === "WHATSAPP" ? !lead.phone : !lead.email;
  const iconClass = compact ? "w-3.5 h-3.5" : "w-5 h-5 mb-1";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={isDisabled}
        title={isDisabled ? (kind === "WHATSAPP" ? "No phone number" : "No email") : "Pick a template"}
        className={
          compact
            // Compact variant: horizontal icon+label, smaller padding, fits the
            // mobile-first action bar on /leads/[id].
            ? `flex items-center justify-center gap-1 py-2 rounded-lg ${labelColor} text-xs font-semibold hover:opacity-90 disabled:opacity-30 transition shadow-sm min-h-10`
            // Default: full-size vertical card (used elsewhere in the app).
            : `flex flex-col items-center justify-center py-3 rounded-xl ${labelColor} font-semibold hover:opacity-90 disabled:opacity-30 transition shadow-sm`
        }
      >
        {kind === "WHATSAPP" ? <WhatsAppGlyph className={iconClass} /> : <Mail className={iconClass} />}
        {compact ? (kind === "WHATSAPP" ? "WA" : "Email") : (kind === "WHATSAPP" ? "WhatsApp" : "Email")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setOpen(false)}>
          {/* Bottom-sheet on mobile, centred dialog on desktop. */}
          <div className="bg-white sm:rounded-xl rounded-t-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl safe-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb]">
              <div>
                <div className="font-semibold text-lg">Pick a {kind === "WHATSAPP" ? "WhatsApp" : "Email"} template</div>
                <div className="text-xs text-gray-500">Placeholders filled with {lead.name}'s details</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>

            {/* Follow-up date intentionally REMOVED from the WhatsApp send flow
                (Lalit's rule: the follow-up is set only via Complete / Snooze /
                Escalate / Reschedule / Admin). After a send, the "What next?"
                popup opens so the agent closes the follow-up there. */}

            <div className="overflow-y-auto p-3 space-y-2">
              {/* Free-type mode — typed message goes through the same logging
                  pipeline as templates so admin still sees the touch on the
                  timeline + daily report. */}
              {typing ? (
                <div className="border-2 border-emerald-400 rounded-lg p-3 bg-emerald-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm flex items-center gap-2"><PenLine className="w-4 h-4" /> Type your message</div>
                    <button onClick={() => setTyping(false)} className="text-xs text-gray-500 underline">← back to templates</button>
                  </div>
                  {kind === "EMAIL" && (
                    <input
                      type="text"
                      value={freeSubject}
                      onChange={(e) => setFreeSubject(e.target.value)}
                      placeholder="Subject"
                      className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm bg-white"
                    />
                  )}
                  <textarea
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    placeholder={kind === "WHATSAPP" ? `Hi ${lead.name}, …` : "Type your email body…"}
                    rows={6}
                    autoFocus
                    className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm bg-white font-mono text-[13px]"
                  />
                  <button
                    onClick={sendFreeText}
                    disabled={!freeText.trim()}
                    className="btn btn-primary w-full justify-center text-sm bg-emerald-600 hover:bg-emerald-700"
                  >
                    {kind === "WHATSAPP" ? "💬 Send WhatsApp" : "✉ Send Email"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setTyping(true)}
                  className="w-full text-left p-3 border-2 border-dashed border-emerald-300 rounded-lg hover:border-emerald-500 hover:bg-emerald-50 transition flex items-center gap-2"
                >
                  <PenLine className="w-4 h-4 text-emerald-700" />
                  <div className="flex-1">
                    <div className="font-semibold text-sm text-emerald-800">✍ Type your own message</div>
                    <div className="text-xs text-emerald-700">Skip templates — write a one-off message right here.</div>
                  </div>
                </button>
              )}

              {/* From the Gallery / Resource Library — insert a shareable
                  brochure / link / saved template into this message. */}
              {!typing && resources.length > 0 && (
                <>
                  <div className="text-[10px] uppercase font-bold tracking-widest text-gray-500 pt-2 pb-1 flex items-center gap-1">
                    <FolderOpen className="w-3 h-3" /> From Gallery
                  </div>
                  <div className="space-y-1.5">
                    {resources.slice(0, 8).map((r) => (
                      <button
                        key={r.id}
                        onClick={() => pickResource(r)}
                        className="w-full text-left p-2.5 border border-[#e5e7eb] rounded-lg hover:border-[#c9a24b] transition flex items-center gap-2"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-gray-400 flex-none" />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate">{r.title}</div>
                          <div className="text-[11px] text-gray-500">{r.category} · {r.type === "TEXT" ? "Template" : r.type === "URL" ? "Link" : "File"}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {!typing && <div className="text-[10px] uppercase font-bold tracking-widest text-gray-500 pt-2 pb-1">Or pick a template</div>}
              {!typing && !loaded && <div className="text-sm text-gray-500 text-center py-4">Loading templates…</div>}
              {!typing && loaded && sorted.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-6">
                  No templates yet. <a href="/admin/templates" className="underline">Create some →</a>
                </div>
              )}
              {!typing && sorted.map(t => (
                <button
                  key={t.id}
                  onClick={() => pick(t)}
                  className={`w-full text-left p-3 border rounded-lg hover:border-[#c9a24b] transition ${suggestedTrigger === t.trigger ? "border-[#c9a24b] bg-amber-50" : "border-[#e5e7eb]"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm">{t.name}</div>
                    {suggestedTrigger === t.trigger && <span className="text-[10px] chip chip-warm flex items-center gap-1"><Sparkles className="w-3 h-3" />suggested</span>}
                  </div>
                  {t.rendered.subject && <div className="text-xs text-gray-500 mt-1"><b>Subject:</b> {t.rendered.subject}</div>}
                  <div className="text-xs text-gray-600 mt-1 line-clamp-3 whitespace-pre-wrap">{t.rendered.body}</div>
                </button>
              ))}
            </div>
            <div className="p-3 border-t border-[#e5e7eb] text-[10px] text-gray-500 text-center">
              <a href="/admin/templates" className="underline">+ Add new template</a>
            </div>
          </div>
        </div>
      )}

      {/* Post-send "What next?" prompt (WhatsApp only). Reuses the shared action
          endpoints; the just-logged WA send means Complete passes the gate. */}
      <FollowupNextPopup
        open={showNextPrompt}
        leadId={lead.id}
        leadName={lead.name}
        onClose={() => setShowNextPrompt(false)}
      />
    </>
  );
}
