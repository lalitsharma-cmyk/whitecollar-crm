# HR Dashboard UI/UX Redesign — Spec (Lalit, 2026-06-28)

Philosophy: same as Sales CRM — extremely simple, **action-driven**, for recruiters who only ever used Excel. NOT a reporting screen. Answers one question: **"What should this recruiter do right now?"** Every major action 1–2 clicks; minimal scrolling; clear icons, spacing, typography, consistent color coding.

1. **Remove duplicate widgets** — merge "Today's Calls"/"Calls Due Today"; merge "Pending Confirmations"/"Confirmations Pending". No duplicate KPIs anywhere.
2. **Action-oriented** — instantly show: who to call, overdue follow-ups, interviews today, unconfirmed, no-shows, no-next-action. Prioritize actions over stats.
3. **Top Action Center** — actionable KPIs only: Overdue Follow-Ups, Calls Due Today, Interviews Today, Pending Confirmations, No Next Action, No-Shows, Expected Joinings. Color: 🔴 urgent, 🟠 pending, 🟢 healthy, 🔵 info. KPIs clickable → filtered lists.
4. **"Who Should I Call Now?"** — PRIMARY section (like Sales Lead Queue). Card: Name, Position, Stage, Recruiter, Last Contact, Next Action. Quick actions: Call, WhatsApp, Voice Note, Schedule, Open.
5. **Today's Interviews** — card: Time, Name, Position, Type, Confirmation. Actions: Call, WhatsApp, Open, Mark Completed.
6. **Pending Confirmation** — scheduled-not-confirmed list. Actions: Call, WhatsApp, Confirm, Reschedule.
7. **No-Show Recovery** — queue: Candidate, Interview Date, Missed Reason. Actions: Call, WhatsApp, Reschedule.
8. **Expected Joinings** — Joining Date, Documents Pending, Recruiter, Reminder Status.
9. **Recent Activity** — latest 5–10 only.
10. **Leaderboard** — per recruiter: Calls Made, Follow-Ups Completed, Interviews Scheduled, Interviews Conducted, Offers Released, Candidates Joined (not just "Added").
11. **Calendar** — too big now: shrink / collapsible / side panel. Tasks > calendar visuals.
12. **Candidate cards** — quick actions: Call, WhatsApp, Voice Note, Schedule, Email, Resume, Open.
13. **KPIs** — New Candidates, Calls Due Today, Overdue Follow-Ups, Interviews Today, Pending Confirmations, No-Shows, Expected Joinings, No Next Action. No duplicates.
14. **AI Recruiter Assistant** — suggestions widget (rule-based, no LLM dependency): "Call X first (high priority)", "Y likely to ghost", "Z waiting 2 days", "salary discussion pending", "confirmation overdue".
15. **Daily Productivity** — Calls Target / Completed / Remaining; real-time.
16. **Recruitment Funnel** — New → Called → Interested → Interview Scheduled → Interview Completed → Offer Released → Joined.
17. **UX** — never feels like reporting; guides the recruiter's day naturally; near-zero training.

Scope/RBAC: all data scoped (Junior HR = own candidates only via hrActiveScopeWhere; Admin/Senior = all). Leaderboard only for reports-permitted roles. Reuse Sales design primitives + existing HR voice/quick-action components.
