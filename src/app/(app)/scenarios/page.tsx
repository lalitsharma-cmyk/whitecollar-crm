import { requireUser } from "@/lib/auth";
import { CRM_SCENARIOS } from "@/lib/crmScenarios";
import ScenarioBrowser from "./ScenarioBrowser";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// /scenarios — Scenario Mode (guided intern learning walkthroughs).
//
// SANDBOX-ONLY. Six static, step-by-step scenarios that rehearse real CRM
// journeys (new website lead → closing). The NAV LINK is gated on
// NEXT_PUBLIC_SANDBOX === "1" (see MobileShell); this page ALSO guards itself and
// renders an inert notice when the flag is off, so a direct URL hit does nothing
// in production. RSC shell + a small client island (<ScenarioBrowser/>) for the
// click-to-open interaction over the pure content in src/lib/crmScenarios.ts.
// ─────────────────────────────────────────────────────────────────────────────

const SANDBOX = process.env.NEXT_PUBLIC_SANDBOX === "1";

export default async function ScenariosPage() {
  await requireUser();

  if (!SANDBOX) {
    return (
      <div className="max-w-xl mx-auto card p-6 text-center">
        <div className="text-3xl">🎓</div>
        <h1 className="text-lg font-bold text-[#0b1a33] mt-2">Scenario Mode</h1>
        <p className="text-sm text-gray-600 mt-2">
          Guided learning scenarios are a training tool available only in the sandbox/training
          environment. They are not enabled here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest bg-[#fdfaf2] text-[#856404] border border-[#e9d8a6] px-2.5 py-1 rounded-full">
          🎓 Training · Sandbox only
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#0b1a33] dark:text-white mt-3">
          🎓 Scenario Mode — practise real CRM journeys
        </h1>
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-2">
          Pick a scenario below. Each one walks you through a real situation step by step — what to
          click, what you&apos;ll see, and why it matters. Follow along on the sandbox copy; nothing
          here touches the live CRM. Great for your first week. 💪
        </p>
      </header>

      <ScenarioBrowser scenarios={CRM_SCENARIOS} />

      <div className="rounded-xl bg-[#fdfaf2] border border-[#e9d8a6] p-4 text-[13px] text-[#856404]">
        💡 Want the plain-English explanation of each module first? Open <b>📘 CRM Guide</b> from the
        menu — it also has an <b>Ask the CRM</b> box for quick questions.
      </div>
    </div>
  );
}
