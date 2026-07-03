// crmScenarios.ts — content for "Scenario Mode" (src/app/(app)/scenarios/page.tsx).
//
// SANDBOX-ONLY LEARNING AID. Pure, exported, static data — no LLM, no prisma,
// no network. Each scenario is a guided, numbered walkthrough of a real CRM
// journey so an intern can rehearse "what do I click, what should I expect, and
// why" before doing it for real on the sandbox copy.
//
// Steps reference REAL CRM pages and actions (Action List, /leads, Revival
// Engine / Cold Calls, Buyer Data, follow-up dates, status changes, reject/
// reactivate) so the muscle memory transfers 1:1 to production.

export interface ScenarioStep {
  /** What to do — the action, in plain English. */
  action: string;
  /** What the intern should SEE / what happens as a result. */
  expect: string;
  /** Why it matters — the reasoning, so they learn the rule not just the click. */
  why?: string;
}

export interface Scenario {
  /** Stable id — React key + anchor. */
  id: string;
  /** Emoji shown on the scenario card. */
  emoji: string;
  /** Short title. */
  title: string;
  /** One-line "what you'll learn / the situation". */
  goal: string;
  /** Which CRM area this mostly touches — shown as a pill. */
  area: string;
  /** 5–10 ordered steps. */
  steps: ScenarioStep[];
}

export const CRM_SCENARIOS: Scenario[] = [
  // ── 1. New Website Lead ────────────────────────────────────────────────────
  {
    id: "new-website-lead",
    emoji: "🌐",
    title: "New Website Lead",
    goal: "A fresh lead just came in from the website. Learn how to spot it, make first contact, and set it up so it never gets forgotten.",
    area: "Lead Module",
    steps: [
      {
        action: "Open your Action List (or the Leads page) at the start of your shift.",
        expect: "A brand-new lead sits at the very TOP, often flagged as fresh / untouched and assigned to you today.",
        why: "Fresh leads (new, never-worked entries in the active pipeline) auto-sort to the top so you reach them while they're hot.",
      },
      {
        action: "Tap the lead to open it. Read the name, phone, budget, and the source before you dial.",
        expect: "You see it came from the website, plus whatever the form captured. There's no call history yet.",
        why: "Reading first means your opening line is relevant, not a cold generic pitch.",
      },
      {
        action: "Tap the Call button and speak to the client.",
        expect: "The dialer opens with their number filled in.",
        why: "Speed-to-lead wins deals — a website lead contacted in minutes beats one contacted hours later.",
      },
      {
        action: "After the call, tap the outcome that fits (Connected, Not picked, Interested, etc.).",
        expect: "The outcome is logged to the lead's timeline in one tap.",
        why: "If it isn't logged, it didn't happen — logging keeps your numbers and history honest.",
      },
      {
        action: "Write a specific remark (you can tap the mic and speak it in Hindi or English).",
        expect: "Your note is saved to the conversation. The lead stops counting as 'fresh/untouched'.",
        why: "A specific remark (budget, need, timeline, who decides) tells future-you exactly where things stand.",
      },
      {
        action: "Fill in any BANT details you learned (Budget, Authority, Need, Timeline).",
        expect: "The N/4 BANT pill on the lead goes up.",
        why: "BANT is informational — it never blocks you, but a fuller picture makes the next call sharper.",
      },
      {
        action: "Set the next follow-up date before you leave the lead.",
        expect: "The lead drops off today's list and reappears on your Action List on that date.",
        why: "The golden rule: every lead always leaves with a follow-up date, or it goes cold.",
      },
    ],
  },

  // ── 2. Expo Lead ───────────────────────────────────────────────────────────
  {
    id: "expo-lead",
    emoji: "🎪",
    title: "Expo Lead",
    goal: "A lead was captured at a property expo/event. Learn how event leads enter the CRM and how to work them fast while interest is warm.",
    area: "Lead Module",
    steps: [
      {
        action: "Find the new expo lead on your Action List / Leads page.",
        expect: "It appears as a fresh lead with a source that shows it came from an event/expo.",
        why: "Expo leads come in through the same intake as website leads, so they land in your active pipeline and get sorted to the top.",
      },
      {
        action: "Open it and check the source, city, and any project the person asked about.",
        expect: "You see the event context — which expo, and sometimes which project sparked interest.",
        why: "At an expo the person spoke to someone in person; referencing that makes your call feel like a continuation, not a cold call.",
      },
      {
        action: "Call them the SAME day, ideally within hours.",
        expect: "The dialer opens; you reconnect while the event is fresh in their mind.",
        why: "Expo interest fades fast. A quick call turns a business-card contact into a real conversation.",
      },
      {
        action: "Confirm what they're looking for and capture BANT (budget, need, timeline, decision-maker).",
        expect: "The BANT pill fills in; you now know if they're a serious buyer.",
        why: "Events attract a mix of serious buyers and browsers — BANT tells you who to prioritise.",
      },
      {
        action: "Log the outcome and write a specific remark.",
        expect: "The call and note are saved to the timeline.",
        why: "So the next follow-up (and anyone who picks this up) has the full picture.",
      },
      {
        action: "If they're interested, offer to send details on WhatsApp, then set a follow-up date.",
        expect: "WhatsApp opens with their number; the lead reappears on your list on the follow-up day.",
        why: "A warm expo lead + a set follow-up + collateral on WhatsApp is a strong start to the pipeline.",
      },
    ],
  },

  // ── 3. Revival Lead ────────────────────────────────────────────────────────
  {
    id: "revival-lead",
    emoji: "♻️",
    title: "Revival Lead",
    goal: "Bring an old, gone-quiet lead back to life from the Revival Engine (Cold Calls) and promote it if there's interest.",
    area: "Revival Engine",
    steps: [
      {
        action: "Open the Revival Engine (Cold Calls) from the menu.",
        expect: "A stack of old, dormant leads that have had no recent activity.",
        why: "These people aren't dead — they were contacted before and went quiet. They're gold nobody else is digging for.",
      },
      {
        action: "Pick a lead and READ the old notes/history first.",
        expect: "You see what was discussed before it went cold — budget, interest, last conversation.",
        why: "A warm 'Hi, following up on the Marina apartment we discussed' beats a cold pitch every time.",
      },
      {
        action: "Call to re-open the conversation. Use the quick outcome keys if you're on desktop.",
        expect: "The dialer opens; log the outcome (Connected, Not picked, Callback, Interested, Not interested).",
        why: "You're finding out what changed since they went quiet — situations move.",
      },
      {
        action: "Write a remark capturing what's different now.",
        expect: "The note saves to the lead's timeline.",
        why: "Whether they're back in the market or truly done, the next person needs to know.",
      },
      {
        action: "If there's a real spark, Promote the lead to the active Leads pipeline.",
        expect: "The record moves out of Cold and into your live Leads list.",
        why: "Promoting turns a revived contact into a real, followed-up lead so it gets worked properly.",
      },
      {
        action: "Set a follow-up date so it lands back on your Action List.",
        expect: "The revived lead now behaves like any active lead, with a next touchpoint scheduled.",
        why: "One revived lead can make your month — but only if you keep following up.",
      },
      {
        action: "If they're genuinely not interested, log that outcome and move on to the next cold record.",
        expect: "The lead is marked accordingly; you don't waste more time on a dead one.",
        why: "Revival is about finding the few winners in the pile quickly — don't over-invest in dead records.",
      },
    ],
  },

  // ── 4. Existing Investor ───────────────────────────────────────────────────
  {
    id: "existing-investor",
    emoji: "🏆",
    title: "Existing Investor",
    goal: "A person who has already bought with us shows up again. Learn to recognise a returning/existing client and handle them right.",
    area: "Identity & Lead Module",
    steps: [
      {
        action: "When a new lead comes in, check for a duplicate / previous-history flag on the lead.",
        expect: "The CRM surfaces that this phone/email already exists — a returning-client or previous-history banner.",
        why: "One real person can appear more than once. Spotting it avoids treating a loyal investor like a stranger.",
      },
      {
        action: "Open the record and review their past across the CRM (previous purchases, old conversations).",
        expect: "You see their history — what they bought, their budget range, past interests.",
        why: "An existing investor expects you to KNOW them. Reading their history first shows respect and builds trust.",
      },
      {
        action: "Call them acknowledging the relationship ('Good to reconnect, hope the last property is treating you well').",
        expect: "The dialer opens; you start warm, not cold.",
        why: "Returning investors are your highest-value, easiest-to-convert leads — treat the relationship as an asset.",
      },
      {
        action: "Capture their NEW requirement as fresh BANT (their budget/needs may have grown).",
        expect: "The BANT pill reflects the new deal, separate from the old one.",
        why: "A repeat investor's second purchase is often bigger — qualify the new need properly.",
      },
      {
        action: "Log the outcome and a remark that references the existing relationship.",
        expect: "The note joins their timeline alongside the older history.",
        why: "Keeps the whole relationship in one place so anyone can see they're a repeat client.",
      },
      {
        action: "Set a follow-up and, if needed, flag to your manager that this is an existing investor.",
        expect: "The lead is scheduled for follow-up; the relationship is visible to the team.",
        why: "High-value repeat clients deserve extra care and sometimes manager attention.",
      },
    ],
  },

  // ── 5. Rejected Lead ───────────────────────────────────────────────────────
  {
    id: "rejected-lead",
    emoji: "🚫",
    title: "Rejected Lead",
    goal: "Handle a lead that turns out to be junk / wrong number / not interested — safely, without losing any data.",
    area: "Lead Module",
    steps: [
      {
        action: "Work the lead normally first — call and confirm it really is dead (wrong number, not interested, junk).",
        expect: "You get a clear signal this lead isn't worth active pursuit.",
        why: "Reject only when you're sure. Don't reject a lead just because it's hard — a callback isn't a rejection.",
      },
      {
        action: "Log the call outcome and a remark explaining WHY (e.g. 'wrong number', 'bought elsewhere').",
        expect: "The reason is saved to the timeline before you reject.",
        why: "The reason matters if the lead is ever revisited — it explains the decision.",
      },
      {
        action: "Use the Reject action on the lead.",
        expect: "The lead comes OFF your active board and is unassigned from you.",
        why: "Rejecting clears dead weight from your queue so you focus on live opportunities.",
      },
      {
        action: "Notice what is preserved.",
        expect: "The conversation, voice notes, timeline, and BANT are all kept — nothing is deleted. The record remembers who owned it.",
        why: "Rejection is reversible and safe by design — you never lose history.",
      },
      {
        action: "If a rejected lead needs to come back later, an admin reactivates it FIRST.",
        expect: "The lead is taken off the terminal/rejected state so it can live again.",
        why: "Reactivate-before-reassign is the rule — you can't hand out a still-rejected lead.",
      },
      {
        action: "After reactivation, the lead can be reassigned and worked like normal.",
        expect: "It reappears in an active queue with its full old history intact.",
        why: "So a second chance starts with all the context, not a blank slate.",
      },
    ],
  },

  // ── 6. Site Visit to Closing ───────────────────────────────────────────────
  {
    id: "site-visit-to-closing",
    emoji: "🏠",
    title: "Site Visit to Closing",
    goal: "Take a warm lead from booking a site visit all the way to a booked deal — logging each step correctly.",
    area: "Meetings & Site Visits",
    steps: [
      {
        action: "On a qualified, interested lead, schedule a site visit and log it as an activity.",
        expect: "The site visit appears on the lead's timeline; you'll get a reminder before it.",
        why: "Logging the visit means the whole team sees the lead is progressing, and reminders stop you missing it.",
      },
      {
        action: "Move the lead's status forward to reflect the real stage (e.g. an evaluating / site-visit status).",
        expect: "The status chip updates; every change is saved with your name and time.",
        why: "Honest statuses show real progress and feed your performance reports.",
      },
      {
        action: "Do the site visit, then log the outcome and a remark on how it went.",
        expect: "The visit result is captured in the timeline.",
        why: "A site visit does NOT close a lead by itself — you still record what happened and what's next.",
      },
      {
        action: "Set the next follow-up (negotiation, paperwork, decision call).",
        expect: "The lead reappears on your Action List for the next step.",
        why: "The deal isn't done at the visit — the follow-up keeps momentum toward booking.",
      },
      {
        action: "Work the follow-ups until the client commits.",
        expect: "Each touchpoint is logged; the lead stays warm and on your radar.",
        why: "Consistent follow-up between the visit and the booking is what actually closes the deal.",
      },
      {
        action: "When the property is actually booked/sold/leased, set the status to the Won/Closed outcome.",
        expect: "The lead moves to the Closed (won) bucket and counts as a real win in Reports.",
        why: "ONLY a real booking closes a lead — this is the one step that marks a true win. Congratulations! 🎉",
      },
    ],
  },
];
