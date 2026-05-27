// Revival Engine — daily mission config.
//
// Single source of truth for the "today's revival mission" panel on /cold-calls.
// Lalit's spec (§9.6): make cold-calling feel rewarding instead of dreary by
// framing each day as a "treasure hunt" with a small, achievable target.
//
// Keep this dumb on purpose — just numbers + copy. The actual call count comes
// from the page server query (CallLog.count joined to Lead.isColdCall=true);
// XP awards are handled by the Gamification agent in src/lib/gamification.ts.
// We only DISPLAY the XP-per-conversion number here.

export const REVIVAL_MISSION = {
  /** How many cold leads the agent should call today to complete the mission. */
  dailyCallTarget: 5,
  /** XP awarded by gamification.ts when a cold lead is promoted to a real lead. */
  xpPerConversion: 50,
  /** "Hidden gem" budget threshold (AED) — above this counts as high-value. */
  hiddenGemBudgetThreshold: 5_000_000,
  /** A cold lead is considered "dormant" after this many days without contact. */
  dormantDays: 30,
} as const;

/**
 * Pick the right cheer for the agent's current progress.
 * Thresholds match the spec:
 *   0     → "Let's go"
 *   1-2   → encouragement
 *   3-4   → "Almost there"
 *   ≥ target → 🏆 complete
 */
export function missionCheer(count: number, target: number): string {
  if (count <= 0) return "Let's go — first call sets the tone";
  if (count >= target) return "🏆 Mission complete! Treasure found";
  const ratio = count / target;
  if (ratio >= 0.6) return "Almost there — one more push";
  return "Nice start — keep the momentum";
}
