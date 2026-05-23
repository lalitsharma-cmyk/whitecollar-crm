export default function SettingsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card p-5"><div className="font-semibold">Company</div><div className="text-sm text-gray-500 mt-1">White Collar Realty · crm.whitecollarrealty.com</div></div>
        <div className="card p-5"><div className="font-semibold">Pipeline stages</div><div className="text-sm text-gray-500 mt-1">New → Contacted → Qualified → Site Visit → Negotiation → Won/Lost</div></div>
        <div className="card p-5"><div className="font-semibold">Lead distribution</div><div className="text-sm text-gray-500 mt-1">Round-robin among active agents</div></div>
        <div className="card p-5"><div className="font-semibold">AI provider</div><div className="text-sm text-gray-500 mt-1">Anthropic Claude (set ANTHROPIC_API_KEY in .env)</div></div>
        <div className="card p-5"><div className="font-semibold">Working hours</div><div className="text-sm text-gray-500 mt-1">Mon–Sat 9:00–20:00 IST · Dubai 9:00–19:00 GST</div></div>
        <div className="card p-5"><div className="font-semibold">Notifications</div><div className="text-sm text-gray-500 mt-1">Email + in-app</div></div>
      </div>
    </>
  );
}
