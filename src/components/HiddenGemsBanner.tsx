"use client";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import type { AIScore } from "@prisma/client";
import { formatBudget } from "@/lib/budgetParse";
import { telLink, whatsappLink } from "@/lib/phone";

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
            ? Math.floor((Date.now() - g.lastTouchedAt.getTime()) / 86_400_000)
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
                    ? `${formatDistanceToNowStrict(g.lastTouchedAt)} cold`
                    : "never contacted"}
                </span>
              </div>

              <div className="text-[11px] text-amber-900 italic leading-snug line-clamp-2">
                {whySurfaced(g, daysDormant)}
              </div>

              {g.phone && (
                <div className="flex gap-1.5 mt-auto">
                  <a
                    href={tel}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Call ${g.name}`}
                    title={`Call ${g.name}`}
                    className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.17 6.5a19.79 19.79 0 01-3.07-8.67A2 2 0 011.72 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L5.93 7.47a16 16 0 006.29 6.29l1.54-1.54a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
                  </a>
                  <a
                    href={wa}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`WhatsApp ${g.name}`}
                    title={`WhatsApp ${g.name}`}
                    className="w-8 h-8 rounded-lg bg-[#25D366] hover:bg-[#1ea953] text-white flex items-center justify-center transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
