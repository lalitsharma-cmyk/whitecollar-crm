import { createHmac } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTravelRatePerKmInr, getSpeedToLeadEnabled, getRoundRobinEnabled, getTestingModeEnabled } from "@/lib/settings";
import TravelRateEditor from "@/components/TravelRateEditor";
import SpeedToLeadToggle from "@/components/SpeedToLeadToggle";
import RoundRobinToggle from "@/components/RoundRobinToggle";
import TestingModeToggle from "@/components/TestingModeToggle";
import FestivalAdminPanel from "@/components/FestivalAdminPanel";
import TestPushButton from "@/components/TestPushButton";
import NotifPrefsEditor from "@/components/NotifPrefsEditor";

// Parse User.notifPrefs (JSON-stringified `{ kind: boolean }` map). Bad JSON or
// non-object payloads fall back to {} so the editor seeds every toggle ON.
function parseNotifPrefs(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, boolean> = {};
      for (const [k, val] of Object.entries(v)) {
        if (typeof val === "boolean") out[k] = val;
      }
      return out;
    }
  } catch { /* ignore — fall through to default */ }
  return {};
}

export const dynamic = "force-dynamic";

// Build the per-user ICS subscription URL. The HMAC is computed here on the
// server using NEXTAUTH_SECRET so the secret never reaches the client; only
// the resulting userId.signature token is rendered into the page.
function buildIcsUrl(userId: string): string {
  const base = process.env.NEXTAUTH_URL ?? "https://crm.whitecollarrealty.com";
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return "";
  const sig = createHmac("sha256", secret).update(userId).digest("hex");
  return `${base}/api/calendar.ics?token=${userId}.${sig}`;
}

export default async function SettingsPage() {
  const me = await requireUser();
  const [travelRate, speedToLeadOn, roundRobinOn, testingModeOn, pushSubCount] = await Promise.all([
    getTravelRatePerKmInr(),
    getSpeedToLeadEnabled(),
    getRoundRobinEnabled(),
    getTestingModeEnabled(),
    prisma.pushSubscription.count({ where: { userId: me.id } }),
  ]);
  const isAdmin = me.role === "ADMIN";
  const icsUrl = buildIcsUrl(me.id);
  const notifPrefs = parseNotifPrefs((me as { notifPrefs?: string | null }).notifPrefs);
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

      {/* Festival theme — admin manual override for festive mode (spec §12.1) */}
      {isAdmin && (
        <div className="card p-5 max-w-2xl">
          <div className="font-semibold flex items-center gap-2">🎉 Festival theme</div>
          <p className="text-xs text-gray-500 mt-1">
            Force a festive theme on outside its calendar window — useful for previewing
            an upcoming look, or marking an occasion the auto-calendar doesn't cover.
            Affects the accent colour and the festive banner for everyone using this browser.
          </p>
          <div className="mt-3">
            <FestivalAdminPanel />
          </div>
        </div>
      )}

      {/* Calendar subscription — personal ICS feed for Google / Apple Calendar */}
      <div className="card p-5 max-w-2xl">
        <div className="font-semibold flex items-center gap-2">📅 Calendar subscription</div>
        <p className="text-xs text-gray-500 mt-1">
          Subscribe to your follow-ups + scheduled meetings in Google Calendar, Apple Calendar,
          or Outlook. Refreshes automatically every 15–60 min (set by your calendar app).
          <b className="text-amber-700"> This URL is personal — treat it like a password.</b>
        </p>
        {icsUrl ? (
          <>
            <div className="mt-3 flex gap-2 items-stretch">
              <input
                id="wcr-ics-url"
                type="text"
                readOnly
                defaultValue={icsUrl}
                className="flex-1 text-xs font-mono px-2 py-1.5 border border-gray-300 rounded bg-gray-50 truncate"
              />
              <button
                type="button"
                data-copy-target="wcr-ics-url"
                className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 whitespace-nowrap"
              >
                Copy URL
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-2">
              <b>Google Calendar:</b> Other calendars → + → From URL · paste above.
              <br />
              <b>Apple Calendar:</b> File → New Calendar Subscription · paste above.
            </p>
            {/* Tiny inline island for the copy button — avoids a new component file. */}
            <script
              dangerouslySetInnerHTML={{
                __html: `(function(){
                  document.querySelectorAll('[data-copy-target]').forEach(function(btn){
                    if (btn.dataset.bound) return;
                    btn.dataset.bound = '1';
                    btn.addEventListener('click', function(){
                      var id = btn.getAttribute('data-copy-target');
                      var el = document.getElementById(id);
                      if (!el) return;
                      el.select && el.select();
                      try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                          navigator.clipboard.writeText(el.value);
                        } else {
                          document.execCommand('copy');
                        }
                        var prev = btn.textContent;
                        btn.textContent = 'Copied!';
                        setTimeout(function(){ btn.textContent = prev; }, 1500);
                      } catch(e) {}
                    });
                  });
                })();`,
              }}
            />
          </>
        ) : (
          <p className="text-xs text-amber-700 mt-2">
            Calendar subscription unavailable — NEXTAUTH_SECRET is not configured on the server.
          </p>
        )}
      </div>

      {/* Push notifications — fire a self-test so users can verify their
          browser subscription actually delivers (silent no-op is the #1 push bug). */}
      <div className="card p-5 max-w-2xl">
        <div className="font-semibold flex items-center gap-2">🔔 Push notifications</div>
        <p className="text-xs text-gray-500 mt-1">
          Send yourself a test push to confirm hot-lead alerts will actually reach this device.
        </p>
        <p className="text-xs mt-2">
          Subscription status:{" "}
          {pushSubCount > 0 ? (
            <span className="text-emerald-700 font-medium">
              ✅ {pushSubCount} active device{pushSubCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="text-amber-700 font-medium">
              ⚠️ Not subscribed on any device — enable from the bell icon first
            </span>
          )}
        </p>
        <TestPushButton />
        <p className="text-[11px] text-gray-500 mt-2">
          If no notification arrives, check your browser permissions and re-enable push from the bell icon.
        </p>
      </div>

      {/* Per-user notification preferences — mute specific kinds + toggle sound.
          Persistence only; cron/push code will respect these later. */}
      <div className="card p-5 max-w-2xl">
        <div className="font-semibold flex items-center gap-2">🔕 Notification preferences</div>
        <p className="text-xs text-gray-500 mt-1">
          Mute the alerts you don't want and turn in-app sound effects on or off.
          Changes save automatically.
        </p>
        <NotifPrefsEditor initialPrefs={notifPrefs} />
      </div>

      {/* Onboarding tour reset — clears the localStorage flag set by
          OnboardingTour so the 4-step welcome tour shows again on next load. */}
      <div className="card p-5 max-w-2xl">
        <div className="font-semibold flex items-center gap-2">🔁 Onboarding tour</div>
        <p className="text-xs text-gray-500 mt-1">
          See the 4-step welcome tour again next time you load any page.
        </p>
        <button
          type="button"
          data-restart-tour
          className="mt-3 px-3 py-1.5 text-xs font-medium bg-[#c9a24b] hover:bg-[#b8902f] text-[#0b1a33] rounded"
        >
          🔁 Restart onboarding tour
        </button>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              var btn = document.querySelector('[data-restart-tour]');
              if (!btn || btn.dataset.bound) return;
              btn.dataset.bound = '1';
              btn.addEventListener('click', function(){
                try { localStorage.removeItem('wcr-tour-done-v1'); } catch(e) {}
                location.reload();
              });
            })();`,
          }}
        />
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
