// ── Learning Mode — help content registry (SANDBOX ONLY) ─────────────────────
// Pure, framework-free content used by <HelpDot> to teach interns what each
// screen is for. Written in simple English (many readers are non-native), based
// on what the real pages actually do. This file has NO gating logic itself — it
// is only ever rendered by HelpDot, which is only mounted when
// NEXT_PUBLIC_SANDBOX === "1". Nothing here ships to production behaviour.
//
// Keep entries accurate: if a page changes meaningfully, update its topic here.

export interface HelpTopic {
  /** Human title shown in the popover header. */
  title: string;
  /** One or two plain sentences: what is this screen? */
  whatItIs: string;
  /** Why the company built it — the business reason. */
  whyItExists: string;
  /** When, in the daily workflow, an agent opens this screen. */
  whenUsed: string;
  /** The main buttons/controls on the page and what each does. */
  buttons: string[];
  /** Do-these things — good habits for this screen. */
  bestPractices: string[];
  /** Avoid-these things — the usual intern mistakes. */
  commonMistakes: string[];
}

export const helpContent: Record<string, HelpTopic> = {
  // ── LEADS ──────────────────────────────────────────────────────────────────
  leads: {
    title: "Leads",
    whatItIs:
      "This is your working list of active clients (leads). Each row is one person who is interested in buying property. By default the page opens on the leads that need action today or are overdue, sorted so today's fresh and untouched leads sit at the very top.",
    whyItExists:
      "A salesperson can have hundreds of leads. This screen makes sure the ones that need a call NOW are never lost under old ones, so no interested client is forgotten.",
    whenUsed:
      "Open it first thing every day to see who to call today, and come back after each call to update the lead and set the next follow-up.",
    buttons: [
      "Fresh Leads Today / Untouched Fresh (top badges) — click to see leads given to you today; 'Untouched' means you have not contacted them yet, so do these first.",
      "Search box — type a name, phone, email, or the property they asked about to find one lead fast.",
      "More Filters — narrow the list by status, team, source, project, budget, follow-up date and more.",
      "Follow-up chips (Today + Overdue / Today / Overdue / Future / All Active) — switch which time window of leads you are looking at.",
      "Status chips (Fresh Lead, Follow Up, Meeting, etc.) — show only leads at that stage.",
      "Call / WhatsApp (on each row) — start contacting the client straight from the list.",
      "Complete — mark today's follow-up done. You must log a contact attempt first, or the button stays disabled.",
      "Snooze — push the follow-up to a later date when you cannot act now.",
      "+ New Lead / Import — add a client by hand or bring in many at once (managers/admins only).",
    ],
    bestPractices: [
      "Clear your 'Today + Overdue' list every day — that is the whole point of the screen.",
      "Always set a next follow-up date after you talk to a client, so they come back to you on the right day.",
      "Use the search box instead of scrolling when a client calls you back.",
      "Do the 'Untouched Fresh' (red, pulsing) leads first — a fast first call wins deals.",
    ],
    commonMistakes: [
      "Leaving follow-ups overdue — overdue leads pile up and the client goes cold.",
      "Completing a follow-up without actually calling — the Complete button needs a real contact logged for a reason.",
      "Ignoring the fresh-lead badges at the top and only working old leads.",
      "Forgetting to set the next follow-up date, so the lead disappears from your daily view.",
    ],
  },

  // ── DASHBOARD ────────────────────────────────────────────────────────────────
  dashboard: {
    title: "Dashboard",
    whatItIs:
      "Your daily home screen. It shows what needs attention right now (fresh untouched leads, hot leads not yet contacted, overdue follow-ups, meetings and site visits today) plus your call and deal targets for the day.",
    whyItExists:
      "It answers one question the moment you log in: 'what should I do today?' Managers also use it to see the team's calls, meetings and pipeline at a glance.",
    whenUsed:
      "Open it at the start of the day (after marking 'I Am Here'), and glance at it through the day to track your targets.",
    buttons: [
      "I Am Here — mark yourself present for the day. Tap it once when you start.",
      "Field status buttons — tap when you leave for a meeting or site visit so your manager sees where you are.",
      "Attention tiles (Fresh untouched / Hot untouched / Overdue / Meeting-Visit stage / Cold revival) — each is a shortcut; click to open exactly those leads.",
      "Meetings / Site visits / Virtual meets tiles — open today's scheduled visits.",
      "Action List button — jump to the ready-to-close and overdue leads.",
      "Daily Performance cards — see Target vs Achieved vs Pending for calls, meetings, fresh clients and deals.",
      "Date and Team selectors (admin/manager) — change the day or switch between Dubai / India / All.",
      "Reminders panel (right side) — your next 7 days of meetings, site visits and callbacks.",
    ],
    bestPractices: [
      "Mark 'I Am Here' first — attendance and auto-assignment depend on it.",
      "Clear the red attention tiles before starting anything else.",
      "Use the tiles as your to-do list; they always match the real leads behind them.",
      "Check your Daily Performance through the day so you can catch up before it ends.",
    ],
    commonMistakes: [
      "Forgetting to mark 'I Am Here', so you miss new-lead assignments.",
      "Treating the numbers as read-only — they are clickable shortcuts to the actual work.",
      "Ignoring 'Hot untouched' leads — these are your best, most urgent clients.",
      "Not tapping field-status when leaving, so the manager cannot see you are on a visit.",
    ],
  },

  // ── BUYER DATA (Dubai) ───────────────────────────────────────────────────────
  "buyer-data": {
    title: "Dubai Buyer Data",
    whatItIs:
      "A pipeline of real Dubai property buyers built from past transaction records. Each row is a purchase (client, project, unit, value, nationality). It contains passport and financial data, so who can see it is tightly controlled.",
    whyItExists:
      "People who already bought in Dubai are the best prospects for the next deal. This turns that history into a worked calling pipeline: the admin holds records in a pool, assigns them to agents, and agents convert or reject them.",
    whenUsed:
      "Dubai-team agents use it to work through buyers assigned to them. Admins use it to distribute the pool and watch conversion.",
    buttons: [
      "Summary cards (Pool / Assigned / Converted / Rejected) — click to filter the table to that stage.",
      "Filters (owner, project, type, nationality, region, repeat, search) — narrow to the buyers you want.",
      "Admin Pool vs Assigned/All views — switch between unassigned records and worked ones.",
      "Assign / Transfer (admin/manager) — hand records to an agent or move them between agents.",
      "Import — bring in a new batch of buyer transaction data (admins).",
      "Export CSV / Excel — download the data you can see (admins).",
      "Row click — open one buyer's full detail to log calls and notes.",
    ],
    bestPractices: [
      "Work your assigned buyers regularly — after 5 failed attempts a record returns to the pool automatically.",
      "Log every attempt so the attempt count and follow-up stay accurate.",
      "Treat repeat buyers (owning several units) as high priority — they buy again.",
      "Keep passport and financial details private; this data is sensitive.",
    ],
    commonMistakes: [
      "Sitting on assigned records without calling — they get taken back into the pool.",
      "Expecting to see other agents' buyers — an agent only sees their own assigned records.",
      "Confusing Buyer Data with Leads — buyers are past purchasers, not new website enquiries.",
      "Exporting or sharing sensitive buyer data without permission.",
    ],
  },

  // ── COLD-CALLS (Revival Engine) ──────────────────────────────────────────────
  "cold-calls": {
    title: "Revival Engine (Cold Data)",
    whatItIs:
      "A pool of dormant / cold contacts that are NOT yet active leads. It uses the same table and tools as the Leads page, but the data is old contacts waiting to be revived. Turning one into a live lead is called 'Promote to Lead'.",
    whyItExists:
      "Old enquiries and dormant contacts still hold real deals. This screen lets the team call through them and pull the good ones back into the live pipeline instead of buying new leads.",
    whenUsed:
      "Use it during cold-calling time, or 'Start session' to call through cold contacts one after another.",
    buttons: [
      "Start session — begin a focused, one-by-one calling run through the cold list.",
      "Hidden Gems strip — high-value dormant leads (big budget or hot) worth calling first.",
      "Market tabs (All / India Revival / Dubai Revival) — split the cold data by market (admin/manager).",
      "Status chips + filters — same as Leads: narrow by status, source, owner, tags, date.",
      "Promote to Lead (row action) — move a cold contact into your live Leads pipeline.",
      "Call / WhatsApp — contact the cold client from the row.",
      "Import (admin) — load a new batch of cold data and assign it.",
    ],
    bestPractices: [
      "Call the Hidden Gems first — biggest budgets and hottest scores.",
      "Promote a contact the moment they show real interest, so they move to your daily Leads view.",
      "Log the call outcome every time, so stale contacts sort to the top for the next round.",
      "Use 'Start session' for speed when you have a block of cold-calling time.",
    ],
    commonMistakes: [
      "Working cold data as if it were live leads — until you Promote, it stays out of your main pipeline.",
      "Never promoting anyone — the goal is to convert dormant contacts into active deals.",
      "Skipping the Hidden Gems and calling in random order.",
      "Forgetting that agents only see cold data assigned to them.",
    ],
  },

  // ── MASTER DATA ──────────────────────────────────────────────────────────────
  "master-data": {
    title: "Master Data",
    whatItIs:
      "The admin operations console holding every sales lead in the company — active, closed, lost, deleted and archived. It is an Excel-style grid for assigning, routing and fixing lead records. (Admins only.)",
    whyItExists:
      "Someone needs one master view to assign unowned leads, classify which team should handle them, correct data, and find any record. This is that control room — separate from the everyday Leads screen and from Reports.",
    whenUsed:
      "Admins use it to clear the assignment queue, fix records, and look up any lead. It is not a daily agent screen.",
    buttons: [
      "Category tabs (All / Active-Workable / Closed / Lost / Deleted / Archived) — switch which bucket of records you see.",
      "'X unassigned' / 'X awaiting team' links — jump to leads that still need an owner or a team.",
      "Filters (same panel as Leads) — search and narrow by status, source, team, project, tags, date.",
      "Inline edit — change a record's fields directly in the grid.",
      "Bulk assign / reassign — give many leads to an agent at once.",
      "Import (Super Admin) — bring in a batch of leads with the mapping wizard.",
      "Export view — download exactly the filtered rows shown.",
      "Row click — open the full record.",
    ],
    bestPractices: [
      "Keep the 'unassigned' and 'awaiting team' counts low — every lead should have an owner and a team.",
      "Use filters before bulk actions so you act on the right set of records.",
      "Remember cold/revival leads live in the Revival Engine, not here.",
      "Prefer editing the source record over creating duplicates.",
    ],
    commonMistakes: [
      "Bulk-assigning without filtering first, and touching the wrong leads.",
      "Looking for cold-call leads here — they are in the Revival Engine.",
      "Deleting records instead of re-assigning or re-classifying them.",
      "Forgetting this is admin-only power — changes here affect the whole company.",
    ],
  },

  // ── REPORTS ──────────────────────────────────────────────────────────────────
  reports: {
    title: "Reports",
    whatItIs:
      "The analytics area. The top strip answers the three questions managers care about — how much revenue is coming, where deals are leaking in the funnel, and which deals are stuck — then there are charts and links to detailed reports (agent performance, daily, SLA, sources, and more).",
    whyItExists:
      "Numbers should drive decisions, not just sit there. Reports show where the team is winning and losing so managers can coach and agents can see their own performance.",
    whenUsed:
      "Managers open it to review team health and coach; agents open it to check their own daily numbers and performance.",
    buttons: [
      "Team selector (admin) — switch reports between Dubai, India and All.",
      "Decision cards (Forecasted revenue / Biggest funnel leak / Stalled deals) — click to drill into the leads behind each number.",
      "Conversion funnel — see how many leads sit at each stage.",
      "Report tiles (Agent Performance, Daily Report, SLA & Meetings, Follow-up Compliance, Fresh-Lead Response, Lead Sources, Leaderboard, and more) — open a focused report.",
      "Best time to call heatmap — the day-and-hour when calls connect best.",
      "CSV exports (Super Admin) — download raw leads or calls data.",
    ],
    bestPractices: [
      "Start with the three decision cards; they point straight to what needs action.",
      "Use the funnel-leak number to decide which stage to coach.",
      "Check the 'Best time to call' heatmap and schedule calls in the strong slots.",
      "Agents: use Daily Report and My Performance to hit your targets.",
    ],
    commonMistakes: [
      "Reading charts without acting — every card links to the leads you can fix.",
      "Comparing AED and INR money as one number — the reports keep currencies separate on purpose.",
      "Ignoring stalled deals — money stuck in a stage needs a push or a close.",
      "Agents expecting team data — agents see personal reports only.",
    ],
  },

  // ── LEAD DETAIL ──────────────────────────────────────────────────────────────
  "lead-detail": {
    title: "Lead Detail",
    whatItIs:
      "The full page for one client. It shows the client summary, the BANT verdict (Budget, Authority, Need, Timeline), the full conversation and call history, and every action you can take on that lead.",
    whyItExists:
      "This is where the real selling work is recorded. Everything about a client — what they want, what was said, what happens next — lives on one page so anyone can pick up the deal.",
    whenUsed:
      "Open it whenever you are about to call or message a client, and update it right after, so the next step and the notes are always current.",
    buttons: [
      "Call / WhatsApp — contact the client and auto-log the attempt.",
      "BANT chips (Budget / Authority / Need / Timeline) — click a value to fill in what you learned; this qualifies the lead.",
      "Conversation / Notes — write down what the client said. This is the single source of truth for the deal.",
      "Complete — mark today's follow-up done (needs a contact logged first).",
      "Snooze — move the follow-up to a later date.",
      "Escalate — flag the lead for your manager (Lalit) when you need help.",
      "Reject — remove the lead from your active list with a reason (it is preserved, not deleted).",
      "Status — set the lead's stage (Fresh Lead, Follow Up, Meeting, Site Visit, etc.).",
    ],
    bestPractices: [
      "Fill the BANT chips as you learn each answer — a fully qualified lead is easier to close.",
      "Write a clear note after every call so the next person understands the situation.",
      "Always set the next follow-up date and a correct status before you leave the lead.",
      "Use Escalate early when a deal needs manager help, instead of letting it stall.",
    ],
    commonMistakes: [
      "Calling but not writing a note — the history becomes useless to everyone else.",
      "Leaving BANT empty, so the lead looks cold and gets deprioritised.",
      "Rejecting a lead to clear it instead of snoozing — reject with a real reason only.",
      "Forgetting to update the status after a meeting or visit.",
    ],
  },

  // ── NOTIFICATIONS ────────────────────────────────────────────────────────────
  notifications: {
    title: "Notifications",
    whatItIs:
      "Your alert inbox. It lists things the system wants you to know — new leads assigned to you, overdue follow-ups, meeting reminders, manager messages and more. You can also choose which alerts, sounds and volumes you receive.",
    whyItExists:
      "Important events should reach you even when you are not looking at that screen. Notifications make sure you never miss a new lead, a callback, or a manager instruction.",
    whenUsed:
      "Check it through the day, and whenever the alert sound or a browser notification fires.",
    buttons: [
      "Notification settings card — turn each alert type on or off and pick a sound and volume.",
      "Test — play a sample notification to confirm sound works on your device.",
      "Mark all read — clear the unread highlight once you have seen them.",
      "Notification row — click to jump straight to the lead or page it is about.",
      "Snooze — hide a notification for a while; a footer shows how many are hidden.",
    ],
    bestPractices: [
      "Turn on notifications and test the sound once, so you actually hear new-lead alerts.",
      "Click an alert to go straight to the record instead of searching for it.",
      "Clear read notifications so unread ones stay meaningful.",
      "Install the app to your phone home screen so push alerts arrive reliably.",
    ],
    commonMistakes: [
      "Leaving notifications off and missing fresh leads and callbacks.",
      "Never testing the sound, then wondering why alerts are silent.",
      "Ignoring the inbox so real reminders get buried.",
      "Snoozing everything instead of acting on the alert.",
    ],
  },
};

/** Safe lookup — returns undefined for an unknown topic so callers can no-op. */
export function getHelpTopic(topic: string): HelpTopic | undefined {
  return helpContent[topic];
}
