import { prisma } from "@/lib/prisma";
import CsvUploader from "@/components/CsvUploader";
import GoogleSheetImporter from "@/components/GoogleSheetImporter";
import PreAssignedImporter from "@/components/PreAssignedImporter";
import { requireUser } from "@/lib/auth";
import { getTestingModeEnabled } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  const me = await requireUser();
  const [keys, agents, testingModeOn] = await Promise.all([
    prisma.intakeKey.findMany({ orderBy: { createdAt: "asc" } }),
    me.role === "ADMIN" || me.role === "MANAGER"
      ? prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER", "ADMIN"] } }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    getTestingModeEnabled(),
  ]);
  const websiteKey = keys.find(k => k.source === "WEBSITE")?.key ?? "wcr_live_••••••";
  const waKey = keys.find(k => k.source === "WHATSAPP")?.key ?? "wcr_live_wa_••••••";
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  // Universal-endpoint keys (one per source; run scripts/seed-intake-keys.ts to mint).
  const seedHint = "run scripts/seed-intake-keys.ts";
  const metaKey = keys.find(k => k.source === "FACEBOOK_ADS")?.key ?? seedHint;
  const googleKey = keys.find(k => k.source === "GOOGLE_ADS")?.key ?? seedHint;
  const eventKey = keys.find(k => k.source === "EVENT")?.key ?? seedHint;
  const genericKey = keys.find(k => k.source === "OTHER")?.key ?? seedHint;
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";

  return (
    <>
      {testingModeOn && (
        <div className="card p-3 border-l-4 border-amber-500 bg-amber-50 text-sm text-amber-900">
          🧪 <b>Testing Mode is ON</b> — imported leads will NOT trigger automated WhatsApp / email.{" "}
          <a href="/settings" className="underline ml-1">Change in Settings</a>
        </div>
      )}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Lead Intake Setup</h1>
          <p className="text-sm text-gray-500">All sources flow into the same Leads inbox. Round-robin assigns to your active agents automatically.</p>
        </div>
        {me.role === "ADMIN" && (
          <a href="/intake/history" className="btn btn-ghost whitespace-nowrap" title="View bulk imports — delete or roll back a batch">
            🕑 Import History
          </a>
        )}
      </div>

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
          <p className="text-sm text-gray-600">For events, expos, partner lists. Auto-dedupe by phone + email. Goes through round-robin like any new lead.</p>
          <div className="mt-3"><CsvUploader agents={agents.map(a => ({ id: a.id, name: a.name, team: a.team }))} /></div>
        </div>

        {isAdminOrMgr && (
          <div className="card p-5 border-l-4 border-amber-500 bg-amber-50/30">
            <div className="flex items-center gap-2 mb-2"><span className="chip chip-warm">Agent MIS</span><b>Pre-assigned import (admin only)</b></div>
            <p className="text-sm text-gray-600">Use when an agent already owns these clients (e.g. "Mehak MIS.xlsx"). Every row goes <b>directly</b> to the picked agent — skips round-robin, marked as existing relationship (not cold data).</p>
            <div className="mt-3"><PreAssignedImporter agents={agents.map(a => ({ id: a.id, name: a.name, team: a.team }))} /></div>
          </div>
        )}

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src">📑 Google Sheets</span><b>Direct import</b></div>
          <p className="text-sm text-gray-600">Paste any Google Sheets URL — the CRM pulls it and creates leads (auto-dedup + auto-assign).</p>
          <div className="mt-3"><GoogleSheetImporter /></div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src">📝 Google Forms</span><b>Auto-push (FREE)</b></div>
          <p className="text-sm text-gray-600">Every Google Form submission becomes a CRM lead in 30 seconds. Free Apps Script — no API account needed.</p>
          <details className="mt-3">
            <summary className="text-xs font-semibold text-[#0b1a33] cursor-pointer">Show setup script ↓</summary>
            <pre className="bg-[#0b1a33] text-[#e7c97a] text-[10px] rounded-lg p-3 mt-2 overflow-x-auto leading-snug">{`// In Google Form → ⋮ → Script editor → paste:
const CRM_URL = "${base}/api/intake/website";
const CRM_KEY = "${websiteKey}";

function onFormSubmit(e) {
  const items = e.response.getItemResponses();
  const data = { project: e.source.getTitle() };
  items.forEach(it => {
    const q = it.getItem().getTitle().toLowerCase().trim();
    const v = it.getResponse();
    if (q.includes("name")) data.name = v;
    else if (q.includes("phone") || q.includes("mobile")) data.phone = v;
    else if (q.includes("email")) data.email = v;
    else if (q.includes("city")) data.city = v;
    else if (q.includes("budget")) data.budgetMin = parseFloat(String(v).replace(/[^\\d.]/g,""));
    else if (q.includes("bhk") || q.includes("config")) data.configuration = v;
    else data.message = (data.message ? data.message + " · " : "") + q + ": " + v;
  });
  if (!data.name && !data.phone && !data.email) return;
  UrlFetchApp.fetch(CRM_URL, {
    method: "post", contentType: "application/json",
    headers: { "X-WCR-Key": CRM_KEY },
    payload: JSON.stringify(data),
    muteHttpExceptions: true,
  });
}

// Then: 🕐 Triggers → + Add Trigger → onFormSubmit / From form / On form submit
// Allow permissions → done. Test by submitting your form.`}</pre>
          </details>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src">✉ Email</span><b>Auto-create from inbound emails</b></div>
          <p className="text-sm text-gray-600">Forward 99acres / MagicBricks / Housing / website-contact emails to a dedicated address → CRM parses + creates lead. Setup via Cloudflare Email Routing (FREE).</p>
          <div className="mt-3 text-xs text-gray-500">📑 Step-by-step in <code>EMAIL_TO_LEAD_SETUP.md</code></div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src">Meta Lead Ads</span><b>Facebook + Instagram</b></div>
          <p className="text-sm text-gray-600">Every FB/Instagram lead-form submit → CRM in real time. Two free paths:</p>
          <pre className="bg-[#0b1a33] text-[#e7c97a] text-xs rounded-lg p-3 mt-3 overflow-x-auto">{`Native webhook (no Zapier):
  Callback URL:  ${base}/api/intake/meta
  Verify token:  <your META_VERIFY_TOKEN>
  Subscribe the Page to the "leadgen" field.
  Needs META_APP_SECRET + META_PAGE_TOKEN env.

Or via Zapier:  POST ${base}/api/intake/lead
  X-WCR-Key: ${metaKey}`}</pre>
          <div className="mt-2 text-xs text-gray-500">Full steps in <code>INTEGRATIONS_SETUP.md</code></div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src">Google Ads</span><b>Lead Form extensions</b></div>
          <p className="text-sm text-gray-600">Point the Google Ads lead-form webhook (or a Zapier &quot;Google Ads&quot; zap) at:</p>
          <pre className="bg-[#0b1a33] text-[#e7c97a] text-xs rounded-lg p-3 mt-3 overflow-x-auto">{`POST ${base}/api/intake/lead
X-WCR-Key: ${googleKey}`}</pre>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src">🎟 Townscript / Eventbrite</span><b>Event registrations</b></div>
          <p className="text-sm text-gray-600">Expo / webinar sign-ups auto-enter. Add a webhook in the event platform (or a Zapier zap) → :</p>
          <pre className="bg-[#0b1a33] text-[#e7c97a] text-xs rounded-lg p-3 mt-3 overflow-x-auto">{`POST ${base}/api/intake/lead
X-WCR-Key: ${eventKey}`}</pre>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2"><span className="chip src">⚡ Generic / Zapier / Make</span><b>Any other source</b></div>
          <p className="text-sm text-gray-600">One endpoint for everything else — partner forms, portals, a spreadsheet automation. Send normalized JSON:</p>
          <pre className="bg-[#0b1a33] text-[#e7c97a] text-xs rounded-lg p-3 mt-3 overflow-x-auto">{`POST ${base}/api/intake/lead
X-WCR-Key: ${genericKey}
{ "name": "...", "phone": "...", "email": "...",
  "city": "...", "message": "...", "sourceRaw": "..." }`}</pre>
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
