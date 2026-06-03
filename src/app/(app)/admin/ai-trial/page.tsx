/**
 * /admin/ai-trial — AI Trial admin page
 *
 * Sections:
 *  A  Global AI status + quick-toggle
 *  B  New trial run (sample selector, filters, features, estimate → confirm)
 *  C  Active run progress (client-driven step loop)
 *  D  Trial cost report (DONE / STOPPED runs)
 *  E  Run history table
 *
 * Server component for the outer shell + initial data; AiTrialClient handles
 * all interactive state.
 */
import { requireRole } from "@/lib/auth";
import { getAiEnabled, getAiTrialModeEnabled } from "@/lib/settings";
import AiTrialClient from "./AiTrialClient";

export const dynamic = "force-dynamic";

export default async function AiTrialPage() {
  await requireRole("ADMIN");

  const [aiEnabled, trialModeEnabled] = await Promise.all([
    getAiEnabled(),
    getAiTrialModeEnabled(),
  ]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">AI Trial</h1>
        <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Admin only</span>
      </div>
      <AiTrialClient
        initialAiEnabled={aiEnabled}
        initialTrialModeEnabled={trialModeEnabled}
      />
    </div>
  );
}
