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
  // ── BANT qualification stage-gate ──
  // Controls what happens when an agent advances a lead to "Qualified" or
  // beyond WITHOUT all four BANT signals (Budget / Authority / Need / Timeline)
  // captured. Values: "off" | "soft" | "hard".
  //   • off  — no check at all.
  //   • soft — WARN but still allow the move (returns a bantWarning, never blocks).
  //   • hard — BLOCK advancing into Qualified+ until all 4 BANT are captured (422).
  // Default SOFT so it NEVER blocks an agent unexpectedly mid-sale — only an
  // admin deliberately flipping to "hard" makes the gate blocking.
  "bantGate.mode": "soft",
  // ── AI master kill-switch + trial gate (AI Trial Mode spec, Lalit 2026-06-03) ──
  // ai.enabled — GLOBAL on/off for ALL cost-incurring AI. Default OFF: even with
  //   a provider key set, NO AI call fires until an admin flips this ON. When OFF
  //   the UI shows "AI disabled by admin" and every generateText() returns null →
  //   callers fall back to the rule-based path (zero token cost).
  // ai.trialMode.enabled — lets a CONFIRMED, bounded trial run call the provider
  //   on a small sample EVEN WHILE ai.enabled is OFF (the whole point of piloting
  //   before global go-live). Normal flows stay gated by ai.enabled. Default OFF.
  "ai.enabled": "false",
  "ai.trialMode.enabled": "false",
  // ai.monthlyCostCapUsd — hard cap on monthly AI spend. When the rolling calendar-
  //   month total (sum of AiUsageLog.costMicroUsd) reaches this value, every further
  //   generateTextWithUsage call is short-circuited and returns { state: "disabled" }.
  //   "0" = disabled (no cap). Default: "50" = $50/month.
  "ai.monthlyCostCapUsd": "50",
  // ai.extraction.autoApply — when "true", AI-extracted fields with confidence >= 0.90
  //   are written directly to the Lead row (authorityPerson, needSummary, configuration,
  //   aiSummary, aiNextAction). Default "false" so Lalit can review quality on 20 sample
  //   leads BEFORE enabling batch auto-fill. Budget and status fields are NEVER
  //   auto-applied regardless of this flag.
  "ai.extraction.autoApply": "false",
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

// ── AI kill-switch accessors ───────────────────────────────────────────
// Global AI on/off. Default OFF (mirrors testingMode): nothing cost-incurring
// runs until an admin deliberately enables it. Enforced inside generateText().
export async function getAiEnabled(): Promise<boolean> {
  const raw = await getSetting("ai.enabled");
  if (!raw) return false; // default OFF
  return raw.toLowerCase() === "true";
}

// Whether a bounded, admin-confirmed AI trial may call the provider WHILE global
// AI is still OFF. Default OFF. The trial engine checks this; normal flows don't.
export async function getAiTrialModeEnabled(): Promise<boolean> {
  const raw = await getSetting("ai.trialMode.enabled");
  if (!raw) return false; // default OFF
  return raw.toLowerCase() === "true";
}

// Monthly AI cost cap in USD. "0" = disabled. Default $50.
export async function getAiMonthlyCostCapUsd(): Promise<number> {
  const raw = await getSetting("ai.monthlyCostCapUsd");
  const n = Number(raw);
  return isNaN(n) || n < 0 ? 50 : n;
}

// ── BANT stage-gate mode accessor ──────────────────────────────────────
// "off" disables the check, "soft" warns-but-allows, "hard" blocks. Anything
// unrecognised (incl. the legacy empty/default) resolves to "soft" so the gate
// NEVER blocks unless an admin explicitly chose "hard".
export type BantGateMode = "off" | "soft" | "hard";
export async function getBantGateMode(): Promise<BantGateMode> {
  const raw = (await getSetting("bantGate.mode")).toLowerCase();
  return raw === "off" || raw === "hard" ? raw : "soft"; // default soft
}

// Whether to auto-apply AI-extracted fields with confidence >= 0.90.
// Default OFF — admin reviews quality on sample leads first.
export async function getAiExtractionAutoApply(): Promise<boolean> {
  const raw = await getSetting("ai.extraction.autoApply");
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
