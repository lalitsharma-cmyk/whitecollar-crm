import { requireUser } from "@/lib/auth";
import { getTravelRatePerKmInr, getSpeedToLeadEnabled, getRoundRobinEnabled, getTestingModeEnabled } from "@/lib/settings";
import TravelRateEditor from "@/components/TravelRateEditor";
import SpeedToLeadToggle from "@/components/SpeedToLeadToggle";
import RoundRobinToggle from "@/components/RoundRobinToggle";
import TestingModeToggle from "@/components/TestingModeToggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const me = await requireUser();
  const [travelRate, speedToLeadOn, roundRobinOn, testingModeOn] = await Promise.all([
    getTravelRatePerKmInr(),
    getSpeedToLeadEnabled(),
    getRoundRobinEnabled(),
    getTestingModeEnabled(),
  ]);
  const isAdmin = me.role === "ADMIN";
  return (
    <>
      <h1 className="text-xl sm:text-2xl font-bold">Settings</h1>

      {/* MASTER kill-switch — pauses every auto-action. Top of page, loudest banner. */}
      <div className={`card p-5 max-w-2xl border-l-4 ${testingModeOn ? "border-amber-500 bg-amber-50" : "border-emerald-500"}`}>
        <div className="font-semibold flex items-center gap-2 text-base">🧪 Testing mode (master switch)</div>
        <p className="text-xs text-gray-600 mt-1">
          Flip ON while loading real client data so nothing leaks out or nags the team.
          <b className="text-amber-800"> One toggle pauses ALL of these at once:</b>
        </p>
        <ul className="text-xs text-gray-700 mt-2 list-disc list-inside space-y-0.5">
          <li>🔁 Round-robin auto-assign (5-min orphan sweep)</li>
          <li>⏱ 15-min call SLA escalation (no admin/agent alerts)</li>
          <li>🚩 "Needs You" auto-flagging (no banners on stale leads)</li>
          <li>🌙 Overnight auto-WhatsApp welcome (10pm-10am IST)</li>
          <li>🚀 Speed-to-lead first-touch WA + email</li>
        </ul>
        <p className="text-[11px] text-gray-500 mt-2">
          Manual actions (logging calls, clicking Call/WhatsApp/Email buttons) still work normally. Flip OFF for go-live.
        </p>
        <TestingModeToggle initial={testingModeOn} canEdit={isAdmin} />
      </div>

      {/* Round-robin kill-switch — individual control (also gated by testing-mode above) */}
      <div className={`card p-5 max-w-2xl border-l-4 ${roundRobinOn && !testingModeOn ? "border-emerald-500" : "border-amber-500 bg-amber-50"}`}>
        <div className="font-semibold flex items-center gap-2">🔁 Round-robin auto-assign {testingModeOn && <span className="text-[10px] text-amber-700">(also paused by testing mode)</span>}</div>
        <p className="text-xs text-gray-500 mt-1">
          When ON, every unassigned lead older than 5 min gets routed to a present agent automatically.
          <b className="text-amber-700"> Switch OFF before bulk-uploading existing-client lists</b> so they don't get
          stolen by round-robin while you're routing them manually. Switch back ON when done.
        </p>
        <RoundRobinToggle initial={roundRobinOn} canEdit={isAdmin} />
      </div>

      {/* Editable card — travel reimbursement (admin-only) */}
      <div className="card p-5 max-w-2xl">
        <div className="font-semibold flex items-center gap-2">🚗 Travel reimbursement (₹ per km)</div>
        <p className="text-xs text-gray-500 mt-1">
          Applied when India agents log a home visit or site visit with distance. Used to compute reimbursement.
          Update when petrol prices change.
        </p>
        <TravelRateEditor initial={travelRate} canEdit={isAdmin} />
      </div>

      {/* Speed-to-lead auto-response (admin-only) */}
      <div className="card p-5 max-w-2xl">
        <div className="font-semibold flex items-center gap-2">🚀 Speed-to-lead auto-response {testingModeOn && <span className="text-[10px] text-amber-700">(also paused by testing mode)</span>}</div>
        <p className="text-xs text-gray-500 mt-1">
          When ON, every brand-new lead automatically receives the active FIRST_QUERY WhatsApp + email
          templates within seconds of intake. Skips during overnight 10pm-10am IST (after-hours welcome handles that).
          Logged to the lead timeline so the agent can see what was sent.
        </p>
        <SpeedToLeadToggle initial={speedToLeadOn} canEdit={isAdmin} />
      </div>

      {/* Read-only info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card p-5"><div className="font-semibold">Company</div><div className="text-sm text-gray-500 mt-1">White Collar Realty · crm.whitecollarrealty.com</div></div>
        <div className="card p-5"><div className="font-semibold">Pipeline stages</div><div className="text-sm text-gray-500 mt-1">New → Contacted → Qualified → Site Visit → Negotiation → Won/Lost</div></div>
        <div className="card p-5"><div className="font-semibold">Lead distribution</div><div className="text-sm text-gray-500 mt-1">Round-robin among active agents</div></div>
        <div className="card p-5"><div className="font-semibold">AI provider</div><div className="text-sm text-gray-500 mt-1">Anthropic Claude (set ANTHROPIC_API_KEY in .env)</div></div>
        <div className="card p-5"><div className="font-semibold">Working hours</div><div className="text-sm text-gray-500 mt-1">Mon–Sat 9:00–20:00 IST · Dubai 9:00–19:00 GST</div></div>
        <div className="card p-5"><div className="font-semibold">Notifications</div><div className="text-sm text-gray-500 mt-1">Email + in-app + web push</div></div>
      </div>
    </>
  );
}
