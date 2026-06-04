import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// In-page TOC links — used by the sticky sidebar on desktop and as
// anchor targets for each section.
const TOC = [
  { id: "start",           label: "🚀 Start in 60 seconds" },
  { id: "morning",         label: "☀️ Every morning" },
  { id: "action-list",     label: "✅ Your Action List" },
  { id: "work-a-lead",     label: "📞 Work a lead, step by step" },
  { id: "voice",           label: "🎤 Speak, don't type" },
  { id: "whatsapp",        label: "💬 Send WhatsApp" },
  { id: "pipeline",        label: "🪜 Move the pipeline" },
  { id: "revival",         label: "♻️ Revive cold leads" },
  { id: "vault",           label: "🧘 The Vault" },
  { id: "missions",        label: "🎯 Missions + XP" },
  { id: "reports",         label: "📊 Reports" },
  { id: "dos-donts",       label: "👍 Do's & Don'ts" },
  { id: "shortcuts",       label: "⌨ Keyboard shortcuts" },
  { id: "faq",             label: "❓ FAQ" },
  { id: "contact",         label: "📧 Need more help?" },
];

export default async function HelpPage() {
  // Login-gated. This page is the in-app training guide for sales agents —
  // written for someone touching a CRM for the very first time.
  const me = await requireUser();
  const isAgent = me.role === "AGENT";

  return (
    <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-8 max-w-5xl">
      {/* ─────────── Sticky TOC (desktop only) ─────────── */}
      <aside className="hidden lg:block">
        <nav className="sticky top-20 text-sm space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-2 px-2">On this page</div>
          {TOC.filter(t => !(isAgent && (t.id === "reports" || t.id === "contact"))).map((t) => (
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
      <article className="space-y-8 max-w-3xl">
        <header>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#0b1a33]">Welcome 👋 Your CRM guide</h1>
          <p className="text-sm text-gray-600 mt-2">
            New to a CRM? Relax — this is easier than the spreadsheets you&apos;re used to.
            This page walks you through your whole day, one simple step at a time. No tech
            words. Read the green box below and you&apos;re ready to make your first call. 💪
          </p>
        </header>

        {/* ─────────── HERO: Start in 60 seconds ─────────── */}
        <section id="start" className="scroll-mt-20">
          <div className="grad-card rounded-2xl p-5 sm:p-6">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest bg-white/15 text-white px-2.5 py-1 rounded-full">
              🚀 New here? Start in 60 seconds
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-3">
              Your first day, in 4 tiny steps
            </h2>
            <p className="text-sm text-white/80 mt-1">
              Do just these four things today. Everything else on this page can wait.
            </p>

            <ol className="mt-4 space-y-3">
              <HeroStep n={1} emoji="🔑" title="Log in">
                Open the link Lalit sent you, type your email and password, tap <b>Sign in</b>. Done.
              </HeroStep>
              <HeroStep n={2} emoji="🟢" title="Punch in">
                On the <b>Dashboard</b>, tap the green <b>&ldquo;I am here&rdquo;</b> attendance card so the team knows you&apos;ve started.
              </HeroStep>
              <HeroStep n={3} emoji="✅" title="Open your Action List">
                It&apos;s your to-do list of people to call today. The top one is the most important. Start there.
              </HeroStep>
              <HeroStep n={4} emoji="📞" title="Call, then write what happened">
                Tap <b>Call</b>, talk, then pick what happened and type a short note. <b>Always</b> set the next follow-up date. 🎉
              </HeroStep>
            </ol>

            <p className="text-xs text-white/70 mt-4">
              That&apos;s it. You just did the whole job. Scroll down when you want the friendly details. 👇
            </p>
          </div>
        </section>

        {/* ─────────── Every morning ─────────── */}
        <section id="morning" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">☀️ The first thing, every morning</h2>
          <p className="text-sm text-gray-600 mb-4">
            Three quick taps to start your day right. Takes under a minute.
          </p>
          <ol className="space-y-3">
            <StepRow emoji="🏠" title="Open the Dashboard">
              It&apos;s your home screen — the first page you see after logging in.
            </StepRow>
            <StepRow emoji="🟢" title="Punch in on the “I am here” card">
              Tap it once. This marks you present for the day. Forget this and the system thinks you&apos;re off — and new leads may go to someone else.
            </StepRow>
            <StepRow emoji="👀" title="Read your greeting + today’s missions">
              The Dashboard says good morning and shows your <b>missions</b> (small daily goals) and how many people you need to call today. Glance at it, then get going.
            </StepRow>
          </ol>
          <Tip>
            Make this a habit: log in → punch in → check missions. Same three taps, every single morning. ☕
          </Tip>
        </section>

        {/* ─────────── Action List ─────────── */}
        <section id="action-list" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">✅ Your Action List — your to-do for the day</h2>
          <p className="text-sm text-gray-700">
            Think of the Action List as your boss handing you a stack of cards and saying
            <i> &ldquo;call these people, best one on top.&rdquo;</i> You don&apos;t have to decide who to call —
            the CRM already sorted them for you.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MiniCard emoji="⬇️" title="Work top-down">
              Start at the very top and go down. The order is the plan.
            </MiniCard>
            <MiniCard emoji="🔥" title="Hottest first">
              Top cards are your warmest, most ready-to-buy people. Call them while they&apos;re keen.
            </MiniCard>
            <MiniCard emoji="🧹" title="Clear it daily">
              Try to action every card by end of day. An empty Action List = a great day.
            </MiniCard>
          </div>
          <Tip>
            Don&apos;t cherry-pick the easy ones. The person at the top is at the top for a reason. 😉
          </Tip>
        </section>

        {/* ─────────── Work a lead, step by step ─────────── */}
        <section id="work-a-lead" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">📞 Working a lead, step by step</h2>
          <p className="text-sm text-gray-600 mb-4">
            A &ldquo;lead&rdquo; is just a person who might buy. Here&apos;s the full flow — the heart of your job.
          </p>
          <ol className="space-y-3">
            <StepRow emoji="👆" title="1. Open the lead">
              Tap a card on your Action List. You&apos;ll see their name, phone, budget, and what was said last time. Read it before you dial.
            </StepRow>
            <StepRow emoji="📲" title="2. Call them">
              Tap the <b>Call</b> button. Talk like a human — you already know their history from the screen.
            </StepRow>
            <StepRow emoji="🏷️" title="3. Log what happened">
              After the call, tap the outcome that fits: <i>Connected</i>, <i>Not picked</i>, <i>Callback</i>, <i>Interested</i>, <i>Not interested</i>. One tap.
            </StepRow>
            <StepRow emoji="✍️" title="4. Write a real remark">
              In a sentence or two, capture the <b>real situation</b>: <i>&ldquo;Budget 2.5 Cr, wants 3BHK in Dubai Marina, ready in 2 months, decision with wife.&rdquo;</i> Future-you will thank present-you.
            </StepRow>
            <StepRow emoji="📅" title="5. Set the next follow-up date" highlight>
              <b>This is the golden rule.</b> Every lead leaves with a date for the next call. No date = the lead gets forgotten and goes cold. Always. Set. A. Date.
            </StepRow>
          </ol>
          <Callout emoji="🌟" title="The one habit that makes you a top performer">
            Specific remark + a follow-up date on every single lead. That&apos;s it. Do that consistently
            and you&apos;ll never lose a deal because you forgot to call back.
          </Callout>
        </section>

        {/* ─────────── Voice dictation ─────────── */}
        <section id="voice" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">🎤 Speak your remark — don&apos;t type it</h2>
          <p className="text-sm text-gray-700">
            Typing on a phone is slow. So don&apos;t. Tap the <b>🎤 microphone</b> next to the remark box and just
            <b> talk</b> — in <b>Hindi or English</b>, whatever&apos;s comfortable. Your words turn into text.
          </p>
          <ol className="mt-4 space-y-3">
            <StepRow emoji="🎤" title="Tap the mic">
              Find the microphone icon next to where you&apos;d type the remark, and tap it.
            </StepRow>
            <StepRow emoji="🗣️" title="Speak naturally">
              Say what happened on the call — Hindi, English, or a mix. No need to speak like a robot.
            </StepRow>
            <StepRow emoji="👁️" title="Glance, then save">
              Read it once to fix any wrong word, then save. Quick read, big time saved.
            </StepRow>
          </ol>
          <Tip>
            Great between calls when your hands are busy. Speak it in 5 seconds and move to the next lead. ⚡
          </Tip>
        </section>

        {/* ─────────── WhatsApp ─────────── */}
        <section id="whatsapp" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">💬 Send a WhatsApp from the lead</h2>
          <p className="text-sm text-gray-700">
            You already live on WhatsApp — good news, it&apos;s built right in. No need to copy numbers
            or switch apps.
          </p>
          <ol className="mt-4 space-y-3">
            <StepRow emoji="📗" title="Tap the WhatsApp button">
              On the lead&apos;s page, tap the green <b>WhatsApp</b> button. It opens a chat with their number already filled in.
            </StepRow>
            <StepRow emoji="✏️" title="Send your message">
              Share a brochure, a price, or a simple &ldquo;Great speaking with you — here are the details.&rdquo;
            </StepRow>
            <StepRow emoji="📝" title="Log it too">
              Sent something important? Drop a quick remark on the lead so the next person knows. Calls <i>and</i> messages live in one place.
            </StepRow>
          </ol>
        </section>

        {/* ─────────── Pipeline ─────────── */}
        <section id="pipeline" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">🪜 Moving the pipeline stage</h2>
          <p className="text-sm text-gray-700">
            The &ldquo;pipeline&rdquo; is just the journey from <i>new contact</i> to <i>booked deal</i>. As a lead
            warms up, you move them one step forward — like ticking off a ladder.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] font-semibold">
            <Stage emoji="🆕">New</Stage>
            <Arrow />
            <Stage emoji="📞">Contacted</Stage>
            <Arrow />
            <Stage emoji="✅">Qualified</Stage>
            <Arrow />
            <Stage emoji="🏠">Site visit</Stage>
            <Arrow />
            <Stage emoji="🎉">Booked</Stage>
          </div>
          <ol className="mt-4 space-y-3">
            <StepRow emoji="👆" title="Tap the stage label">
              Open the lead and tap the stage chip near the top (it shows where they are now).
            </StepRow>
            <StepRow emoji="➡️" title="Pick the new stage">
              Choose the stage that matches reality. Got real interest? Move them to <i>Qualified</i>. Booked? <i>Booked</i> 🎉.
            </StepRow>
            <StepRow emoji="↩️" title="Made a mistake? Just change it back">
              Tap the chip again and pick the right one. Every change is saved with your name and time — no harm done.
            </StepRow>
          </ol>
          <Tip>
            Keeping stages honest helps everyone see real progress — and it&apos;s how your wins get counted. 📈
          </Tip>
        </section>

        {/* ─────────── Revival Engine ─────────── */}
        <section id="revival" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">♻️ Revival Engine — bringing old leads back to life</h2>
          <p className="text-sm text-gray-700">
            A &ldquo;cold&rdquo; lead is someone nobody has spoken to in a while. They&apos;re not dead — often they
            just got forgotten. The <b>Revival Engine</b> gathers them so you can win them back. Old leads
            are gold nobody else is digging for. 💰
          </p>
          <ol className="mt-4 space-y-3">
            <StepRow emoji="🧊" title="Open the Revival Engine / Cold calls">
              Find it in the menu. It&apos;s a fresh stack of leads that have gone quiet.
            </StepRow>
            <StepRow emoji="📖" title="Read the old notes first">
              See what was discussed before. A warm &ldquo;Hi, following up on the Marina apartment&rdquo; beats a cold pitch.
            </StepRow>
            <StepRow emoji="📞" title="Call and re-open the conversation">
              Reconnect, find out what changed, and log the outcome just like any other call.
            </StepRow>
            <StepRow emoji="📅" title="Set a follow-up if there’s a spark">
              Any interest at all? Give them a follow-up date and pull them back into your active list.
            </StepRow>
          </ol>
          <Tip>
            Spend a few minutes here when your Action List is clear. One revived lead can make your month. ✨
          </Tip>
        </section>

        {/* ─────────── Vault ─────────── */}
        <section id="vault" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">🧘 The Vault — your space to reset</h2>
          <p className="text-sm text-gray-700">
            The Vault is a space to <b>journal, vent, log your wins, and reset</b>. Sales has high highs and
            low lows — the Vault is where you take a breath and keep your head in the game. 🧠
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MiniCard emoji="📓" title="Journal">
              Jot down thoughts, lessons, or what you want to do better tomorrow.
            </MiniCard>
            <MiniCard emoji="🏆" title="Log your wins">
              Booked a deal? Had a great call? Write it down. Re-read it on tough days.
            </MiniCard>
            <MiniCard emoji="💨" title="Quick Vent">
              Rough call? Let it out so it doesn&apos;t follow you to the next one.
            </MiniCard>
          </div>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-5 mb-1">🎤 You can speak your vent now</h3>
          <p className="text-sm text-gray-700">
            Don&apos;t feel like typing? Tap the <b>🎤 mic</b> and just talk — in <b>Hindi or English</b>. Say what&apos;s on
            your mind and it&apos;s captured for you. Sometimes saying it out loud is all you need.
          </p>

          <h3 className="text-sm font-semibold text-[#0b1a33] mt-5 mb-1">😌 Reset Mode</h3>
          <p className="text-sm text-gray-700">
            Having a hard day? Tap <i>Reset Mode</i> from the Vault. The CRM hides leaderboards, quiets the
            XP pop-ups, and shows a calmer screen for a few hours so you can refocus. Use it whenever you need it.
          </p>
        </section>

        {/* ─────────── Missions + XP ─────────── */}
        <section id="missions" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">🎯 Daily missions + XP</h2>
          <p className="text-sm text-gray-700">
            Think of it like a game. Do the right things, earn points, watch your level climb. It makes a
            busy day a bit more fun — and it rewards the habits that actually win deals.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MiniCard emoji="🎯" title="Missions = small daily goals">
              Like &ldquo;hit your call target&rdquo; or &ldquo;move one lead forward.&rdquo; Tick them off each day.
            </MiniCard>
            <MiniCard emoji="⭐" title="XP = points for good work">
              Connected calls, qualified leads, and bookings all earn XP. More good work, more points.
            </MiniCard>
            <MiniCard emoji="🔥" title="Streaks">
              Finish your missions several days in a row to build a streak. Don&apos;t break the chain!
            </MiniCard>
            <MiniCard emoji="🏅" title="Levels & badges">
              XP levels you up and unlocks badges. A friendly nudge to keep showing up strong.
            </MiniCard>
          </div>
          <Tip>
            Don&apos;t chase points for their own sake. Do the job well and the XP follows on its own. 👍
          </Tip>
        </section>

        {/* ─────────── Reports — hidden for AGENT (not in their nav) ─────────── */}
        {!isAgent && <section id="reports" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">📊 Reports — see how you&apos;re doing</h2>
          <p className="text-sm text-gray-700">
            You don&apos;t need to build anything. Reports just show your effort and results in plain numbers.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-gray-700">
            <BulletRow emoji="📅">
              <b>Your daily summary</b> — calls made, calls connected, leads moved, and follow-ups due tomorrow. A neat picture of your day.
            </BulletRow>
            <BulletRow emoji="🎯">
              <b>Your targets</b> — how many calls you&apos;ve made vs. your goal for the day. Quick gut-check before EOD.
            </BulletRow>
            <BulletRow emoji="📈">
              <b>Your progress over time</b> — how this week compares to last. Watch yourself get better.
            </BulletRow>
          </ul>
          <Tip>
            Peek at your numbers near end of day. A couple more calls might be all it takes to hit your target. 💪
          </Tip>
        </section>}

        {/* ─────────── Do's & Don'ts ─────────── */}
        <section id="dos-donts" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">👍 Do&apos;s &amp; Don&apos;ts</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-bold text-emerald-800 mb-2">✅ Do</div>
              <ul className="space-y-2 text-sm text-emerald-900">
                <li className="flex gap-2"><span>📞</span><span><b>Log every call</b> — connected or not. If it isn&apos;t logged, it didn&apos;t happen.</span></li>
                <li className="flex gap-2"><span>📅</span><span><b>Set a follow-up date</b> on every lead. Every time. No exceptions.</span></li>
                <li className="flex gap-2"><span>✍️</span><span><b>Keep remarks specific</b> — budget, what they want, when, who decides.</span></li>
                <li className="flex gap-2"><span>🎤</span><span><b>Use voice</b> to save time — speak your remark in Hindi or English.</span></li>
              </ul>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-sm font-bold text-rose-800 mb-2">🚫 Don&apos;t</div>
              <ul className="space-y-2 text-sm text-rose-900">
                <li className="flex gap-2"><span>❌</span><span><b>Don&apos;t leave a lead with no next step.</b> A lead with no date gets forgotten.</span></li>
                <li className="flex gap-2"><span>❌</span><span><b>Don&apos;t write &ldquo;will call later.&rdquo;</b> It tells the next person nothing.</span></li>
                <li className="flex gap-2"><span>❌</span><span><b>Don&apos;t skip the easy calls</b> just to feel busy. Work top-down.</span></li>
                <li className="flex gap-2"><span>❌</span><span><b>Don&apos;t forget to punch in.</b> No attendance, no leads coming your way.</span></li>
              </ul>
            </div>
          </div>
        </section>

        {/* ─────────── Keyboard shortcuts ─────────── */}
        <section id="shortcuts" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-1">⌨ Keyboard shortcuts</h2>
          <p className="text-sm text-gray-600 mb-3">
            On a computer? These make you faster. On a phone? You can skip this — just tap the buttons.
            Press <Kbd>?</Kbd> anywhere to pop open this same cheatsheet.
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

        {/* ─────────── FAQ ─────────── */}
        <section id="faq" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">❓ FAQ — common questions</h2>
          <div className="divide-y divide-gray-100 -mx-2">
            <Faq q="I forgot to set a follow-up date. What now?">
              <p>
                No panic — just open the lead and set one now. The earlier the better, so it pops back onto
                your Action List on the right day. Make &ldquo;always set a date&rdquo; your habit and you&apos;ll
                rarely need to fix this.
              </p>
            </Faq>

            <Faq q="What makes a good remark?">
              <p>
                Capture the real picture: <i>budget</i>, <i>what they want</i> (size, area, project), <i>when</i> they
                want it, and <i>who decides</i>. Example: <i>&ldquo;Budget 2.5 Cr, 3BHK Dubai Marina, wants possession
                in 3 months, wife decides.&rdquo;</i> Avoid empty notes like &ldquo;will call later&rdquo; — they help no one.
              </p>
            </Faq>

            <Faq q="Why can't I see everyone's leads — only mine?">
              <p>
                You see the leads assigned to <b>you</b> so your list stays focused and client data stays safe.
                If you need a particular lead moved to you, just ask Lalit and he&apos;ll reassign it.
              </p>
            </Faq>

            <Faq q="What does 'Connected' vs 'Not picked' mean?">
              <p>
                <b>Connected</b> = you actually spoke to the person. <b>Not picked</b> = it rang but no one
                answered. Pick the one that&apos;s true — it keeps your numbers honest and your follow-ups sensible.
              </p>
            </Faq>

            <Faq q="What's the difference between a cold lead and a new lead?">
              <p>
                A <b>new</b> lead is fresh — nobody has called them yet. A <b>cold</b> lead is one that&apos;s gone
                quiet for a while with no recent activity. Cold leads gather in the <i>Revival Engine</i> so you
                can call and bring them back to life.
              </p>
            </Faq>

            <Faq q="Can I undo a stage change?">
              <p>
                Yes. Open the lead, tap the stage chip, and pick the right stage. Every change is saved with
                your name and the time, so nothing is ever lost. Just re-set it and carry on.
              </p>
            </Faq>

            <Faq q="Is the Vault watched or scored?">
              <p>
                The Vault is simply a space to journal, vent, log wins, and reset — a tool to keep your head
                clear during a tough day. Use it however helps you. There&apos;s no game or target attached to it;
                it&apos;s there for <i>you</i>.
              </p>
            </Faq>

            <Faq q="My push notifications aren't arriving.">
              <p>
                Usually one of three things: (1) you didn&apos;t tap <i>Allow</i> when the phone asked — turn it back
                on in Profile → Notifications; (2) battery-saver mode is blocking them; (3) you haven&apos;t added the
                CRM to your home screen yet. Adding it from <i>Add to Home Screen</i> makes notifications far more
                reliable. Still stuck? Ping Lalit.
              </p>
            </Faq>

            <Faq q="The app feels slow on my phone.">
              <p>
                Add the CRM to your home screen from your browser&apos;s <i>Add to Home Screen</i> menu and open it
                from there — it&apos;s noticeably faster than a browser tab. If a page looks stuck on old info, close
                and reopen it.
              </p>
            </Faq>
          </div>
        </section>

        {/* ─────────── Contact — hidden for AGENT ─────────── */}
        {!isAgent && <section id="contact" className="card p-5 scroll-mt-20">
          <h2 className="text-lg font-bold text-[#0b1a33] mb-3">📧 Need more help?</h2>
          <p className="text-sm text-gray-700">
            Stuck, confused, or something looks broken? That&apos;s totally normal on day one — and this CRM was
            built for <i>you</i>, so we want to hear it. Reach out and we&apos;ll sort it. 🙌
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
              For an urgent CRM problem, message Lalit directly on WhatsApp.
            </div>
          </div>
        </section>}
      </article>
    </div>
  );
}

/* ─────────────────────────── Helper components ─────────────────────────── */

/** Big numbered step inside the dark hero block. */
function HeroStep({
  n,
  emoji,
  title,
  children,
}: {
  n: number;
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex-none grid place-items-center w-8 h-8 rounded-full bg-white/15 text-white text-sm font-bold">
        {n}
      </span>
      <div className="text-white/90">
        <div className="text-sm font-semibold text-white">
          <span className="mr-1.5">{emoji}</span>
          {title}
        </div>
        <div className="text-sm text-white/80 mt-0.5">{children}</div>
      </div>
    </li>
  );
}

/** A friendly step row used inside the white cards. Large tap target, emoji-led. */
function StepRow({
  emoji,
  title,
  children,
  highlight = false,
}: {
  emoji: string;
  title: string;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <li
      className={`flex items-start gap-3 rounded-xl p-3 ${
        highlight ? "bg-amber-50 border border-amber-200" : "bg-[#fafafa] border border-gray-100"
      }`}
    >
      <span className="flex-none text-xl leading-none mt-0.5" aria-hidden>
        {emoji}
      </span>
      <div>
        <div className="text-sm font-semibold text-[#0b1a33]">{title}</div>
        <div className="text-sm text-gray-700 mt-0.5">{children}</div>
      </div>
    </li>
  );
}

/** Small square info tile, used in 2–3 column grids. */
function MiniCard({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-[#fafafa] border border-gray-100 p-3">
      <div className="text-2xl leading-none" aria-hidden>
        {emoji}
      </div>
      <div className="text-sm font-semibold text-[#0b1a33] mt-2">{title}</div>
      <div className="text-[13px] text-gray-700 mt-1 leading-relaxed">{children}</div>
    </div>
  );
}

/** A short bullet with a leading emoji. */
function BulletRow({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="flex-none text-base leading-none mt-0.5" aria-hidden>
        {emoji}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Soft yellow "tip" note used to close out a section. */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#fdfaf2] border border-[#e9d8a6] p-3">
      <span className="flex-none text-base leading-none mt-0.5" aria-hidden>💡</span>
      <p className="text-[13px] text-[#856404] leading-relaxed">{children}</p>
    </div>
  );
}

/** Bigger, friendly emphasis box for the single most important habit. */
function Callout({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
      <div className="text-sm font-bold text-emerald-800">
        <span className="mr-1.5" aria-hidden>{emoji}</span>
        {title}
      </div>
      <p className="text-sm text-emerald-900 mt-1 leading-relaxed">{children}</p>
    </div>
  );
}

/** A single pipeline stage pill. */
function Stage({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fdfaf2] border border-[#e9d8a6] text-[#856404] px-3 py-1.5">
      <span aria-hidden>{emoji}</span>
      {children}
    </span>
  );
}

/** Small arrow separator between pipeline stages. */
function Arrow() {
  return (
    <span className="text-gray-300 text-sm" aria-hidden>
      →
    </span>
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
