// ============================================================================
// CRM-WIDE ACTION DESIGN SYSTEM — SINGLE SOURCE OF TRUTH
// ============================================================================
//
// Every action button / action icon in the CRM (Call, WhatsApp, Email, Log Call,
// Note, Complete, Snooze, Escalate, Follow-up, Meeting, Site Visit, Reject,
// Assign, Resource) must derive its ICON + COLOR + LABEL + TOOLTIP + hover /
// disabled / loading state + size from THIS file — so the same action always
// looks identical on the Leads table, Lead view, Buyer Data, Master Data, Action
// List, Smart Timeline, Reports, Dashboard, and any future module.
//
// HOW TO USE
//   import { ActionButton } from "@/components/actions/ActionButton";
//   import { ActionIconButton } from "@/components/actions/ActionIconButton";
//   <ActionButton action="call" size="md" onClick={...} />            // solid + label
//   <ActionIconButton action="whatsapp" size="sm" href={...} />       // icon-only (tables/timeline)
//   activityVisual("CALL")  // Smart-Timeline maps onto the same icon set/colors
//
// RULE FOR NEW MODULES: do NOT hand-roll an action button with a custom icon or
// colour. Add/extend a key here and consume <ActionButton>/<ActionIconButton>.
// This is the one place to change how an action looks everywhere.
//
// This is a VISUAL layer only — it carries NO business logic, endpoints,
// permissions, or onClick behaviour. Callers keep their exact handlers.
// ============================================================================

import type { LucideIcon } from "lucide-react";
import {
  Phone,
  PhoneCall,
  MessageCircle,
  Mail,
  StickyNote,
  CheckCircle,
  Clock,
  ArrowUpCircle,
  Calendar,
  Users,
  MapPin,
  XCircle,
  UserPlus,
  Image as ImageIcon,
} from "lucide-react";

// The canonical action keys. Add here (not inline in a component) to introduce a
// new standardized action.
export type ActionKey =
  | "call"
  | "whatsapp"
  | "email"
  | "logCall"
  | "note"
  | "complete"
  | "snooze"
  | "escalate"
  | "followUp"
  | "meeting"
  | "siteVisit"
  | "reject"
  | "assign"
  | "resource";

export type ActionSize = "sm" | "md";

export interface ActionToken {
  /** lucide-react icon component. The brand WhatsApp glyph is kept as a custom
   *  inline SVG in the components (lucide has no brand WA mark); MessageCircle is
   *  the token icon used as the lucide fallback. */
  icon: LucideIcon;
  /** Default visible label for the solid/labeled button. */
  label: string;
  /** Tooltip / aria-label — used by the icon-only button (title + aria-label). */
  tooltip: string;
  /**
   * Classes for the SOLID / labeled button (background + text + hover), light +
   * dark. Padding / radius / size come from the size map below, so these are
   * colour-only and can be combined with any size.
   */
  solid: string;
  /**
   * Classes for the GHOST / icon-only button used in dense table Action columns
   * and the timeline — a tinted icon with a soft hover wash (no solid fill), so
   * rows stay light. Light + dark.
   */
  ghost: string;
  /** Bare icon colour (text-*) for inline use where the caller supplies its own
   *  container (e.g. a legend dot or a custom chip). Light + dark. */
  iconColor: string;
}

// ── Per-action tokens ────────────────────────────────────────────────────────
// Colours follow the CRM Action Design spec. The Note token deliberately pins
// dark-navy ink on amber with explicit hex (NOT text-yellow-900) because
// globals.css force-overrides .text-yellow-900 → bright #fde047 in dark mode,
// which would make a yellow-on-yellow invisible button. The arbitrary
// `text-[#…]`/`bg-[#…]` classes are immune to that override, keeping AA contrast
// in BOTH themes — do not "simplify" these to a Tailwind colour family.
export const ACTION_TOKENS: Record<ActionKey, ActionToken> = {
  call: {
    icon: Phone,
    label: "Call",
    tooltip: "Call",
    solid:
      "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
    ghost:
      "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  whatsapp: {
    // Brand WhatsApp green. Components render the brand WA glyph SVG; this icon
    // is the lucide fallback when a glyph isn't used.
    icon: MessageCircle,
    label: "WhatsApp",
    tooltip: "WhatsApp",
    solid: "bg-[#25D366] text-white hover:bg-[#1eb858]",
    ghost: "text-[#1ea953] hover:bg-[#25D366]/10 dark:text-[#25D366] dark:hover:bg-[#25D366]/15",
    iconColor: "text-[#1ea953] dark:text-[#25D366]",
  },
  email: {
    icon: Mail,
    label: "Email",
    tooltip: "Email",
    solid:
      "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500",
    ghost:
      "text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  logCall: {
    // Amber / gold — brand accent. Dark-navy ink for contrast on gold.
    icon: PhoneCall,
    label: "Log Call",
    tooltip: "Log a call / conversation",
    solid: "bg-[#c9a24b] text-[#0b1a33] hover:bg-[#e7c97a]",
    ghost: "text-[#9c7a2e] hover:bg-[#c9a24b]/15 dark:text-[#d9b765] dark:hover:bg-[#c9a24b]/20",
    iconColor: "text-[#9c7a2e] dark:text-[#d9b765]",
  },
  note: {
    // Yellow sticky — dark-navy ink on amber, pinned with hex (see header note).
    icon: StickyNote,
    label: "Note",
    tooltip: "Open private sticky note",
    solid: "bg-[#fcd34d] text-[#3a2c00] hover:bg-[#fbbf24]",
    ghost: "text-[#7a5c00] hover:bg-[#fcd34d]/25 dark:text-[#fcd34d] dark:hover:bg-[#fcd34d]/15",
    iconColor: "text-[#7a5c00] dark:text-[#fcd34d]",
  },
  complete: {
    icon: CheckCircle,
    label: "Complete",
    tooltip: "Mark the current follow-up as done",
    solid:
      "bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500",
    ghost:
      "text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30",
    iconColor: "text-green-600 dark:text-green-400",
  },
  snooze: {
    // Neutral gray per spec (icon/ghost); the solid trigger keeps the amber chip
    // look the follow-up bars use so the snooze pill stays recognisable.
    icon: Clock,
    label: "Snooze",
    tooltip: "Snooze the follow-up",
    solid: "bg-amber-400 text-[#3a2c00] hover:bg-amber-500",
    ghost:
      "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700",
    iconColor: "text-slate-500 dark:text-slate-400",
  },
  escalate: {
    icon: ArrowUpCircle,
    label: "Escalate",
    tooltip: "Escalate to manager",
    solid:
      "bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500",
    ghost:
      "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30",
    iconColor: "text-red-600 dark:text-red-400",
  },
  followUp: {
    icon: Calendar,
    label: "Follow-up",
    tooltip: "Set follow-up date",
    solid:
      "bg-orange-500 text-white hover:bg-orange-600 dark:bg-orange-500 dark:hover:bg-orange-400",
    ghost:
      "text-orange-500 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/30",
    iconColor: "text-orange-500 dark:text-orange-400",
  },
  meeting: {
    icon: Users,
    label: "Meeting",
    tooltip: "Meeting",
    solid:
      "bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-600 dark:hover:bg-purple-500",
    ghost:
      "text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30",
    iconColor: "text-purple-600 dark:text-purple-400",
  },
  siteVisit: {
    icon: MapPin,
    label: "Site Visit",
    tooltip: "Site visit",
    solid:
      "bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500",
    ghost:
      "text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30",
    iconColor: "text-indigo-600 dark:text-indigo-400",
  },
  reject: {
    // Dark red — terminal/destructive outcome (distinct from escalate's red-600).
    icon: XCircle,
    label: "Reject",
    tooltip: "Reject lead — marks it Lost with a structured reason",
    solid:
      "bg-red-700 text-white hover:bg-red-800 dark:bg-red-700 dark:hover:bg-red-600",
    ghost:
      "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30",
    iconColor: "text-red-600 dark:text-red-400",
  },
  assign: {
    icon: UserPlus,
    label: "Assign",
    tooltip: "Assign / reassign",
    solid:
      "bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-600 dark:hover:bg-teal-500",
    ghost:
      "text-teal-600 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-900/30",
    iconColor: "text-teal-600 dark:text-teal-400",
  },
  resource: {
    icon: ImageIcon,
    label: "Resource",
    tooltip: "Share a resource from the Gallery",
    solid:
      "bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500",
    ghost:
      "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700",
    iconColor: "text-slate-700 dark:text-slate-300",
  },
};

// ── Size system ──────────────────────────────────────────────────────────────
// Uniform tap targets, padding, radius, icon px. `sm` is the dense table /
// timeline size; `md` is the default lead-view labeled-button size.
export interface ActionSizeSpec {
  /** lucide icon pixel size (width/height). */
  iconPx: number;
  /** Tailwind class for the icon (kept in sync with iconPx). */
  iconClass: string;
  /** Solid/labeled button classes for this size (padding, font, radius, min tap target). */
  solidSize: string;
  /** Icon-only button box for this size (square, centred, min tap target). */
  iconBox: string;
}

export const ACTION_SIZES: Record<ActionSize, ActionSizeSpec> = {
  sm: {
    iconPx: 14,
    iconClass: "w-3.5 h-3.5",
    // Compact labeled button for tighter rows.
    solidSize: "gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold min-h-9",
    // 32px square — matches the existing dense table/timeline icon buttons.
    iconBox: "w-8 h-8 rounded-md",
  },
  md: {
    iconPx: 16,
    iconClass: "w-4 h-4",
    // Default lead-view action-row button.
    solidSize: "gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold min-h-11",
    // 36px square for the medium icon-only button.
    iconBox: "w-9 h-9 rounded-lg",
  },
};

/** Shared structural classes for the solid/labeled button (everything except
 *  colour + size). */
export const ACTION_SOLID_BASE =
  "inline-flex items-center justify-center font-semibold transition shadow-sm disabled:opacity-60 disabled:cursor-not-allowed";

/** Shared structural classes for the icon-only button. */
export const ACTION_ICON_BASE =
  "inline-flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export function actionToken(action: ActionKey): ActionToken {
  return ACTION_TOKENS[action];
}
