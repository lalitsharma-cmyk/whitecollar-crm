import { requireUser } from "@/lib/auth";
import AskCrmBox from "./AskCrmBox";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// /guide — In-app CRM Guide + AI-Training Q&A (intern learning page).
//
// SANDBOX-ONLY. This whole page is a training aid for interns/new agents and is
// meant to live only in the isolated sandbox environment. The NAV LINK to it is
// gated on NEXT_PUBLIC_SANDBOX === "1" (see MobileShell), and this page ALSO
// guards itself: when the flag is off it renders an inert notice instead of the
// guide, so even a direct URL hit does nothing in production.
//
// Server component (RSC) for the static content; the only interactive piece is
// the <AskCrmBox/> client island (deterministic, offline keyword Q&A).
// ─────────────────────────────────────────────────────────────────────────────

const SANDBOX = process.env.NEXT_PUBLIC_SANDBOX === "1";

// In-page section index (desktop sticky TOC + anchor targets).
const TOC = [
  { id: "welcome",       label: "👋 Welcome" },
  { id: "ask",           label: "🤖 Ask the CRM" },
  { id: "leads",         label: "👥 Lead Module" },
  { id: "buyer-data",    label: "💰 Buyer Data" },
  { id: "master-data",   label: "🗄️ Master Data" },
  { id: "revival",       label: "♻️ Revival Engine" },
  { id: "bant",          label: "🎯 BANT" },
  { id: "meetings",      label: "🏠 Meetings & Site Visits" },
  { id: "reports",       label: "📊 Reports" },
  { id: "ai",            label: "✨ AI" },
  { id: "notifications", label: "🔔 Notifications" },
  { id: "settings",      label: "⚙️ Settings" },
];

export default async function GuidePage() {
  // Login-gated like every (app) page.
  await requireUser();

  // Inert in production — the guide only renders inside the sandbox.
  if (!SANDBOX) {
    return (
      <div className="max-w-xl mx-auto card p-6 text-center">
        <div className="text-3xl">📘</div>
        <h1 className="text-lg font-bold text-[#0b1a33] mt-2">CRM Guide</h1>
        <p className="text-sm text-gray-600 mt-2">
          The interactive CRM Guide is a training tool available only in the sandbox/training
          environment. It is not enabled here.
        </p>
      </div>
    );
  }

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
              className="block px-2 py-1 rounded hover:bg-[#fdfaf2] hover:text-[#0b1a33] text-gray-600 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {t.label}
            </a>
          ))}
        </nav>
      </aside>

      {/* ─────────── Main content ─────────── */}
      <article className="space-y-8 max-w-3xl">
        {/* Welcome */}
        <header id="welcome" className="scroll-mt-20">
          <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest bg-[#fdfaf2] text-[#856404] border border-[#e9d8a6] px-2.5 py-1 rounded-full">
            🎓 Training · Sandbox only
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#0b1a33] dark:text-white mt-3">
            📘 CRM Guide — learn every part in plain English
          </h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-2">
            New here? This page explains every module of the White Collar Realty CRM in simple
            words — no jargon. Read the cards, and use the <b>Ask the CRM</b> box to get instant
            answers to common questions. Everything here is safe to explore; you&apos;re on the
            training copy, nothing touches the live CRM.
          </p>
        </header>

        {/* Ask the CRM — the client island */}
        <section id="ask" className="scroll-mt-20">
          <AskCrmBox />
        </section>

        {/* ── Lead Module ── */}
        <ModuleCard
          id="leads"
          emoji="👥"
          title="Lead Module — the heart of your job"
          summary="A Lead is a person who might buy. This is where you work them day to day."
        >
          <P>
            Every Lead has a name, phone, budget, what they want, and a full history of calls and
            notes. Leads you own appear on your <b>Action List</b> — your to-do list for the day,
            already sorted best-on-top. You work top-down: open a lead, call, log the outcome, write
            a specific remark, and <b>always set the next follow-up date</b>.
          </P>
          <BulletList
            items={[
              ["🔥 Fresh Lead", "a brand-new, never-worked entry in the active pipeline (website / form / manual). It sorts to the very top. It stops being 'fresh' the moment you log a call, note, or WhatsApp. Fresh Lead applies ONLY to the active Leads section — never to Buyer Data, Master Data, Revival/Cold, or bulk imports."],
              ["📞 Log everything", "connected or not — if it isn't logged, it didn't happen."],
              ["✍️ Specific remarks", "budget, need, timeline, who decides. You can speak them with the mic (Hindi or English)."],
              ["📅 Follow-up date", "the golden rule — every lead leaves with a next date, or it goes cold."],
              ["🚫 Rejecting", "marks junk / wrong-number / not-interested leads off the active board and unassigns them, but DELETES NOTHING — conversation, voice, timeline, BANT all preserved. An admin reactivates before reassigning."],
              ["🏆 Won/Closed", "only a real booking/sale/lease closes a lead. Meetings and site visits never close it by themselves."],
            ]}
          />
        </ModuleCard>

        {/* ── Buyer Data ── */}
        <ModuleCard
          id="buyer-data"
          emoji="💰"
          title="Buyer Data — a staging bank of potential buyers"
          summary="Not the active Leads list yet — a pool you work through to find the good ones."
        >
          <P>
            Buyer Data holds potential buyers with details like budget. There are two market
            versions: <b>Dubai Buyer Data</b> (AED) and <b>India Buyer Data</b> (INR / Cr). It uses
            the SAME detail screen as a Lead, but the full lead workflow stays hidden until you
            convert.
          </P>
          <P>
            <b>The lifecycle:</b> records start in the <b>Admin Pool</b> (unassigned holding area) →
            an admin assigns them to an agent → you work them, and each attempt is counted. If a
            buyer is attempted several times with no success (auto-return at 5 attempts), it goes
            back to the Admin Pool to be redistributed. You either <b>Convert</b> a good buyer into
            a live Lead, or <b>Reject</b> a dead one. Every step is saved to the buyer&apos;s
            timeline — history survives reassignment.
          </P>
        </ModuleCard>

        {/* ── Master Data ── */}
        <ModuleCard
          id="master-data"
          emoji="🗄️"
          title="Master Data — the admin control room (admin-only)"
          summary="An Excel-style grid to filter, edit, and route all sales leads."
        >
          <P>
            Master Data is an <b>admin-only</b> grid where leads can be filtered, sorted, inline-edited,
            and bulk-assigned across category tabs — workable, closed/won, lost/rejected, and even
            soft-deleted records that can be restored. It&apos;s a staging and routing hub, not a
            daily to-do list. Cold-call records don&apos;t live here — they&apos;re in the Revival
            Engine. As an intern you&apos;ll rarely open it; your work lives in the Action List and
            Leads.
          </P>
        </ModuleCard>

        {/* ── Revival Engine ── */}
        <ModuleCard
          id="revival"
          emoji="♻️"
          title="Revival Engine (Cold Calls) — bring old leads back"
          summary="Gone-quiet leads gathered so you can win them back."
        >
          <P>
            The Revival Engine (it runs on the <b>Cold Calls</b> screen) is where old, dormant leads
            are gathered. These people were contacted before and went silent — they&apos;re not dead,
            just forgotten. Read the old notes first, call to re-open the conversation, and log the
            outcome like any other call. If there&apos;s a spark, <b>Promote to Lead</b> moves the
            record into the active Leads pipeline, then set a follow-up.
          </P>
          <Note>
            <b>Cold vs Revival:</b> the <b>Cold</b> data bank is the raw pool of quiet / imported
            records you haven&apos;t worked yet. The <b>Revival Engine</b> is the screen where you
            work them and bring the good ones back to life. Old leads are gold nobody else is
            digging for. 💰
          </Note>
        </ModuleCard>

        {/* ── BANT ── */}
        <ModuleCard
          id="bant"
          emoji="🎯"
          title="BANT — how well do you know the buyer?"
          summary="A simple 4-part checklist. Informational — it never blocks you."
        >
          <P>
            BANT is a quick way to score how complete your picture of a buyer is. The lead page shows
            an <b>N/4</b> pill for how many you&apos;ve captured. Fill it in from what the client
            tells you on the call — it never stops you moving a lead, it just makes your next call
            sharper.
          </P>
          <BulletList
            items={[
              ["💵 Budget", "how much they can spend."],
              ["👤 Authority", "are they the decision-maker (or does someone else decide)?"],
              ["🎯 Need", "what they actually want — size, area, project."],
              ["⏳ Timeline", "when they plan to buy."],
            ]}
          />
        </ModuleCard>

        {/* ── Meetings & Site Visits ── */}
        <ModuleCard
          id="meetings"
          emoji="🏠"
          title="Meetings & Site Visits"
          summary="Log them on the lead — but they never close a deal by themselves."
        >
          <P>
            When you meet a client or take them to see a property, log it as an activity on the lead
            so it shows in the timeline and everyone knows it happened. You&apos;ll get reminders
            before scheduled meetings. After a visit, log the outcome and set the next follow-up.
          </P>
          <Note>
            <b>Key rule:</b> a meeting or site visit <b>never</b> marks a lead as Won/Closed — only a
            real booking, sale, or lease does. Keep working the follow-ups after the visit until the
            client commits.
          </Note>
        </ModuleCard>

        {/* ── Reports ── */}
        <ModuleCard
          id="reports"
          emoji="📊"
          title="Reports — your effort in plain numbers"
          summary="You don't build anything — you just read them."
        >
          <P>
            Reports show your daily summary (calls made, connected, leads moved, follow-ups due
            tomorrow), your targets vs. actuals, and progress over time. There&apos;s also a
            <b> Fresh Leads</b> report for new untouched pipeline leads, plus performance,
            leaderboard, follow-up compliance, and source breakdowns. Agents see their own numbers;
            managers and admins see the team. Peek near end of day — a couple more calls might hit
            your target. 💪
          </P>
        </ModuleCard>

        {/* ── AI ── */}
        <ModuleCard
          id="ai"
          emoji="✨"
          title="AI — a sales assistant, not a boss"
          summary="Chat-style help and suggestions. A human always approves."
        >
          <P>
            The AI area is a CRM assistant with an <b>Ask AI</b> chat that can answer pipeline
            questions, suggest next actions, and draft follow-up messages. Admins run it in Demo mode
            (rule-based, no external calls) or Live mode (a real AI provider). It can also power
            optional features like lead distribution and scoring. Treat AI suggestions as help, not
            orders — a person always decides and approves before anything changes.
          </P>
        </ModuleCard>

        {/* ── Notifications ── */}
        <ModuleCard
          id="notifications"
          emoji="🔔"
          title="Notifications — so nothing slips"
          summary="Web push + an in-app sound when something needs you."
        >
          <P>
            The CRM sends web push notifications (phone/desktop) plus an in-app sound for things like
            a new lead assigned, a follow-up due, or a meeting reminder. Every notification links
            back to the record that triggered it, so you can jump straight to it. To get push
            reliably, tap <b>Allow</b> when asked and add the CRM to your home screen. Choose which
            alerts and which sound/volume in <b>Profile → Notifications</b>.
          </P>
        </ModuleCard>

        {/* ── Settings ── */}
        <ModuleCard
          id="settings"
          emoji="⚙️"
          title="Settings & My Profile"
          summary="Admin config vs. your personal preferences."
        >
          <P>
            <b>Settings</b> is where admins configure the CRM — automation controls, projects, teams,
            intake, and system options. As an intern you&apos;ll rarely need it. <b>My Profile</b>
            (separate) is where YOU set your photo, notification sounds, and personal preferences.
            Your real daily work stays in Leads, the Action List, and the Revival Engine.
          </P>
        </ModuleCard>

        {/* Footer nudge */}
        <div className="rounded-xl bg-[#fdfaf2] border border-[#e9d8a6] p-4 text-[13px] text-[#856404]">
          💡 Want to practise a full journey step-by-step? Open <b>🎓 Scenarios</b> from the menu —
          six guided walkthroughs from a new website lead all the way to closing a deal.
        </div>
      </article>
    </div>
  );
}

/* ─────────────────────────── Helper components ─────────────────────────── */

/** A white module card with an anchor id, emoji header, and one-line summary. */
function ModuleCard({
  id,
  emoji,
  title,
  summary,
  children,
}: {
  id: string;
  emoji: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card p-5 scroll-mt-20">
      <h2 className="text-lg font-bold text-[#0b1a33] dark:text-white flex items-center gap-2">
        <span aria-hidden>{emoji}</span>
        {title}
      </h2>
      <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{summary}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** A plain paragraph in the guide's body voice. */
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed">{children}</p>;
}

/** A soft cream call-out for the one thing that matters most in a section. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[#fdfaf2] border border-[#e9d8a6] p-3 text-[13px] text-[#856404] leading-relaxed">
      {children}
    </div>
  );
}

/** A labelled bullet list: each item is [bold label, description]. */
function BulletList({ items }: { items: [string, string][] }) {
  return (
    <ul className="space-y-2">
      {items.map(([label, desc]) => (
        <li key={label} className="flex gap-2 text-sm text-gray-700 dark:text-slate-300">
          <span className="flex-none font-semibold text-[#0b1a33] dark:text-white">{label} —</span>
          <span>{desc}</span>
        </li>
      ))}
    </ul>
  );
}
