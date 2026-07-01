// DetailShell — the ONE shared layout wrapper for every detail page: Lead, Buyer
// Data (India+UAE), Revival/Cold Data (India+UAE), Master Data, Sale Off, Lease Off.
//
// PERMANENT ARCHITECTURE (Lalit approved 2026-07-02, Phase A): all detail pages
// share ONE layout — same grid, section order, header, density — so they never
// drift. ONLY the workflow buttons/permissions differ by module (data-bank views
// hide Lead-only workflow per [[project-databank-vs-lead-rule]]). No duplicate
// pages, no forked layouts.
//
// PURE LAYOUT + SLOTS (no data, no permissions, no coupling to any page): each
// page composes the shell by passing its own banners / header / main-column /
// right-rail / mobile-tabs nodes. A page with no right rail (data-bank views) gets
// a clean single-column layout automatically.
import type { ReactNode } from "react";
import { PAGE_GRID, MAIN_COL, RIGHT_RAIL } from "@/lib/detailLayout";

interface DetailShellProps {
  /** Which module — used only as a data-attribute hook (analytics / e2e); layout is identical. */
  module?: "lead" | "cold" | "buyer" | "master" | "saleoff" | "leaseoff";
  /** Alerts above the header (investor / needs-manager / duplicate / SLA / follow-up / cold badge). */
  banners?: ReactNode;
  /** Name + status chips + action row (module-specific workflow buttons live here). */
  header: ReactNode;
  /** The main content column (overview cards, conversation, module sections). */
  mainColumn: ReactNode;
  /** Optional right rail (sticky note, location, scheduling, admin). Omit → full-width main column. */
  rightRail?: ReactNode;
  /** Optional mobile section-tab bar node (e.g. <LeadMobileTabs/>), passed by the page. */
  mobileTabs?: ReactNode;
}

export default function DetailShell({ module, banners, header, mainColumn, rightRail, mobileTabs }: DetailShellProps) {
  const hasRail = rightRail != null;
  return (
    <div data-detail-module={module}>
      {mobileTabs}
      <div className={hasRail ? PAGE_GRID : "space-y-4 pb-24 lg:pb-0"}>
        {/* Main column — banners → header → content. When there is no right rail
            (data-bank views), it spans full width instead of col-span-2. */}
        <div className={hasRail ? MAIN_COL : "space-y-4"}>
          {banners}
          {header}
          {mainColumn}
        </div>
        {hasRail && <div className={RIGHT_RAIL}>{rightRail}</div>}
      </div>
    </div>
  );
}
