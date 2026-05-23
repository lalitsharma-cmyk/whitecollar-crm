import { prisma } from "@/lib/prisma";
import CsvUploader from "@/components/CsvUploader";
import GoogleSheetImporter from "@/components/GoogleSheetImporter";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  const keys = await prisma.intakeKey.findMany({ orderBy: { createdAt: "asc" } });
  const websiteKey = keys.find(k => k.source === "WEBSITE")?.key ?? "wcr_live_••••••";
  const waKey = keys.find(k => k.source === "WHATSAPP")?.key ?? "wcr_live_wa_••••••";
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  return (
    <>
      <h1 className="text-2xl font-bold">Lead Intake Setup</h1>
      <p className="text-sm text-gray-500">All sources flow into the same Leads inbox. Round-robin assigns to your active agents automatically.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src-web">Website</span><b>whitecollarrealty.com</b></div>
          <p className="text-sm text-gray-600">Drop this snippet anywhere on your site. Every form submit creates a lead automatically.</p>
          <pre className="bg-[#0b1a33] text-[#e7c97a] text-xs rounded-lg p-3 mt-3 overflow-x-auto">{`<script src="${base}/embed.js"
        data-key="${websiteKey}"></script>
<div id="wcr-lead-form" data-project="marina-bay"></div>`}</pre>
          <div className="mt-3 text-xs text-gray-500">Or POST directly: <code>{base}/api/intake/website</code> with <code>X-WCR-Key</code> header</div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src-wa">WhatsApp</span><b>Business API</b></div>
          <p className="text-sm text-gray-600">Configure your provider (Meta Cloud / Twilio / Gupshup) webhook to POST to:</p>
          <pre className="bg-[#0b1a33] text-[#e7c97a] text-xs rounded-lg p-3 mt-3 overflow-x-auto">{`POST ${base}/api/intake/whatsapp
X-WCR-Key: ${waKey}

Meta webhook verify token: ${process.env.WHATSAPP_VERIFY_TOKEN ?? "wcr-dev-verify"}`}</pre>
          <div className="mt-3 text-xs text-gray-500">First inbound message → auto-creates lead + saves thread.</div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src-csv">CSV</span><b>Bulk upload</b></div>
          <p className="text-sm text-gray-600">For events, expos, partner lists. Auto-dedupe by phone + email.</p>
          <div className="mt-3"><CsvUploader /></div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src">📑 Google Sheets</span><b>Direct import</b></div>
          <p className="text-sm text-gray-600">Paste any Google Sheets URL — the CRM pulls it and creates leads (auto-dedup + auto-assign).</p>
          <div className="mt-3"><GoogleSheetImporter /></div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src-call">Calls / IVR</span><b>Coming soon</b></div>
          <p className="text-sm text-gray-600">Schema and timeline are already IVR-ready. When you pick a provider (Exotel / Knowlarity / MyOperator), we wire it in one step.</p>
        </div>
      </div>

      <div className="card p-5">
        <div className="font-semibold mb-2">API keys</div>
        <table className="tbl">
          <thead><tr><th>Label</th><th>Source</th><th>Key</th><th>Last used</th><th>Active</th></tr></thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.id}>
                <td>{k.label}</td>
                <td><span className="chip src">{k.source}</span></td>
                <td><code className="text-xs">{k.key}</code></td>
                <td className="text-xs text-gray-500">{k.lastUsed?.toISOString().slice(0, 16).replace("T", " ") ?? "Never"}</td>
                <td>{k.active ? "✅" : "❌"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
