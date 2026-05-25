import { requireUser } from "@/lib/auth";
import { getTravelRatePerKmInr } from "@/lib/settings";
import TravelRateEditor from "@/components/TravelRateEditor";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const me = await requireUser();
  const travelRate = await getTravelRatePerKmInr();
  const isAdmin = me.role === "ADMIN";
  return (
    <>
      <h1 className="text-xl sm:text-2xl font-bold">Settings</h1>

      {/* Editable card — travel reimbursement (admin-only) */}
      <div className="card p-5 max-w-2xl">
        <div className="font-semibold flex items-center gap-2">🚗 Travel reimbursement (₹ per km)</div>
        <p className="text-xs text-gray-500 mt-1">
          Applied when India agents log a home visit or site visit with distance. Used to compute reimbursement.
          Update when petrol prices change.
        </p>
        <TravelRateEditor initial={travelRate} canEdit={isAdmin} />
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
