"use client";
// XPBar — shows the agent's current level + a thin progress bar to the next tier.
// Premium luxury aesthetic: gold accent fills the bar (follows --accent-primary
// so it picks up festive themes), navy text, no garish gradients. Designed to
// sit at the top of the profile page and as an at-a-glance widget elsewhere.
//
// Optional `badgeIds` shows the most recent earned badges inline (max 3).
// Optional `compact` shrinks padding for header/sidebar usage.

import { levelForXp, BADGES, type BadgeId } from "@/lib/gamification";

interface Props {
  xp: number;
  badgeIds?: BadgeId[];
  compact?: boolean;
}

export default function XPBar({ xp, badgeIds = [], compact = false }: Props) {
  const info = levelForXp(xp);
  const { level, next, progressPct } = info;
  const recent = badgeIds.slice(-3).reverse();
  const badgeMap = new Map(BADGES.map((b) => [b.id, b] as const));

  const padding = compact ? "p-3" : "p-4";
  const headerSize = compact ? "text-sm" : "text-base";

  return (
    <div className={`card ${padding} space-y-2`}>
      {/* Level + XP line */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className={`font-bold ${headerSize} text-[#0b1a33] truncate`}>
            {level.name}
          </div>
          <div className="text-[11px] text-gray-500">
            {xp.toLocaleString("en-IN")} XP
            {next && (
              <>
                {" · "}
                <span title={`Next level at ${next.min} XP`}>
                  next: <b className="text-[#0b1a33]">{next.name}</b> at {next.min.toLocaleString("en-IN")}
                </span>
              </>
            )}
            {!next && <> · <b className="text-[#0b1a33]">Max level reached</b></>}
          </div>
        </div>
        {/* Recent badges row — tiny circles, hover for label */}
        {recent.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            {recent.map((id) => {
              const b = badgeMap.get(id);
              if (!b) return null;
              return (
                <span
                  key={id}
                  title={`${b.name} — ${b.desc}`}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#fdf6e3] border border-[#e7c97a] text-base"
                  aria-label={b.name}
                >
                  {b.emoji}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Progress bar — gold fill, navy track. Uses --accent-primary so it
          follows festive theming. Subtle inner shadow for depth. */}
      <div
        className="relative h-2 rounded-full overflow-hidden bg-[#0b1a33]/10"
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progress to ${next?.name ?? "max level"}`}
      >
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-out rounded-full"
          style={{
            width: `${progressPct}%`,
            background: "linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-primary-2) 100%)",
          }}
        />
      </div>
    </div>
  );
}
