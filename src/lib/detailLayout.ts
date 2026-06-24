// ── Shared detail-layout class tokens ────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the visual shells shared by the Lead detail
// (src/app/(app)/leads/[id]/page.tsx) and the Dubai Buyer Data detail
// (src/app/(app)/buyer-data/[id]/page.tsx). Both pages MUST import these so the
// two views can never silently drift apart again (this is the 3rd alignment
// pass — the prior two drifted because each page hard-coded its own classes).
//
// Every constant here is the EXACT class string already used by the Lead view —
// the buyer view is being brought onto these tokens, the Lead view keeps using
// the identical strings. Changing a token changes BOTH pages in lockstep.
//
// The regression suite (scripts/regression.ts → buyer-detail-unification)
// asserts that both pages reference these tokens, so a future edit that breaks
// parity fails the deploy gate.

/** Outer card shell — `.card` (white bg, 1px border, 14px radius) + p-4 padding.
 *  Used by Client Information, Location, Scheduling, Imported Fields, the admin
 *  card, and every buyer extra section. */
export const CARD = "card p-4";

/** Conversation-History card shell — emerald left rail + faint emerald tint,
 *  p-5. Lead = ConversationStreamCard; Buyer = BuyerActivityTimeline. */
export const CONVO_CARD = "card p-5 border-l-4 border-emerald-500 bg-emerald-50/20";

/** Top-of-left-column "verdict" card shell — amber left rail + faint amber tint.
 *  Lead = BANT VERDICT; Buyer = BUYER INTELLIGENCE. (Same tint on both now.) */
export const VERDICT_CARD = "card p-4 border-l-4 border-amber-400 bg-amber-50/40 dark:bg-amber-900/10";

/** Eyebrow heading inside a verdict card (BANT VERDICT / BUYER INTELLIGENCE). */
export const VERDICT_EYEBROW = "text-xs font-bold tracking-widest text-gray-600 dark:text-slate-300";

/** Standard card title (e.g. "Client information", "📍 Location"). */
export const CARD_TITLE = "font-semibold mb-3 dark:text-slate-100";

/** Faint hint appended to a card title ("(click any value to edit)"). */
export const CARD_TITLE_HINT = "text-[10px] text-gray-400 dark:text-slate-500 font-normal";

/** Small-caps eyebrow used by admin/reference cards ("🛠 Lead admin", "📥 Source"). */
export const ADMIN_EYEBROW = "text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold";

/** 2-column field grid used by Client Information + Location (the right-rail style). */
export const FIELD_GRID_2 = "grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm";

/** A single field label inside a 2-col grid (the right-rail Client-Info style). */
export const FIELD_LABEL = "text-xs text-gray-500 dark:text-slate-400";

/** Primary action-button row — fluid flex-wrap so buttons size uniformly and
 *  wrap gracefully (NOT a rigid grid). Each child gets grow + basis-28. This is
 *  the EXACT primitive LeadActionsClient uses for Call/WhatsApp/Email/Log/Note. */
export const ACTION_ROW = "flex flex-wrap gap-2 mt-3 [&>*]:grow [&>*]:basis-28";

/** Outer page grid — main col-span-2 + right rail. */
export const PAGE_GRID = "grid grid-cols-1 lg:grid-cols-3 gap-4 pb-24 lg:pb-0";
/** Main column wrapper. */
export const MAIN_COL = "lg:col-span-2 space-y-4";
/** Right-rail wrapper. */
export const RIGHT_RAIL = "space-y-3";
