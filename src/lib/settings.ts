// Tiny settings helper backed by the Setting model.
// All settings are stored as TEXT — callers parse to the right shape.

import { prisma } from "@/lib/prisma";

const DEFAULTS = {
  "travel.perKmInr": "10",     // ₹10 per km — admin can change in /settings
  "speedToLead.enabled": "true", // auto-WA + email on every new lead (admin kill-switch)
  // Round-robin auto-assign kill-switch. When OFF, the 5-min reconciler skips
  // every orphan — every new lead stays unassigned until admin manually routes.
  // Default OFF (Lalit, 2026-06-22) — one of the Automation Controls toggles;
  // every new lead stays unassigned until an admin turns this on.
  "roundRobin.enabled": "false",
  // LEGACY testingMode — as of 2026-06-22 it NO LONGER gates notifications OR
  // automation (those are decoupled below). It survives ONLY as the safety guard
  // for the destructive /api/admin/wipe-leads dev tool (refuses unless ON).
  // Default OFF so wipe is refused in normal operation.
  "testingMode.enabled": "false",
  // ── AUTOMATION CONTROLS (Lalit, 2026-06-22) — NOTIFICATIONS ≠ AUTOMATION ──────
  // Notifications/reminders/escalation-alerts ALWAYS fire now. These flags govern
  // ONLY automated ACTIONS, each independently, and ALL DEFAULT OFF — an admin must
  // opt in per feature from /settings before any automatic outbound/movement runs.
  // (Round-robin keeps its own existing flag `roundRobin.enabled`, also OFF.)
  "automation.autoAssignment": "false",   // assign orphan leads to an owner automatically
  "automation.whatsapp": "false",         // automated outbound WhatsApp (welcome / speed-to-lead / workflow)
  "automation.email": "false",            // automated outbound email (speed-to-lead / workflow)
  "automation.autoEscalation": "false",   // automatic escalation ACTIONS (e.g. auto "Needs You" flagging) — NOT the alerts
  "automation.scheduledActions": "false", // workflow-engine scheduled/drip automated actions
  // 15-min Call-SLA breach ESCALATION alert (reconciler §2). Paused by Lalit
  // 2026-06-22 — default OFF; flip to "true" to resume the "no call in 15 min" nudge.
  "slaBreach.enabled": "false",
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
  // ── WEBSITE LEAD AUTO-ASSIGNMENT (Lalit, 2026-06-24) — TEMPORARY ──────────────
  // NEW website-form leads auto-assign by team: Dubai → Mehak, India → Tanuj —
  // "until manually disabled". Default ON. Flip to "false" in /settings (or via
  // setSetting) to revert to the awaiting-team/manual-route behaviour. ONLY new
  // `websiteAutoAssignEnabled` is the master ON/OFF for ALL real-time auto-assign
  // (website + Meta + email + manual-without-owner + quick-add). Default ON; flip
  // to "false" to disable every auto-assignment path at once.
  "websiteAutoAssignEnabled": "true",
  // NOTE (Lalit 2026-06-30): WHO a new lead is auto-assigned to is now decided by
  // the business rule in src/lib/teamAutoAssign.ts → resolveTeamAutoAssignee()
  // (Dubai→Lalit · Tuesday-IST India→Yasir · else Tanuj), NOT this map. This
  // `websiteLeadAssignees` JSON is retained for back-compat/reference only and is
  // no longer read for the routing target.
  "websiteLeadAssignees": JSON.stringify({
    Dubai: "cmpidrrjp0002vphgqb432xq7", // Mehak Mukhija (legacy — superseded by the resolver)
    India: "cmpidrs1n0005vphgg1tj84pj", // Tanuj Chopra
  }),
  // ── BUYER DATA daily auto-distribution (Part 5b) ─────────────────────────────
  // When ON, the daily cron (/api/cron/buyer-distribute) round-robins every
  // ADMIN_POOL buyer across the active calling team. DEFAULT OFF (an automation
  // ACTION, like every other automation toggle) — an admin must opt in from the
  // Buyer Data distribution console before any buyers move on a schedule. The job
  // is idempotent (only touches ADMIN_POOL buyers) + safe (skips if OFF / empty).
  "buyerAutoDistribute.enabled": "false",
  // Optional team filter — empty = the whole active AGENT/MANAGER roster; a team
  // string scopes the daily round-robin to that team's agents only.
  "buyerAutoDistribute.team": "",
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
  return raw.toLowerCase() === "true"; // default OFF (Automation Control)
}

export async function getTestingModeEnabled(): Promise<boolean> {
  const raw = await getSetting("testingMode.enabled");
  if (!raw) return false; // default OFF
  return raw.toLowerCase() === "true";
}

// ── AUTOMATION CONTROLS (decoupled from notifications) ──────────────────
// Every flag defaults OFF: an automated action runs ONLY when its flag is
// explicitly "true". Notifications never consult these — they always fire.
// Round-robin keeps its own getRoundRobinEnabled() (also default OFF).
export type AutomationKey =
  | "automation.autoAssignment"
  | "automation.whatsapp"
  | "automation.email"
  | "automation.autoEscalation"
  | "automation.scheduledActions";

export const AUTOMATION_KEYS: AutomationKey[] = [
  "automation.autoAssignment",
  "automation.whatsapp",
  "automation.email",
  "automation.autoEscalation",
  "automation.scheduledActions",
];

async function getAutomationFlag(key: AutomationKey): Promise<boolean> {
  const raw = await getSetting(key);
  return raw.toLowerCase() === "true"; // default OFF
}
export const getAutoAssignmentEnabled = () => getAutomationFlag("automation.autoAssignment");
export const getWhatsappAutomationEnabled = () => getAutomationFlag("automation.whatsapp");
export const getEmailAutomationEnabled = () => getAutomationFlag("automation.email");
export const getAutoEscalationEnabled = () => getAutomationFlag("automation.autoEscalation");
export const getScheduledActionsEnabled = () => getAutomationFlag("automation.scheduledActions");

// 15-min Call-SLA breach escalation alert. Default OFF (paused). Notification, not
// automation — kept separate so it can be resumed without touching the others.
export async function getSlaBreachEnabled(): Promise<boolean> {
  const raw = await getSetting("slaBreach.enabled");
  return raw.toLowerCase() === "true"; // default OFF
}

// Fresh-untouched escalation (Lalit, 2026-07-01). A lead assigned today with no
// first contact logged → nudge the owning agent at 15 min, escalate to managers/
// Lalit at 45 min. Default OFF (silent-first rollout): the visual layer (badges,
// counts, sorting, filters) ships first; Lalit flips this ON from Settings once
// verified on real data. Kept a distinct key so it resumes without touching the
// call-SLA or automation flags.
export async function getFreshUntouchedEscalationEnabled(): Promise<boolean> {
  const raw = await getSetting("freshUntouched.enabled");
  return raw.toLowerCase() === "true"; // default OFF
}

/** All automation flags (incl. round-robin) for the Settings UI. */
export async function getAutomationFlags(): Promise<Record<string, boolean>> {
  const [flags, roundRobin] = await Promise.all([
    Promise.all(AUTOMATION_KEYS.map((k) => getAutomationFlag(k))),
    getRoundRobinEnabled(),
  ]);
  const out: Record<string, boolean> = { "roundRobin.enabled": roundRobin };
  AUTOMATION_KEYS.forEach((k, i) => { out[k] = flags[i]; });
  return out;
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

// ── Website lead auto-assignment (temporary; Lalit 2026-06-24) ───────────────
// Returns the master ON/OFF flag (default ON) plus the team→userId mapping for
// the two auto-assignees. A malformed/empty mapping JSON resolves to {} so a
// bad value can NEVER crash intake — it just disables auto-assign until fixed.
export type WebsiteAutoAssign = {
  enabled: boolean;
  assignees: Record<string, string>; // e.g. { Dubai: "<id>", India: "<id>" }
};
export async function getWebsiteAutoAssign(): Promise<WebsiteAutoAssign> {
  const [rawEnabled, rawMap] = await Promise.all([
    getSetting("websiteAutoAssignEnabled"),
    getSetting("websiteLeadAssignees"),
  ]);
  const enabled = (rawEnabled || "true").toLowerCase() !== "false"; // default ON
  let assignees: Record<string, string> = {};
  try {
    const parsed = JSON.parse(rawMap || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) assignees[k] = v.trim();
      }
    }
  } catch {
    assignees = {}; // malformed → no auto-assign (safe)
  }
  return { enabled, assignees };
}

// ── Buyer Data daily auto-distribution accessor (Part 5b) ────────────────────
// Returns the master ON/OFF flag (default OFF) + an optional team scope. The
// daily cron consults this; nothing distributes on a schedule unless enabled.
export type BuyerAutoDistribute = { enabled: boolean; team: string };
export async function getBuyerAutoDistribute(): Promise<BuyerAutoDistribute> {
  const [rawEnabled, rawTeam] = await Promise.all([
    getSetting("buyerAutoDistribute.enabled"),
    getSetting("buyerAutoDistribute.team"),
  ]);
  return {
    enabled: rawEnabled.toLowerCase() === "true", // default OFF
    team: (rawTeam ?? "").trim(),
  };
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
