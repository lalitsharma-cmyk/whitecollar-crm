"use client";
// ── Learning Mode — HelpDot (SANDBOX ONLY) ───────────────────────────────────
// A small "?" button that sits next to a page title. Clicking it opens a
// popover explaining the current screen in simple English, aimed at interns.
// Content comes from the pure registry in src/lib/helpContent.ts.
//
// GATING: this component contains NO env check itself. Pages mount it only when
// process.env.NEXT_PUBLIC_SANDBOX === "1", so in production it is never rendered
// and nothing changes. (Rendering it unconditionally would still be harmless UI,
// but the mounting sites keep it out of prod entirely.)
//
// Accessibility: button has aria-label + aria-expanded; the panel is role="dialog"
// with aria-modal, closes on Escape and on any outside click, and returns focus
// to the trigger on close.

import { useEffect, useId, useRef, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { getHelpTopic, type HelpTopic } from "@/lib/helpContent";

export default function HelpDot({ topic }: { topic: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const content = getHelpTopic(topic);

  // Close on outside-click + Escape. Only attached while open.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        // Return focus to the trigger so keyboard users don't lose their place.
        btnRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Unknown topic → render nothing rather than an empty popover.
  if (!content) return null;

  return (
    <span ref={rootRef} className="relative inline-flex align-middle">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Learn about the ${content.title} page`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Learning Mode — what is this page?"
        className="inline-flex items-center justify-center h-6 w-6 rounded-full border border-[#c9a24b]/60 bg-[#fdfaf2] text-[#8a6d1f] hover:bg-[#c9a24b] hover:text-white transition-colors dark:bg-amber-950/40 dark:border-amber-600/60 dark:text-amber-300 dark:hover:bg-amber-600 dark:hover:text-white"
      >
        <HelpCircle className="h-4 w-4" strokeWidth={2.25} />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={`${content.title} — help`}
          className="absolute left-0 top-8 z-50 w-[min(92vw,26rem)] max-h-[70vh] overflow-y-auto rounded-xl border-2 border-[#c9a24b] bg-white shadow-2xl dark:bg-slate-800 dark:border-amber-600"
        >
          <HelpPanel content={content} onClose={() => setOpen(false)} />
        </div>
      )}
    </span>
  );
}

function HelpPanel({ content, onClose }: { content: HelpTopic; onClose: () => void }) {
  return (
    <div>
      {/* Header — sticky so the title + close stay visible while scrolling. */}
      <div className="sticky top-0 flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-[#fdfaf2] dark:bg-slate-900/70 dark:border-slate-700">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#c9a24b]">Learning Mode</div>
          <h2 className="text-base font-bold text-[#0b1a33] dark:text-slate-100 leading-tight">{content.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help"
          className="flex-none text-gray-400 hover:text-gray-700 dark:text-slate-500 dark:hover:text-slate-200 p-0.5"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-3 text-sm text-gray-700 dark:text-slate-200">
        <Prose title="What this page is" body={content.whatItIs} />
        <Prose title="Why it exists" body={content.whyItExists} />
        <Prose title="When agents use it" body={content.whenUsed} />
        <List title="What the buttons do" items={content.buttons} />
        <List title="Best practices" items={content.bestPractices} tone="good" />
        <List title="Common mistakes" items={content.commonMistakes} tone="bad" />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#0b1a33] dark:text-amber-200 mb-1">{title}</h3>
      {children}
    </section>
  );
}

function Prose({ title, body }: { title: string; body: string }) {
  return (
    <Section title={title}>
      <p className="leading-relaxed text-gray-600 dark:text-slate-300">{body}</p>
    </Section>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: "good" | "bad" }) {
  if (!items.length) return null;
  const marker = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-[#c9a24b]";
  const bullet = tone === "good" ? "✓" : tone === "bad" ? "✕" : "•";
  return (
    <Section title={title}>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 leading-relaxed">
            <span className={`flex-none font-bold ${marker}`} aria-hidden="true">{bullet}</span>
            <span className="text-gray-600 dark:text-slate-300">{item}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
