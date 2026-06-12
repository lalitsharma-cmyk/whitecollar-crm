import "server-only";
import { runEngine } from "./runEngine";
import { buildLeadSnapshot, type RawLeadForSnapshot } from "./leadSnapshot";
import { directorEngine, type DirectorResult } from "./engines/director";
import { qualificationEngine, type QualificationResult } from "./engines/qualification";
import { coachingEngine, type CoachingResult } from "./engines/coaching";
import { followupEngine, type FollowupResult } from "./engines/followup";
import { inventoryEngine, type InventoryResult } from "./engines/inventory";
import type { AIProviderName } from "./types";

/**
 * Compute the full AI Sales Director panel for a lead — all P0 engines at once.
 *
 * SECURITY: real-provider calls are confined to the Lalit pilot. Non-pilot leads
 * (every agent's lead) are FORCED to mock here, so turning on a real provider
 * later never spends a token on a non-pilot lead. Mock is deterministic + reads
 * the real lead data, so agents still get actionable output today at zero cost.
 */
export interface SalesDirectorPanelData {
  director: DirectorResult;
  qualification: QualificationResult;
  coaching: CoachingResult;
  followup: FollowupResult;
  inventory: InventoryResult;
  meta: { provider: AIProviderName; mocked: boolean };
}

export async function computeSalesDirectorPanel(
  lead: RawLeadForSnapshot,
  refNow: number,
  opts?: { isPilotLead?: boolean },
): Promise<SalesDirectorPanelData> {
  const snapshot = buildLeadSnapshot(lead, refNow);
  const ctx = { lead: snapshot, memory: null };
  // Pilot leads may use the active provider (mock until one is selected);
  // everyone else is pinned to mock.
  const runOpts = opts?.isPilotLead ? undefined : ({ provider: "mock" as AIProviderName });

  const [d, q, c, f, i] = await Promise.all([
    runEngine(directorEngine, ctx, runOpts),
    runEngine(qualificationEngine, ctx, runOpts),
    runEngine(coachingEngine, ctx, runOpts),
    runEngine(followupEngine, ctx, runOpts),
    runEngine(inventoryEngine, ctx, runOpts),
  ]);

  return {
    director: d.output,
    qualification: q.output,
    coaching: c.output,
    followup: f.output,
    inventory: i.output,
    meta: { provider: d.provider, mocked: d.mocked },
  };
}
