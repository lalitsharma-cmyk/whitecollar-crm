import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// In-page TOC links — used by the sticky sidebar on desktop and as
// anchor targets for each section.
const TOC = [
  { id: "quick-start",     label: "🎯 Quick start" },
  { id: "shortcuts",       label: "⌨ Keyboard shortcuts" },
  { id: "call-logging",    label: "📞 Call logging" },
  { id: "tags",            label: "🏷 Tags" },
  { id: "missions",        label: "🎯 Missions + XP" },
  { id: "vault",           label: "🧘 Vault" },
  { id: "workflows",       label: "🛠 Workflows" },
  { id: "reports",         label: "📊 Reports" },
  { id: "faq",             label: "❓ FAQ" },
  { id: "contact",         label: "📧 Need more help?" },
];

export default async function HelpPage() {
  // Login-gated. Help content is the same for every role; admin-only
  // bits are called out inline (Workflows section).
  await requireUser();

  return (
    <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-8 max-w-5xl">
      {/* ─────────── Sticky TOC (desktop only) ─────────── */}
      <aside className="hidden lg:block">
        <nav className="sticky top-20 text-sm space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-2 px-2">On this page</div>
          {TOC.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className="block px-2 py-1 rounded hover:bg-[#fdfaf2] hover:text-[#0b1a33] text-gray-600"
            >
              {t.label}
            </a>
          ))}
        </nav>
      </aside>

      {/* ─────────── Main content ─────────── */}
      <article className="space-y-10 max-w-3xl">
        <header>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#0b1a33]">Help &amp; FAQ</h1>
          <p className="text-sm text-gray-600 mt-2">
            How to use the White Collar Realty CRM. Built for our Dubai + India sales teams —
            if it doesn&apos;t match how you actually work, ping Lalit and we&apos;ll change it.
          </p>
        </header>

        {/* ─────────── Quick start ─────────── */}
        <section id="quick-start" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">🎯 Quick start — your day in 5 steps</h2>
          <ol className="space-y-3 text-sm text-gray-700 list-decimal list-inside">
            <li>
              <b>Open the Action List.</b> The top cards are your highest-priority calls today —
              hot leads, SLA-breaching, scheduled callbacks. Work top-down.
            </li>
            <li>
              <b>Make the call.</b> Click <i>Call</i> (or <i>Call via Acefone</i> if your extension is mapped)
              to dial. Use the WhatsApp button for written follow-ups.
            </li>
            <li>
              <b>Log the outcome immediately.</b> Pick an outcome chip (Connected / Not picked / Wrong number / Callback /
              Interested / Not interested) and write a real remark — &quot;Budget 2.5Cr, looking 3BHK Dubai Marina&quot;,
              not &quot;will call later&quot;.
            </li>
            <li>
              <b>Set the follow-up date.</b> Every connected call should leave the lead with a next-step date.
              No date = lead falls into the Revival Engine and you lose momentum.
            </li>
            <li>
              <b>End-of-day mood check.</b> Hit the mood widget on the Dashboard before you sign off — it tells
              Lalit how the team is doing and surfaces who needs help tomorrow morning.
            </li>
          </ol>
        </section>

        {/* ─────────── Keyboard shortcuts ─────────── */}
        <section id="shortcuts" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">⌨ Keyboard shortcuts</h2>
          <p className="text-sm text-gray-600 mb-3">
            Press <Kbd>?</Kbd> anywhere to open the same cheatsheet as a modal.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-gray-500 border-b">
                  <th className="py-2 pr-4">Group</th>
                  <th className="py-2 pr-4">Keys</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <ShortcutRow group="Global" keys={["Cmd/Ctrl", "K"]} label="Quick search (leads, properties, phone, email)" />
                <ShortcutRow group="Global" keys={["?"]} label="Show this cheatsheet" />
                <ShortcutRow group="Nav" keys={["g", "h"]} label="Dashboard (home)" />
                <ShortcutRow group="Nav" keys={["g", "l"]} label="Leads" />
                <ShortcutRow group="Nav" keys={["g", "p"]} label="Pipeline" />
                <ShortcutRow group="Nav" keys={["g", "c"]} label="Cold calls / Revival Engine" />
                <ShortcutRow group="Nav" keys={["g", "a"]} label="Action list" />
                <ShortcutRow group="Nav" keys={["g", "v"]} label="Vault" />
                <ShortcutRow group="Cold call" keys={["1"]} label="Connected" />
                <ShortcutRow group="Cold call" keys={["2"]} label="Not picked" />
                <ShortcutRow group="Cold call" keys={["3"]} label="Callback" />
                <ShortcutRow group="Cold call" keys={["4"]} label="Wrong number" />
                <ShortcutRow group="Cold call" keys={["5"]} label="Interested" />
                <ShortcutRow group="Cold call" keys={["6"]} label="Not interested" />
                <ShortcutRow group="Cold call" keys={["s"]} label="Skip to next lead" />
                <ShortcutRow group="Lead detail" keys={["c"]} label="Click Call (if phone exists)" />
                <ShortcutRow group="Lead detail" keys={["w"]} label="Click WhatsApp" />
                <ShortcutRow group="Lead detail" keys={["n"]} label="Open Notes composer" />
                <ShortcutRow group="Lead detail" keys={["Esc"]} label="Close modal / dropdown" />
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500 mt-3">
            Shortcuts are ignored while you&apos;re typing in a text field — so &quot;c&quot; in a remark box won&apos;t dial.
          </p>
        </section>

        {/* ─────────── Call logging ─────────── */}
        <section id="call-logging" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">📞 Call logging</h2>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-3 mb-1">How to log a call</h3>
          <p className="text-sm text-gray-700">
            Open the lead → <i>Actions</i> tab → <i>Log call</i>. Pick the outcome chip, write the remark
            (mandatory — minimum 8 characters), and save. The call appears on the lead timeline and is
            counted toward your daily call target.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">Voice dictation</h3>
          <p className="text-sm text-gray-700">
            Tap the 🎤 mic icon next to the remark field on mobile to dictate in Hindi or English.
            Edit before saving — the AI doesn&apos;t auto-clean transcripts.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">Callback scheduling</h3>
          <p className="text-sm text-gray-700">
            Pick the <i>Callback</i> outcome and a date — the lead drops out of your Action List until
            that date and reappears at the top on the day, plus you get a push notification 30 min before.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">What each outcome means</h3>
          <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
            <li><b>Connected</b> — you spoke to the actual lead. Counts toward connected-call target + XP.</li>
            <li><b>Not picked</b> — phone rang, no answer. Counts as an attempt but not a connection.</li>
            <li><b>Wrong number</b> — number doesn&apos;t belong to the lead. Auto-tags <code>bad-data</code>.</li>
            <li><b>Callback</b> — they asked you to call back later. Sets the follow-up date.</li>
            <li><b>Interested</b> — qualified verbal interest. Suggests moving to <i>Qualified</i> stage.</li>
            <li><b>Not interested</b> — explicit rejection. Suggests <i>Mark as LOST</i> with reason.</li>
            <li><b>Switched off / Busy</b> — try later same day; doesn&apos;t consume an SLA attempt.</li>
          </ul>
        </section>

        {/* ─────────── Tags ─────────── */}
        <section id="tags" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">🏷 Tags</h2>

          <h3 className="text-sm font-semibold text-[#0b1a33] mb-1">Preset vocabulary</h3>
          <p className="text-sm text-gray-700 mb-2">
            Stick to the presets when they fit — filters and Smart Lists understand them:
          </p>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {["hot", "warm", "cold", "investor", "end-user", "nri", "hni", "site-visit-done", "loan-needed", "ready-to-book", "follow-up", "bad-data", "no-budget", "decision-pending", "decision-maker", "spouse-decides"].map((t) => (
              <span key={t} className="px-2 py-0.5 rounded bg-[#fdfaf2] border border-[#e9d8a6] text-[#856404] font-medium">{t}</span>
            ))}
          </div>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">Custom tags</h3>
          <p className="text-sm text-gray-700">
            On the lead detail, type a new tag and press Enter. Lowercase, hyphenated, no spaces.
            Custom tags work in filters too — but only you see them in autocomplete until someone else uses the same string.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">How filters work</h3>
          <p className="text-sm text-gray-700">
            Tag filters are <b>AND</b> by default — selecting <code>hot</code> + <code>nri</code> shows only leads
            with both. Use the <i>Any of</i> toggle on the filter panel to switch to OR. Save the combo as a
            Smart List so you don&apos;t have to rebuild it.
          </p>
        </section>

        {/* ─────────── Missions + XP ─────────── */}
        <section id="missions" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">🎯 Daily missions + XP</h2>
          <p className="text-sm text-gray-700">
            The CRM rewards the behaviours that actually move deals — not just login time.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">XP &amp; levels</h3>
          <p className="text-sm text-gray-700">
            Each connected call = 10 XP, qualified lead = 25 XP, site visit logged = 50 XP, booking_done = 500 XP.
            Levels are cosmetic — Rookie → Closer → Top Gun → Legend — and unlock badges shown on the Leaderboards page.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">The 4 daily missions</h3>
          <ol className="text-sm text-gray-700 list-decimal list-inside space-y-1">
            <li><b>Hit your call target</b> — your <code>dailyCallTarget</code> (set by Lalit, usually 30–50).</li>
            <li><b>Move 1 lead forward</b> — any stage advance counts.</li>
            <li><b>Clear the Action List</b> — every red/urgent card actioned by EOD.</li>
            <li><b>End-of-day mood check</b> — the 30-second widget on the Dashboard.</li>
          </ol>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">Streaks</h3>
          <p className="text-sm text-gray-700">
            Complete all 4 missions in a day to extend your streak. 7-day streak = badge.
            Miss a day and the streak resets. Sundays and team holidays don&apos;t break it.
          </p>
        </section>

        {/* ─────────── Vault ─────────── */}
        <section id="vault" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">🧘 Vault</h2>
          <p className="text-sm text-gray-700">
            The Vault is your private space — gratitude notes, deal stories, things you want to remember,
            anything you don&apos;t want a manager seeing. Think of it as your work journal.
          </p>

          <div className="mt-3 p-3 rounded-lg bg-emerald-50 border-l-4 border-emerald-500">
            <div className="text-sm font-semibold text-emerald-900">Privacy guarantee</div>
            <p className="text-xs text-emerald-900 mt-1">
              Admins (including Lalit) <b>cannot read Vault content</b>. The database stores entries
              keyed to your user ID and the admin Vault view is intentionally blocked at the API layer.
              Aggregate counts only (e.g. &quot;Priya wrote 12 entries this month&quot;) — never the words.
            </p>
          </div>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">Reset Mode</h3>
          <p className="text-sm text-gray-700">
            Bad day? Hit <i>Reset Mode</i> from the Vault. The CRM hides leaderboards, mutes XP toasts,
            and shows a calmer dashboard for the next 4 hours. Nobody is notified. Use it as often as you need.
          </p>
        </section>

        {/* ─────────── Workflows (admin) ─────────── */}
        <section id="workflows" className="card p-5 scroll-mt-20">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-bold text-[#0b1a33]">🛠 Workflows</h2>
            <span className="text-[10px] bg-[#0b1a33] text-white px-2 py-0.5 rounded-full font-bold">ADMIN</span>
          </div>
          <p className="text-sm text-gray-700">
            Workflows automate the boring stuff: WhatsApp drips, stage-change alerts, SLA pokes, &quot;hot lead
            unattended for 2h&quot; pings. Build them at <code>/admin/workflows</code>.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">The 3 building blocks</h3>
          <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
            <li><b>Trigger</b> — what fires the workflow. <i>Lead created</i>, <i>Stage changed to X</i>, <i>No activity for N days</i>, <i>Tag added</i>, <i>Time of day</i>.</li>
            <li><b>Conditions</b> — optional filters. Source = website, budget &gt; 1Cr, assigned team = Dubai, etc. AND-combined.</li>
            <li><b>Actions</b> — what happens. Send WhatsApp template, send email, add tag, change stage, notify agent, escalate to Lalit.</li>
          </ul>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">Starter templates</h3>
          <p className="text-sm text-gray-700">
            <code>/admin/templates</code> ships pre-built workflows: <i>After-hours auto-WhatsApp</i>,
            <i>3-day no-touch revival</i>, <i>Site-visit thank you</i>, <i>Lost-lead winback (30/60/90 day)</i>,
            <i>NRI welcome sequence</i>. Clone one and edit — faster than starting blank.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">Test before going live</h3>
          <p className="text-sm text-gray-700">
            Every workflow has a <i>Test fire</i> button — pick a real lead, run the workflow once,
            see exactly what would have happened (messages drafted, not sent). Flip <i>Active</i> to on
            only after the test fire looks right. <b>Flip the master Testing Mode in Settings on</b>
            {" "}when loading bulk data — it pauses every workflow so nothing leaks out.
          </p>
        </section>

        {/* ─────────── Reports ─────────── */}
        <section id="reports" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">📊 Reports</h2>

          <h3 className="text-sm font-semibold text-[#0b1a33] mb-1">Daily PDF</h3>
          <p className="text-sm text-gray-700">
            Generated at end-of-day in the format Lalit&apos;s team used to send manually:
            calls dialed / connected / wrong-number, leads added, stage changes, follow-ups due tomorrow,
            mood note. Download from <code>/reports</code> or get it auto-emailed to managers.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">SLA report</h3>
          <p className="text-sm text-gray-700">
            <code>/reports/sla</code> — every breached SLA (lead unassigned &gt; 5 min, first call &gt; 15 min)
            with agent, lead, breach duration, and root cause. Monthly view is the one Lalit reviews on the 1st.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-4 mb-1">Travel reimbursement</h3>
          <p className="text-sm text-gray-700">
            India team only. Logs every home visit / site visit with distance (km) × the rate set in
            <code>/settings</code> (₹/km). The agent gets a monthly summary on their profile; admin sees
            the team-wide total in <code>/reports</code> → <i>Travel</i>.
          </p>
        </section>

        {/* ─────────── FAQ ─────────── */}
        <section id="faq" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">❓ FAQ — common questions</h2>
          <div className="divide-y divide-gray-100 -mx-2">
            <Faq q="What's the difference between 'Reject' and 'Mark as LOST'?">
              <p>
                <b>Reject</b> is for leads you should never have received in the first place — wrong number,
                spam, test data, duplicate. It removes them from your queue and flags the source for review.
                <b> Mark as LOST</b> is for real leads that didn&apos;t convert — wrong budget, picked a competitor,
                timing not right. LOST leads stay in reporting (conversion math), keep all history, and feed
                the Lost-lead winback workflow 30/60/90 days later.
              </p>
            </Faq>

            <Faq q="Why can't I see all the leads / why am I scoped to mine only?">
              <p>
                Agents see only the leads assigned to them — a security lockdown decision so client data
                doesn&apos;t walk out the door. Managers see their direct reports&apos; leads (via
                <code> User.managerId</code>). Admins (Lalit, Sameer) see everything.
                If you need a lead reassigned to you, ask Lalit or the admin on duty.
              </p>
            </Faq>

            <Faq q="How does the SLA timer work?">
              <p>
                Two timers run on every new lead: <b>5-minute auto-assign</b> (if no one picks it up, round-robin
                assigns to a present agent) and <b>15-minute first-call SLA</b> (assigned agent must log a call
                attempt within 15 min of assignment). Breaches show in <code>/reports/sla</code> and trigger
                a manager notification. Sundays and 10pm–10am IST are excluded.
              </p>
            </Faq>

            <Faq q="What does 'Cold lead' mean vs 'NEW' status?">
              <p>
                <b>NEW</b> is a pipeline stage — a fresh lead nobody has called yet. <b>Cold</b> is a state:
                any lead with no activity for 14+ days drops into the Revival Engine (<code>/cold-calls</code>)
                regardless of stage. You can have a Qualified-stage lead that&apos;s gone cold, or a NEW-stage
                lead that&apos;s still hot because it arrived 10 minutes ago.
              </p>
            </Faq>

            <Faq q="How is the AI score computed?">
              <p>
                The score is <b>rule-based</b>, not ML. Points are awarded for: recency of activity, number of
                connected calls, budget in range for the project, source quality (website &gt; portal &gt; cold list),
                presence of a follow-up date, qualification flag, and tags like <code>investor</code> or <code>hni</code>.
                Penalties for stale dates, wrong-number tags, and lost stage. The full ruleset lives in
                <code> src/lib/score.ts</code> — recomputed nightly + on every stage change.
              </p>
            </Faq>

            <Faq q="Can I undo a stage change?">
              <p>
                Yes — open the lead, click the stage chip, pick the previous stage. Every change is in the
                timeline with the user + timestamp, so the audit trail is preserved. There&apos;s no &quot;undo button&quot;
                because too many auto-actions fire on stage change (workflows, notifications) — manual
                re-set is safer.
              </p>
            </Faq>

            <Faq q="Why is my push notification not arriving?">
              <p>
                Three usual causes: (1) you didn&apos;t hit <i>Allow</i> when the browser asked — re-enable in
                Profile → Notifications; (2) your phone is in deep-sleep mode (Android battery saver kills
                background browsers); (3) the PWA isn&apos;t installed — push works best when the CRM is
                installed from <i>Add to Home Screen</i>. iOS requires iOS 16.4+ AND the installed PWA.
              </p>
            </Faq>

            <Faq q="How do I export my leads as CSV?">
              <p>
                On the Leads list, apply your filters (or open a Smart List), then click <i>Export</i> in the
                toolbar. CSV export is <b>admin-only</b> for security — agents see the button but it asks Lalit
                for approval. Every export is watermarked with your user ID + timestamp and logged in
                <code> /admin/audit</code>.
              </p>
            </Faq>

            <Faq q="What's a Smart List?">
              <p>
                A saved filter combo. Build any filter on the Leads list (stage = Qualified, tag = investor,
                team = Dubai), click <i>Save as Smart List</i>, name it, done. Smart Lists appear in your
                sidebar and update live as leads change. Great for &quot;NRIs to call this week&quot; or
                &quot;hot Dubai investors&quot;.
              </p>
            </Faq>

            <Faq q="How are commissions tracked?">
              <p>
                Commissions are computed off the <code>booking_done</code> stage transition: agent + lead +
                project + booking amount + commission % (set per project in <code>/properties</code>). The
                Leaderboards page shows month-to-date and quarter-to-date. Payouts happen offline — the CRM
                is the source of truth for what was booked, not the payment system.
              </p>
            </Faq>

            <Faq q="The mobile app feels sluggish — what can I do?">
              <p>
                Install the PWA from your browser&apos;s <i>Add to Home Screen</i> menu instead of using the
                browser tab — it loads faster and works offline for read-only views. Clear the cache from
                Profile → <i>Reset local data</i> if a page looks stuck on stale data.
              </p>
            </Faq>
          </div>
        </section>

        {/* ─────────── Contact ─────────── */}
        <section id="contact" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">📧 Need more help?</h2>
          <p className="text-sm text-gray-700">
            This CRM is a <b>custom build</b> — not Salesforce, not a stock product. If something is broken,
            confusing, or doesn&apos;t match how the team actually works, tell Lalit and we&apos;ll fix it.
          </p>
          <div className="mt-3 p-3 rounded-lg bg-[#fdfaf2] border border-[#e9d8a6]">
            <div className="text-sm">
              <b>Lalit</b> — Sales Manager (Dubai + India teams)
              <br />
              <a href="mailto:lalit@whitecollarrealty.com" className="text-[#856404] underline">
                lalit@whitecollarrealty.com
              </a>
            </div>
            <div className="text-xs text-gray-600 mt-2">
              For an urgent CRM outage, message Lalit directly on WhatsApp.
            </div>
          </div>
        </section>
      </article>
    </div>
  );
}

/** Monospace key cap pill — mirrors the one in KeyboardShortcutsHelp.tsx. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-1.5 text-[11px] font-mono font-semibold text-gray-700 bg-gray-100 border border-gray-300 rounded">
      {children}
    </kbd>
  );
}

/** One row in the keyboard shortcuts table. */
function ShortcutRow({ group, keys, label }: { group: string; keys: string[]; label: string }) {
  return (
    <tr>
      <td className="py-2 pr-4 text-gray-500 text-[12px]">{group}</td>
      <td className="py-2 pr-4">
        <span className="inline-flex gap-1">
          {keys.map((k, i) => (
            <Kbd key={i}>{k}</Kbd>
          ))}
        </span>
      </td>
      <td className="py-2 text-gray-700">{label}</td>
    </tr>
  );
}

/** Collapsible FAQ item — native <details> for zero JS. */
function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group py-3 px-2">
      <summary className="cursor-pointer list-none flex items-start justify-between gap-3 text-sm font-semibold text-[#0b1a33] hover:text-[#856404]">
        <span>{q}</span>
        <span className="text-gray-400 group-open:rotate-90 transition-transform flex-none text-base leading-none mt-0.5">›</span>
      </summary>
      <div className="mt-2 pl-1 text-sm text-gray-700 leading-relaxed">{children}</div>
    </details>
  );
}
