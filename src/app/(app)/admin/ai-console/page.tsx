import { requireRole } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { engineStatus } from "@/lib/ai/engine";
import AiConsoleClient from "@/components/AiConsoleClient";

// AI Sales OS — admin console. Surfaces the whole Read-Only-First pipeline:
// read → analyze → detect → suggest → approve → apply, plus buyer↔seller matching,
// data-quality self-heal, and the team BI digest. ADMIN only. Runs on the deterministic
// mock engine by default; a provider key upgrades ambiguous-case reasoning to the LLM.
export const dynamic = "force-dynamic";

export default async function AiConsolePage() {
  await requireRole("ADMIN");
  const enabled = (await getSetting("ai.enabled")).toLowerCase() === "true";
  const status = engineStatus();

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">🧠 AI Sales OS — Console</h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
          Read-Only-First: read → analyze → detect → suggest → <span className="font-semibold">approve → apply</span>.
          Deterministic engine by default; add a provider key for live reasoning on ambiguous cases.
          Every write is reversible, whitelisted &amp; audited.
        </p>
      </div>
      <AiConsoleClient enabled={enabled} status={status} />
    </div>
  );
}
