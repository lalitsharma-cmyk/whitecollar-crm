"use client";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import type { AIScore } from "@prisma/client";
import { formatBudget } from "@/lib/budgetParse";
import { telLink, whatsappLink } from "@/lib/phone";
import { ActionIconButton } from "@/components/actions/ActionIconButton";

// Revival Engine — "Hidden Gems" surfacing banner.
//
// Cold-call work is grindy by default. Lalit wants the page to FEEL like a
// treasure hunt, so we lift the highest-value dormant leads to the top in
// a horizontal scroll. Each card is one tap away from a call or WhatsApp —
// the goal is "1 tap to revive a gem", not 3-screens-deep.
//
// The server (cold-calls/page.tsx) does the actual selection so this stays
// a pure presentational client component (needed only for hover/scroll UX).

export interface HiddenGem {
  id: string;
  name: string;
  phone: string | null;
  company: string | null;
  city: string | null;
  budgetMin: number | null;
  budgetCurrency: string;
  aiScore: AIScore | null;
  lastTouchedAt: Date | null;
}

interface Props {
  gems: HiddenGem[];
}

function whySurfaced(g: HiddenGem, daysDormant: number | null): string {
  // Most-specific reason first — agents skim, they don't read.
  const dormantBit = daysDormant != null ? `${daysDormant}d dormant` : "untouched";
  if (g.aiScore === "HOT") return `Old HOT lead, ${dormantBit}`;
  if (g.budgetMin && g.budgetMin > 5_000_000)
    return `High budget (${formatBudget(g.budgetMin, g.budgetCurrency)}), ${dormantBit}`;
  return `Worth a fresh attempt — ${dormantBit}`;
}

export default function HiddenGemsBanner({ gems }: Props) {
  if (!gems.length) return null;

  // First-name personalisation for the WhatsApp opener — same tone as the
  // existing cold-data list (see cold-calls/page.tsx line ~119).
  const buildWA = (g: HiddenGem) =>
    g.phone
      ? whatsappLink(
          g.phone,
          `Hi ${g.name.split(" ")[0]}, this is from White Collar Realty. Reaching out again — any update on your property search?`,
        )
      : "";

  return (
    <div className="card p-3 sm:p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">💎</span>
          <h2 className="text-sm sm:text-base font-bold">Hidden Gems</h2>
          <span className="chip chip-warm text-[10px]">{gems.length}</span>
        </div>
        <span className="text-[11px] text-gray-500 hidden sm:block">
          Dormant leads worth a fresh attempt
        </span>
      </div>

      {/* Horizontal scroll — snap-x so each card lands cleanly on mobile.
          -mx-3 + px-3 lets the row bleed to the card edge while keeping
          the first/last gem padded so they're not flush against the border. */}
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
        {gems.map((g) => {
          const daysDormant = g.lastTouchedAt
            ? Math.floor((Date.now() - new Date(g.lastTouchedAt).getTime()) / 86_400_000)
            : null;
          const wa = buildWA(g);
          const tel = g.phone ? telLink(g.phone) : "";
          return (
            <div
              key={g.id}
              className="snap-start shrink-0 w-[260px] sm:w-[280px] rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-3 flex flex-col gap-2 hover:shadow-md transition-shadow"
              style={{ scrollSnapAlign: "start" }}
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                  💎 Hidden Gem
                </span>
                {g.aiScore === "HOT" && (
                  <span className="chip chip-hot text-[9px]">HOT</span>
                )}
              </div>

              <Link href={`/leads/${g.id}`} className="block group min-w-0">
                <div className="font-semibold text-sm truncate group-hover:underline">
                  {g.name}
                </div>
                <div className="text-[11px] text-gray-600 truncate">
                  {[g.company, g.city].filter(Boolean).join(" · ") || "—"}
                </div>
              </Link>

              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-gray-800">
                  {formatBudget(g.budgetMin, g.budgetCurrency)}
                </span>
                <span className="text-gray-500">
                  {g.lastTouchedAt
                    ? `${formatDistanceToNowStrict(new Date(g.lastTouchedAt))} cold`
                    : "never contacted"}
                </span>
              </div>

              <div className="text-[11px] text-amber-900 italic leading-snug line-clamp-2">
                {whySurfaced(g, daysDormant)}
              </div>

              {g.phone && (
                <div className="flex gap-1.5 mt-auto">
                  {/* Call / WhatsApp — central Action Design System (was a divergent
                      blue Call + inline WA SVG). Hrefs + stopPropagation unchanged. */}
                  <ActionIconButton action="call" variant="solid" href={tel} title={`Call ${g.name}`} onClick={(e: React.MouseEvent) => e.stopPropagation()} />
                  <ActionIconButton action="whatsapp" variant="solid" href={wa} title={`WhatsApp ${g.name}`} external onClick={(e: React.MouseEvent) => e.stopPropagation()} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
