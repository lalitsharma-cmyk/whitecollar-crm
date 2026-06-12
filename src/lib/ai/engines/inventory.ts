import type { Engine, EngineContext } from "../types";
import { parseJsonLoose } from "../json";
import { WCR_PERSONA, leadBlock } from "../persona";

/**
 * Inventory Intelligence Engine — matches the client's requirement to what WCR
 * can sell, and flags what we DON'T have (sourcing gaps) so the agent doesn't
 * pitch blind.
 *
 * v1 mock reasons from budget/config heuristics. The real provider path (and a
 * future DB-backed variant) will match against the live project catalogue —
 * the Engine contract doesn't change.
 */

export interface InventoryMatch {
  name: string;
  why: string;
  pitch: string;
}
export interface InventoryResult {
  requirementSummary: string;
  matchStatus: "GoodMatch" | "PartialMatch" | "NoInventory" | "RequirementUnclear";
  suggestedProjects: InventoryMatch[];
  sourcingGaps: string[];
  pitchAngle: string;
}

function parseBudgetAed(budget?: string | null): number {
  if (!budget) return 0;
  const m = budget.match(/([\d.]+)\s*M/i);
  if (m) return parseFloat(m[1]) * 1_000_000;
  const digits = budget.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

function mock(ctx: EngineContext): InventoryResult {
  const l = ctx.lead;
  const budget = parseBudgetAed(l.budget ?? l.bant?.budget);
  const config = (l.requirement ?? "").toLowerCase();
  const hasReq = !!l.requirement || budget > 0;

  if (!hasReq) {
    return {
      requirementSummary: "Requirement not captured — neither budget nor unit type is on file.",
      matchStatus: "RequirementUnclear",
      suggestedProjects: [],
      sourcingGaps: ["Cannot match inventory without a budget range and unit type. Capture both first."],
      pitchAngle: "Don't pitch yet — qualify the requirement, then match.",
    };
  }

  // Budget-tiered, plausible Dubai stock (mock catalogue).
  const tier =
    budget >= 8_000_000 ? "ultra"
    : budget >= 3_500_000 ? "premium"
    : budget >= 1_500_000 ? "mid"
    : "entry";

  const catalogue: Record<string, InventoryMatch[]> = {
    ultra: [
      { name: "Bugatti Residences, Business Bay", why: "Branded ultra-luxury in the client's AED 8M+ band.", pitch: "Limited branded inventory + strong resale — a trophy asset, not just a home." },
      { name: "Como Residences, Palm Jumeirah", why: "Palm address fits an UHNI second-home / portfolio buyer.", pitch: "Scarcity on the Palm protects value; ideal for a status-led investor." },
    ],
    premium: [
      { name: "Emaar Beachfront", why: "Sea-view 2–3BR in the AED 3.5M+ range with handover momentum.", pitch: "Beachfront + Emaar brand = rental premium and easy exit." },
      { name: "Sobha Hartland II", why: "Greenery + villas/apartments matching a premium end-user.", pitch: "Lifestyle-led with Golden Visa eligibility at this ticket." },
    ],
    mid: [
      { name: "Damac Hills 2", why: "Value community product in the AED 1.5–3.5M band.", pitch: "Strong payment plan; entry into a master community with upside." },
      { name: "JVC (various towers)", why: "High rental yield, investor-friendly ticket size.", pitch: "Best gross yields in Dubai right now — an income play." },
    ],
    entry: [
      { name: "Studio/1BR, JVC or Arjan", why: "Sub-AED 1.5M entry stock with rental demand.", pitch: "Lowest entry into Dubai with Golden-Visa-adjacent value once topped up." },
    ],
  };

  const wantsVilla = /villa|townhouse|plot/.test(config);
  const projects = catalogue[tier];
  const matchStatus: InventoryResult["matchStatus"] = wantsVilla && tier === "entry" ? "PartialMatch" : "GoodMatch";

  return {
    requirementSummary: `${l.requirement ?? "Unit type TBD"} · ${l.budget ?? "budget TBD"} · ${l.team ?? "Dubai"}.`,
    matchStatus,
    suggestedProjects: projects,
    sourcingGaps:
      wantsVilla && tier === "entry"
        ? ["Client wants villa/townhouse but budget suits apartments — either re-set budget or pitch apartment + future upgrade."]
        : tier === "ultra"
          ? ["Confirm exact handover/payment-plan availability on branded stock before committing dates."]
          : [],
    pitchAngle:
      tier === "ultra" || tier === "premium"
        ? "Lead with scarcity, brand and capital protection — this buyer values the asset story."
        : "Lead with yield and payment plan — this buyer is return-driven.",
  };
}

const SCHEMA_HINT = `Return ONLY JSON: { "requirementSummary":string, "matchStatus":"GoodMatch"|"PartialMatch"|"NoInventory"|"RequirementUnclear", "suggestedProjects":[{"name":string,"why":string,"pitch":string}], "sourcingGaps":string[], "pitchAngle":string }`;

export const inventoryEngine: Engine<InventoryResult> = {
  key: "inventory",
  title: "Inventory Intelligence",
  description: "Matches the client's requirement to sellable inventory and flags sourcing gaps.",
  buildPrompt(ctx) {
    return {
      system: `${WCR_PERSONA}\n\nMatch this client to Dubai inventory WCR can realistically sell. Name real project types in their budget band; flag what we lack rather than over-promising.\n${SCHEMA_HINT}`,
      user: `Match inventory to this client's requirement and budget.\n\n${leadBlock(ctx.lead)}`,
    };
  },
  mock,
  parse(raw) {
    const r = parseJsonLoose<InventoryResult>(raw);
    if (!r.matchStatus || !Array.isArray(r.suggestedProjects)) throw new Error("missing required inventory fields");
    return r;
  },
};
