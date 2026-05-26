"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, X, ExternalLink } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

interface WALead {
  id: string;
  name: string;
  phone: string | null;
  lastTouched: string | null;
}

/**
 * WhatsApp side-panel. Two modes:
 *
 *  1. Drawer — slides out from the right inside the CRM. Lists recent
 *     WhatsApp leads. Click one → opens that chat in the pop-out window
 *     (or a new tab if pop-out blocked).
 *
 *  2. Pop-out — clicking "Pop out WhatsApp Web" opens web.whatsapp.com in
 *     a separate browser window automatically sized + positioned to the
 *     right half of the screen, so the CRM stays usable on the left.
 *
 *     We can't iframe-embed WhatsApp Web (Meta sets X-Frame-Options to
 *     SAMEORIGIN), so a popup is the closest "side-by-side" experience.
 *     Once the popup is open, every lead click in the drawer reuses it
 *     via window.open(url, "wcrWhatsAppPopup") — same name = same window.
 */
export default function WhatsAppPanel() {
  const [open, setOpen] = useState(false);
  const [leads, setLeads] = useState<WALead[]>([]);
  const [loaded, setLoaded] = useState(false);
  useBodyScrollLock(open);

  async function load() {
    try {
      const r = await fetch("/api/wa/recent-leads", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setLeads(j.leads ?? []);
      setLoaded(true);
    } catch {}
  }

  useEffect(() => { if (open && !loaded) load(); }, [open, loaded]);

  function openPopup(url: string) {
    // Position to the right half of the screen
    const w = Math.max(420, Math.floor(window.screen.availWidth / 2));
    const h = window.screen.availHeight;
    const left = window.screen.availWidth - w;
    const top = 0;
    const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},noopener=no,noreferrer=no`;
    // Same name = same window across clicks
    const popup = window.open(url, "wcrWhatsAppPopup", features);
    if (!popup) {
      // Popup blocked — fall back to new tab
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      popup.focus();
    }
  }

  function openWhatsAppWeb() {
    openPopup("https://web.whatsapp.com/");
  }

  function openLeadChat(phone: string | null) {
    if (!phone) return;
    const digits = phone.replace(/\D/g, "");
    openPopup(`https://web.whatsapp.com/send?phone=${digits}`);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Open WhatsApp side panel"
        aria-label="WhatsApp panel"
        className="p-2 rounded hover:bg-white/10 min-w-11 min-h-11 flex items-center justify-center text-emerald-400"
      >
        <MessageCircle className="w-5 h-5" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />
          <aside
            className="fixed right-0 top-0 bottom-0 w-full sm:w-96 bg-white z-50 shadow-2xl flex flex-col"
            style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e7eb] bg-[#075e54] text-white">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                <div>
                  <div className="font-semibold text-sm">WhatsApp</div>
                  <div className="text-[10px] opacity-80">Side-by-side with your CRM</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-white/20" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 border-b border-[#e5e7eb] bg-[#f7f8fa]">
              <button
                onClick={openWhatsAppWeb}
                className="btn btn-primary w-full justify-center text-sm bg-emerald-600 hover:bg-emerald-700"
              >
                <ExternalLink className="w-4 h-4" /> Pop out WhatsApp Web (right half)
              </button>
              <p className="text-[10px] text-gray-500 mt-2">
                Opens web.whatsapp.com in a separate browser window snapped to the right side of your screen so you can scan it once and use it alongside the CRM.
                Scan the QR with your phone the first time only.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="px-3 pt-3 pb-1 text-[10px] font-bold tracking-widest text-gray-500">RECENT WA LEADS</div>
              {!loaded && <div className="text-xs text-gray-500 px-3 py-4">Loading…</div>}
              {loaded && leads.length === 0 && (
                <div className="text-xs text-gray-500 px-3 py-4">No WhatsApp leads yet. They'll appear here once messages start flowing.</div>
              )}
              {leads.map((l) => (
                <div key={l.id} className="px-3 py-2 border-b border-[#f1f2f6] hover:bg-emerald-50 flex items-center justify-between gap-2">
                  <Link href={`/leads/${l.id}`} onClick={() => setOpen(false)} className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate text-[#0b1a33]">{l.name}</div>
                    <div className="text-[11px] text-gray-500 truncate">{l.phone} {l.lastTouched && `· ${l.lastTouched}`}</div>
                  </Link>
                  {l.phone && (
                    <button
                      onClick={() => openLeadChat(l.phone)}
                      className="btn text-[11px] bg-emerald-600 text-white"
                      title="Open this chat in WhatsApp Web popup"
                    >💬 Chat</button>
                  )}
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-[#e5e7eb] text-[10px] text-gray-500 text-center">
              On phones, the buttons open the WhatsApp app directly.
            </div>
          </aside>
        </>
      )}
    </>
  );
}
