"use client";

// LeadMobileTabs — sticky tab bar shown ONLY on mobile (<1024px) at the top
// of the lead detail page. Sets `body[data-lead-tab="..."]` so global CSS
// (in globals.css) hides cards whose `data-lead-section` doesn't match.
//
// Why driven by a body attribute + CSS instead of conditional React render?
//   • The lead-detail page is a Server Component with ~25 cards; restructuring
//     it into 5 child arrays would mean a giant rewrite + breaks the existing
//     desktop layout (2-col grid with cards mixed across columns).
//   • Server-rendered HTML is the source of truth; the tab bar is a thin client
//     overlay. Cards are still in the DOM (good for desktop) but hidden.
//   • CSS `display:none` is cheaper than re-rendering on every tab click.
//
// Default tab is "overview". When user lands here from a notification, they
// see the same content first paint as desktop, then the tab bar narrows it.

import { useEffect, useState } from "react";

const TABS = [
  { id: "overview", label: "Overview", emoji: "👤" },
  { id: "timeline", label: "Timeline", emoji: "🕓" },
  { id: "actions",  label: "Actions",  emoji: "⚡" },
  { id: "projects", label: "Projects", emoji: "🏢" },
  { id: "admin",    label: "Admin",    emoji: "🛠" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function LeadMobileTabs() {
  const [active, setActive] = useState<TabId>("overview");

  // Sync the active tab → body attribute. Clean up on unmount so navigating
  // away (back to /leads) doesn't leave the attribute dangling and hide
  // things on other pages that might happen to use data-lead-section.
  useEffect(() => {
    document.body.setAttribute("data-lead-tab", active);
    return () => {
      document.body.removeAttribute("data-lead-tab");
    };
  }, [active]);

  return (
    // lg:hidden — desktop ignores the bar entirely.
    // sticky top-0 — bar stays visible while the agent scrolls the active
    //   section. z-30 keeps it above cards but below modals (z-50+).
    // Backdrop-blur because cards have lots of color; a frosted bar reads
    //   better than a solid one.
    <div className="lg:hidden sticky top-0 z-30 -mx-3 sm:-mx-4 mb-3 bg-white/85 backdrop-blur border-b border-gray-200">
      <div className="flex overflow-x-auto px-1 py-1.5 gap-1 no-scrollbar">
        {TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                isActive
                  ? "bg-[#0b1a33] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              aria-pressed={isActive}
            >
              <span aria-hidden className="mr-1">{t.emoji}</span>{t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
