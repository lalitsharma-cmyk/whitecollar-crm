import AIChat from "@/components/AIChat";
import { getAiEnabled } from "@/lib/settings";
import { getRoundRobinEnabled } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [enabled, roundRobinOn] = await Promise.all([
    getAiEnabled(),
    getRoundRobinEnabled(),
  ]);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 card p-5 flex flex-col h-[75vh]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><div className="font-semibold">CRM AI Assistant</div><span className="ai-tag">AI</span></div>
          <span className={`chip ${enabled ? "chip-won" : "chip-warm"}`}>{enabled ? "Live" : "Demo mode"}</span>
        </div>
        {!enabled && (
          <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
            <b>AI disabled by admin.</b> The assistant runs in demo / rule-based mode — no AI provider calls are made. Enable AI from{" "}
            <a href="/settings" className="underline font-medium">Settings → AI Features</a>.
          </div>
        )}
        <AIChat />
      </div>
      <div className="space-y-4">
        <div className="card p-5">
          <div className="font-semibold mb-2">Suggested prompts</div>
          <div className="space-y-2 text-sm">
            <div className="p-2 rounded-lg bg-gray-50">📊 What changed in my pipeline this week?</div>
            <div className="p-2 rounded-lg bg-gray-50">🔥 List leads likely to close in 7 days</div>
            <div className="p-2 rounded-lg bg-gray-50">🧊 Find cold leads worth re-engaging</div>
            <div className="p-2 rounded-lg bg-gray-50">📞 Who hasn&apos;t logged a call today?</div>
            <div className="p-2 rounded-lg bg-gray-50">🏢 Compare Marina Bay vs Sobha Hartland performance</div>
            <div className="p-2 rounded-lg bg-gray-50">💡 Draft a WhatsApp template for NRI investors</div>
          </div>
        </div>
        {!enabled && (
          <div className="card p-5 bg-amber-50 border-amber-200">
            <div className="font-semibold mb-1">Turn on real AI</div>
            <p className="text-xs text-gray-700">In <b>Settings → AI Features</b>, flip the AI toggle ON (admin only). Make sure <code>GEMINI_API_KEY</code> or <code>ANTHROPIC_API_KEY</code> is set in Vercel env vars. Consider running an <a href="/admin/ai-trial" className="underline text-blue-700">AI Trial</a> first to preview costs.</p>
          </div>
        )}
        <div className="card p-5">
          <div className="font-semibold mb-2">Automations active</div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <div>Round-robin lead distribution</div>
              <span className={`chip ${roundRobinOn ? "chip-won" : "chip-warm"}`}>{roundRobinOn ? "ON" : "OFF"}</span>
            </div>
            <div className="flex items-center justify-between">
              <div>Auto-dedupe on intake</div>
              {/* Dedupe is unconditionally wired in ingestLead — there is no
                  admin kill-switch. Showing it as a non-interactive "Always on"
                  badge so the UI is truthful. */}
              <span className="chip chip-won opacity-60 cursor-default" title="Built-in — always active, not user-configurable">Always on</span>
            </div>
            <div className="flex items-center justify-between"><div>AI lead scoring</div><span className={`chip ${enabled ? "chip-won" : "chip-warm"}`}>{enabled ? "ON" : "Rule-based"}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
