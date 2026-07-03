// crmGuideKnowledge.ts — the knowledge base behind the in-app "Ask the CRM"
// intern Q&A box (src/app/(app)/guide/page.tsx).
//
// SANDBOX-ONLY LEARNING AID. This is a PURE, deterministic, OFFLINE knowledge
// base — NO LLM, no network, no prisma. The client island on /guide filters
// this array by matching the user's typed question against each entry's
// `keywords` (and the question text). Answers are hand-written from the real
// CRM behaviour so an intern gets an accurate, consistent explanation every
// time — the same input always yields the same output.
//
// HOW MATCHING WORKS (kept simple on purpose so it can't drift):
//   • The island lower-cases the query, splits it into word tokens.
//   • Each Q&A entry scores by how many of its `keywords` appear as substrings
//     of the query (plus a small boost when the query words also hit the
//     question text). Highest score wins; ties fall back to array order.
//   • `matchQuestion()` below is the single scoring function — exported so the
//     island and any test use EXACTLY the same logic (no divergence).
//
// To add a Q&A: append an object. Keep `keywords` lower-case, include the
// obvious synonyms an intern would type. Keep answers plain-English, no jargon.

export interface CrmQa {
  /** Stable id — used as the React key and anchor. */
  id: string;
  /** The canonical question, shown as the card title. */
  question: string;
  /** Plain-English answer. Short paragraphs; an intern's first week. */
  answer: string;
  /** Lower-case match terms + synonyms. Order doesn't matter. */
  keywords: string[];
  /** Optional grouping label shown as a small pill on the answer card. */
  topic?: string;
}

// ── The knowledge base ──────────────────────────────────────────────────────
// Ordered roughly from "first things an intern asks" downward. Order also acts
// as the deterministic tie-breaker in matchQuestion().
export const CRM_KNOWLEDGE: CrmQa[] = [
  {
    id: "what-is-a-lead",
    question: "What is a Lead?",
    answer:
      "A Lead is simply a person who might buy a property. Every Lead has a name, phone, budget, what they're looking for, and a history of every call and note. Your job is to work your Leads: call them, log what happened, and set the next follow-up date. Leads you own show up on your Action List in priority order.",
    keywords: ["lead", "what is a lead", "leads", "contact", "prospect"],
    topic: "Lead Module",
  },
  {
    id: "what-is-fresh-lead",
    question: "What is a Fresh Lead?",
    answer:
      "A Fresh Lead is a BRAND-NEW person in the active Leads pipeline that nobody has worked yet — no call logged, no note, no WhatsApp. \"Fresh\" means two things together: it arrived in YOUR queue today (assigned today), and it's still untouched. The moment you log a call, note, or WhatsApp, it stops being fresh. Important: Fresh Lead applies ONLY to new entries in the active Leads section (website, capture form, or a manual New-Lead). It never applies to Buyer Data, Master Data, Revival/Cold, or any bulk-imported old database. Fresh leads sort to the very top of your list so you contact them while they're hot.",
    keywords: ["fresh", "fresh lead", "untouched", "new lead", "assigned today", "hot", "brand new"],
    topic: "Lead Module",
  },
  {
    id: "what-is-bant",
    question: "What is BANT?",
    answer:
      "BANT is a simple checklist for how well you know a buyer. It stands for Budget (how much they can spend), Authority (are they the decision-maker), Need (what they actually want — size, area, project), and Timeline (when they plan to buy). The lead page shows a small \"N/4\" pill telling you how many of the four you've captured. BANT is informational only — it NEVER blocks you from moving a lead. It's just a nudge to have a complete picture. Fill it in from what the client tells you on the call.",
    keywords: ["bant", "budget", "authority", "need", "timeline", "qualification", "qualify", "n/4"],
    topic: "BANT",
  },
  {
    id: "after-followup",
    question: "What happens after a follow-up?",
    answer:
      "When you finish (Complete) a follow-up, the CRM automatically sets the NEXT follow-up to one day later, at the same time of day — so the lead never falls off your radar. A follow-up is never left blank. If a follow-up becomes overdue (the day passed and you didn't action it), an evening reminder job rolls it forward to the next day so it reappears on your Action List instead of vanishing. The golden rule: every lead always leaves with a next follow-up date.",
    keywords: ["follow-up", "followup", "follow up", "after a follow", "next follow", "rollover", "overdue", "reminder", "complete"],
    topic: "Follow-up",
  },
  {
    id: "when-convert-lead",
    question: "When should I convert a lead?",
    answer:
      "You \"convert\" a record from a staging bank (Buyer Data or Cold/Revival) into a real, live Lead when the person shows genuine interest and is worth active follow-up — for example they picked up, they're interested, and there's a real conversation to pursue. Before conversion, records in those banks are just a staging area: same detail screen, but the full lead workflow stays hidden until you Convert. Converting promotes the record into the active Leads pipeline so it appears on your Action List, gets follow-up dates, and counts as an active lead. Don't convert dead or wrong-number records — reject those instead.",
    keywords: ["convert", "conversion", "when convert", "promote", "make a lead", "staging"],
    topic: "Lead Module",
  },
  {
    id: "what-is-buyer-data",
    question: "What is Buyer Data?",
    answer:
      "Buyer Data is a staging bank of potential buyers (with details like budget and, for Dubai, richer buyer info). It is NOT the active Leads list yet — it's a pool you work through to find the good ones. There are two market versions: Dubai Buyer Data (AED) and India Buyer Data (INR/Cr). Records start in the Admin Pool, get assigned to an agent, and you either Convert a good one into a live Lead or Reject a dead one. It uses the SAME detail screen as a Lead, but the lead-only workflow stays hidden until you convert.",
    keywords: ["buyer", "buyer data", "buyer bank", "dubai buyer", "india buyer", "buyers", "staging bank"],
    topic: "Buyer Data",
  },
  {
    id: "what-is-admin-pool",
    question: "What is the Admin Pool?",
    answer:
      "The Admin Pool is the unassigned holding area for Buyer Data records — buyers that exist in the system but haven't been given to a specific agent yet. An admin (or the distribution logic) assigns pool records to agents to work. Each record tracks how many times it's been attempted (attemptCount). If an assigned buyer is attempted several times without success (auto-return at 5 attempts), it returns to the Admin Pool so it can be redistributed rather than sitting dead with one agent. Think of it as: Admin Pool → assigned to agent → convert / reject / (return to pool).",
    keywords: ["admin pool", "pool", "unassigned", "distribution", "assign", "attempt", "poolstatus", "return"],
    topic: "Buyer Data",
  },
  {
    id: "what-is-master-data",
    question: "What is Master Data?",
    answer:
      "Master Data is the admin-only control room for all sales leads — an Excel-style grid where you can filter, sort, inline-edit, and bulk-assign leads across category tabs (workable, closed/won, lost/rejected, and soft-deleted records you can restore). It's a staging and routing hub, not your daily to-do list, and it's admin-only. Cold-call records live in the Revival Engine, not here. As an intern you'll rarely touch it — your day-to-day working happens on the Action List and Leads.",
    keywords: ["master data", "master", "archive", "grid", "database", "lookup", "bulk assign", "admin only"],
    topic: "Master Data",
  },
  {
    id: "what-is-revival-engine",
    question: "What is the Revival Engine?",
    answer:
      "The Revival Engine (also called Cold Calls) is where old, gone-quiet leads are gathered so you can bring them back to life. These are people who were contacted before but went silent — they're not dead, they were just forgotten. You open the Revival Engine, read the old notes first, call to re-open the conversation, and log the outcome like any other call. If there's a spark of interest, set a follow-up and pull them back into your active pipeline. Old leads are gold nobody else is digging for.",
    keywords: ["revival", "revival engine", "cold call", "cold calls", "revive", "old lead", "reactivate", "gone quiet"],
    topic: "Revival Engine",
  },
  {
    id: "cold-vs-revival",
    question: "Cold vs Revival — what's the difference?",
    answer:
      "They're two sides of the same thing. The Cold data bank is the raw staging pool of old / dormant records (bulk-imported or aged-out leads) — a bank you haven't actively worked yet, like Buyer Data. The Revival Engine (which runs on the Cold Calls screen) is the workspace where you actually work those cold records: read history, call, and revive the promising ones. \"Promote to Lead\" moves a revived record into the active Leads pipeline. So: Cold = the pool of quiet records; Revival = the screen where you bring them back. Both live under the Revival Engine / Cold Calls section.",
    keywords: ["cold vs revival", "cold or revival", "difference", "cold", "revival", "cold data", "revive"],
    topic: "Revival Engine",
  },
  {
    id: "cold-vs-new",
    question: "What's the difference between a cold lead and a new lead?",
    answer:
      "A NEW lead is fresh — they just came in (website, form, or manual entry) and nobody has called them yet. A COLD lead is one that was contacted before but has gone quiet for a while with no recent activity. New leads land in your active Leads list and Action List; cold leads gather in the Revival Engine so you can call and bring them back. New = never touched; Cold = touched once, then went silent.",
    keywords: ["cold lead", "new lead", "cold vs new", "difference new cold", "fresh vs cold"],
    topic: "Lead Module",
  },
  {
    id: "meetings-site-visits",
    question: "What about Meetings and Site Visits?",
    answer:
      "A Meeting or Site Visit is an activity you log against a lead when you meet the client or take them to see a property. Log it so it appears in the lead's timeline and everyone knows it happened. Important rule: a meeting or site visit NEVER closes or wins a lead by itself — only an actual booking/sale marks a lead as Won/Closed. You'll get reminders before scheduled meetings so you don't miss them. After a visit, log the outcome and set the next follow-up.",
    keywords: ["meeting", "meetings", "site visit", "visit", "appointment", "viewing", "reminder"],
    topic: "Meetings & Site Visits",
  },
  {
    id: "won-closed",
    question: "When is a lead Won or Closed?",
    answer:
      "A lead is only Won/Closed when a real deal happens — the property is booked, sold, or leased. Nothing else closes a lead: not a meeting, not a site visit, not a good call. Statuses fall into three buckets — Workable (still in play), Closed (booked/sold/leased = won), and Lost (dead / not interested). Keep statuses honest; it's how your real wins get counted in Reports.",
    keywords: ["won", "closed", "close a lead", "booked", "sold", "leased", "deal", "win"],
    topic: "Lead Module",
  },
  {
    id: "what-are-reports",
    question: "What do Reports show me?",
    answer:
      "Reports turn your effort into plain numbers — you don't build anything, you just read them. They cover your daily summary (calls made, calls connected, leads moved, follow-ups due tomorrow), your targets vs. actuals, and your progress over time. There's also a Fresh Leads report that tracks new untouched leads in the active pipeline. Agents see their own numbers; managers and admins see the team. Peek near end of day — a couple more calls might hit your target.",
    keywords: ["report", "reports", "numbers", "daily summary", "target", "performance", "fresh leads report", "stats"],
    topic: "Reports",
  },
  {
    id: "what-is-ai",
    question: "What does the AI section do?",
    answer:
      "The AI area is a CRM assistant with a chat interface (\"Ask AI\") that can answer questions about the pipeline, suggest next actions, and draft follow-up messages. Admins run it in either Demo mode (rule-based, no external calls) or Live mode (real calls to an AI provider like Gemini), and it also powers optional features like round-robin lead distribution and lead scoring. As an intern you mostly rely on your Action List and follow-up dates. When AI suggestions appear, treat them as help, not orders — a human always decides and approves before anything changes.",
    keywords: ["ai", "artificial intelligence", "ask ai", "war room", "assistant", "recommended", "smart"],
    topic: "AI",
  },
  {
    id: "notifications",
    question: "How do Notifications work?",
    answer:
      "The CRM can send you web push notifications (on your phone/desktop) plus an in-app sound when something needs you — like a new lead assigned, a follow-up due, or a meeting reminder. To get push reliably, tap \"Allow\" when your phone asks and add the CRM to your home screen. You can control which notifications you get and pick your sound and volume in Profile → Notifications. If nothing arrives, it's usually a blocked permission or battery-saver mode.",
    keywords: ["notification", "notifications", "push", "sound", "alert", "reminder", "notify", "bell"],
    topic: "Notifications",
  },
  {
    id: "rejected-lead",
    question: "What happens when a lead is rejected?",
    answer:
      "Rejecting a lead marks it as not worth active pursuit (wrong number, not interested, junk) and takes it off the active board — but it does NOT delete anything. The conversation, voice notes, timeline, and BANT are all preserved, and the record remembers who owned it. It gets unassigned so it's out of your queue. If a rejected lead needs to come back, an admin reactivates it first, then reassigns it. So rejection is reversible and safe — nothing is ever lost.",
    keywords: ["reject", "rejected", "rejection", "junk", "not interested", "wrong number", "remove", "reactivate"],
    topic: "Lead Module",
  },
  {
    id: "settings",
    question: "What is in Settings?",
    answer:
      "Settings is where admins configure the CRM — automation controls, projects, teams, intake keys, and system options. As an intern or agent you mostly won't need it; your daily work lives in Leads, the Action List, and the Revival Engine. My Profile (separate from Settings) is where YOU set your photo, notification sounds, and personal preferences.",
    keywords: ["setting", "settings", "config", "configure", "admin settings", "automation", "profile"],
    topic: "Settings",
  },
  {
    id: "good-remark",
    question: "What makes a good remark?",
    answer:
      "A good remark captures the REAL situation in a sentence or two: budget, what they want (size, area, project), when they want it, and who decides. Example: \"Budget 2.5 Cr, wants 3BHK in Dubai Marina, ready in 2 months, wife decides.\" Avoid empty notes like \"will call later\" — they tell the next person nothing. You can speak your remark instead of typing: tap the mic and talk in Hindi or English. Specific remark + a follow-up date on every lead is the habit of a top performer.",
    keywords: ["remark", "note", "notes", "good remark", "write", "comment", "log", "what to write"],
    topic: "Lead Module",
  },
  {
    id: "action-list",
    question: "What is the Action List?",
    answer:
      "The Action List is your to-do list for the day — the CRM has already sorted the people you should call, best one on top. You don't decide who to call; you just work top-down. Fresh, hottest, most ready-to-buy leads sit at the top. Clear it daily — an empty Action List is a great day. Don't cherry-pick the easy ones; the person at the top is there for a reason.",
    keywords: ["action list", "action", "to do", "todo", "to-do", "daily list", "queue", "tasks"],
    topic: "Lead Module",
  },
  {
    id: "market-india-dubai",
    question: "What's the difference between India and Dubai leads?",
    answer:
      "The CRM serves two markets: India (Gurgaon team, prices in INR / Crores) and Dubai/UAE (Dubai team, prices in AED). A lead's Market decides which currency shows, which buyer categories apply, and — for some modules like Buyer Data — which team can see it. India agents see India work, Dubai agents see Dubai work, and admins see both. Never mix or convert currencies between the two.",
    keywords: ["india", "dubai", "uae", "market", "currency", "aed", "inr", "team", "gurgaon"],
    topic: "Lead Module",
  },
];

// ── Matching (the ONE scoring function; island + tests share it) ─────────────

/** Split a string into lower-case word tokens (letters/digits), dropping noise. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1);
}

/**
 * Score how well a Q&A entry answers `query`. Higher = better.
 *  • +2 for every keyword phrase that appears as a substring of the query.
 *  • +1 for every query token that also appears in the question text.
 * Deterministic and pure — no Date/Math.random/network.
 */
export function scoreQa(qa: CrmQa, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  let score = 0;
  for (const kw of qa.keywords) {
    if (q.includes(kw.toLowerCase())) score += 2;
  }
  const qTokens = new Set(tokenize(qa.question));
  for (const t of tokenize(query)) {
    if (qTokens.has(t)) score += 1;
  }
  return score;
}

/**
 * Return the Q&A entries that match `query`, best first. Entries scoring 0 are
 * dropped. Ties keep original array order (stable). `limit` caps the results.
 */
export function matchQuestion(query: string, limit = 4): CrmQa[] {
  const scored = CRM_KNOWLEDGE.map((qa, i) => ({ qa, i, score: scoreQa(qa, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.i - b.i));
  return scored.slice(0, limit).map((x) => x.qa);
}

/** Suggested starter questions shown as clickable chips in the Q&A box. */
export const SUGGESTED_QUESTIONS: string[] = [
  "What is Revival Engine?",
  "What is Master Data?",
  "When should I convert a lead?",
  "What is BANT?",
  "What happens after a follow-up?",
  "What is Fresh Lead?",
  "Cold vs Revival?",
  "What is the Admin Pool?",
];
