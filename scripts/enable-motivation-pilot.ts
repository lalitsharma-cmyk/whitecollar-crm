// One-off: turn the B-20 daily-motivation / voice pilot ON for BOTH teams.
// Lalit chose "both" calling teams (India + Dubai) → "ALL" = everyone.
// Run AFTER the commit that teaches isMotivationPilotViewer the "ALL" sentinel
// is deployed, so prod actually renders the surface once these rows are set.
// Reversible at any time from /settings (Daily motivation → Off).
import { setSetting, isMotivationPilotViewer } from "../src/lib/settings";
import { prisma } from "../src/lib/prisma";

(async () => {
  await setSetting("motivationPilot.enabled", "true");
  await setSetting("motivationPilot.team", "ALL");

  // Sanity-check the gate resolves the way we expect for a few team values.
  const checks = await Promise.all(
    ["India", "Dubai", "", null].map(async (t) => [t, await isMotivationPilotViewer(t)] as const),
  );
  console.log("Motivation pilot ENABLED for ALL teams.");
  for (const [team, eligible] of checks) {
    console.log(`  viewerTeam=${JSON.stringify(team)} → eligible=${eligible}`);
  }
  await prisma.$disconnect();
})();
