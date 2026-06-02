// Tiny settings helper backed by the Setting model.
// All settings are stored as TEXT — callers parse to the right shape.

import { prisma } from "@/lib/prisma";

const DEFAULTS = {
  "travel.perKmInr": "10",     // ₹10 per km — admin can change in /settings
  "speedToLead.enabled": "true", // auto-WA + email on every new lead (admin kill-switch)
  // Round-robin auto-assign kill-switch. When OFF, the 5-min reconciler skips
  // every orphan — every new lead stays unassigned until admin manually routes.
  // Flip OFF before bulk imports of existing-client data.
  "roundRobin.enabled": "true",
  // MASTER TESTING-MODE KILL-SWITCH. When ON, every automated outbound action
  // and every nagging escalation pauses — for using the CRM with real client
  // data without spamming them or filling everyone's bell with fake SLA breaches.
  // Specifically suppresses:
  //   • 15-min call SLA escalation (reconciler section 2)
  //   • "Needs You" auto-flagging (reconciler section 3)
  //   • Overnight auto-WA welcome (leadIngest)
  //   • Speed-to-lead first-touch WA + email (speedToLead)
  //   • Round-robin auto-assign (reconciler section 1)
  // Default OFF — only Lalit flips this ON during go-live testing.
  "testingMode.enabled": "false",
  // ── B-20 voice / motivation pilot (Bucket H) ──
  // The voice + daily-motivation surface is partially specced but NOT yet
  // validated for tone/usefulness, so it ships behind a flag and is piloted
  // with ONE team before any global rollout. Two settings work together:
  //   • motivationPilot.enabled — master ON/OFF for the pilot (default OFF).
  //   • motivationPilot.team    — the single team string (matched against the
  //     existing User.team field, e.g. "Dubai" / "India" / "HQ") that the
  //     surface renders for. Empty = no team scoped → nothing renders even if
  //     the flag is ON. Lalit sets both from /settings when starting the pilot.
  // Off-by-default + team-scoped: nothing renders unless enabled AND the
  // viewer's team matches. NEVER infer team from phone/geography.
  "motivationPilot.enabled": "false",
  "motivationPilot.team": "",
};

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) return row.value;
  return (DEFAULTS as Record<string, string>)[key] ?? "";
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

// Typed accessors
export async function getTravelRatePerKmInr(): Promise<number> {
  const raw = await getSetting("travel.perKmInr");
  const n = Number(raw);
  return isNaN(n) || n < 0 ? 10 : n;
}

export async function getSpeedToLeadEnabled(): Promise<boolean> {
  const raw = await getSetting("speedToLead.enabled");
  if (!raw) return true; // default ON
  return raw.toLowerCase() !== "false";
}

export async function getRoundRobinEnabled(): Promise<boolean> {
  const raw = await getSetting("roundRobin.enabled");
  if (!raw) return true; // default ON
  return raw.toLowerCase() !== "false";
}

export async function getTestingModeEnabled(): Promise<boolean> {
  const raw = await getSetting("testingMode.enabled");
  if (!raw) return false; // default OFF
  return raw.toLowerCase() === "true";
}

// ── B-20 voice / motivation pilot accessors ──────────────────────────
// Master switch for the one-team pilot. Default OFF (mirrors testingMode):
// the surface stays dark for everyone until Lalit deliberately flips it on.
export async function getMotivationPilotEnabled(): Promise<boolean> {
  const raw = await getSetting("motivationPilot.enabled");
  if (!raw) return false; // default OFF
  return raw.toLowerCase() === "true";
}

// The single team the pilot is scoped to (matched against User.team). Trimmed;
// empty string means "no team chosen" → the surface renders for nobody.
export async function getMotivationPilotTeam(): Promise<string> {
  const raw = await getSetting("motivationPilot.team");
  return (raw ?? "").trim();
}

// One-stop eligibility check used by the MotivationPilot component. Returns
// true ONLY when the pilot is enabled AND a team is configured AND the viewer's
// own team (from the User.team field — never derived from phone/geography)
// matches that team, case-insensitively. Any missing piece → false.
export async function isMotivationPilotViewer(
  viewerTeam: string | null | undefined,
): Promise<boolean> {
  const [enabled, pilotTeam] = await Promise.all([
    getMotivationPilotEnabled(),
    getMotivationPilotTeam(),
  ]);
  if (!enabled) return false;
  if (!pilotTeam) return false;
  // "ALL" / "both" → roll the pilot out to every team. Lalit chose both calling
  // teams (India + Dubai), which is effectively everyone, so this sentinel shows
  // the surface to all signed-in users regardless of their own team value.
  const target = pilotTeam.toLowerCase();
  if (target === "all" || target === "both") return true;
  const mine = (viewerTeam ?? "").trim();
  if (!mine) return false;
  return mine.toLowerCase() === target;
}
