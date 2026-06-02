# Quality Score — Specification (PROPOSAL, not yet built)

**Status:** Draft for Lalit review. No code written. Author: Agent L, 2026-06-02.

Lalit's question (verbatim): *"How is quality defined — hour, dates, month, week."*

The CRM already tracks **quantity** (call counts, lead counts, XP) and a thin
slice of **outcome** (won/lost). "Quality" is the missing third axis — *was
the work done well*, not just *was it done*. This spec proposes four candidate
definitions, a composite formula combining them, the time windows it surfaces
over, and where it should appear in the UI.

---

## 1. What "quality" could mean — four axes

Each axis is independently measurable from data we already store. They answer
different managerial questions; combining all four gives a balanced score that
can't be gamed by maxing one dimension.

### Axis A — Activity quality (*how well did they execute calls?*)
Source: `CallLog`, `Activity`.

| Metric | Formula | Why it matters |
|---|---|---|
| Connect rate | `CONNECTED / total_calls` | Are they reaching humans, or burning the dialer? |
| Avg connected-call duration | `avg(durationSec)` filtered by `outcome=CONNECTED` | Sub-30s connects ≈ wrong number / hang-up; long connects ≈ real conversation |
| Interested-outcome rate | `INTERESTED / CONNECTED` | Of conversations they had, how many landed |
| Notes-per-connected-call ratio | `count(Note) / CONNECTED` (lead-joined) | Are they capturing context after the call |

### Axis B — Funnel quality (*are their leads converting?*)
Source: `Lead.status` transitions, `Activity` type=SITE_VISIT/BOOKING.

| Metric | Formula | Why |
|---|---|---|
| Qualified-from-contacted | `QUALIFIED_or_better / CONTACTED_or_better` | Are they pushing tyre-kickers along or filtering them out? |
| Site-visit-to-booking | `BOOKING_DONE / SITE_VISIT_completed` | Once they get them on a visit, do they close |
| Avg time-to-first-call (mins) | `min(CallLog.startedAt) − Lead.createdAt` | Speed of response, the #1 conversion predictor |
| Avg deal value (won) | `sum(budgetMin where status=WON) / count` | Are they closing premium deals or only entry-level |

### Axis C — Behavioural quality (*are they doing what they said they'd do?*)
Source: `Activity` (planned vs. completed), `isNoShow`, `rescheduledCount`.

| Metric | Formula | Why |
|---|---|---|
| Follow-up adherence | `Activity{status=DONE} / Activity{status=PLANNED + past}` | Did they keep their commitments |
| No-show rate | `count(isNoShow=true) / total visits` | Shows up to their own bookings |
| Reschedule rate | `avg(rescheduledCount)` | High = chronic over-promising |
| Response-SLA breach % | `% of new HOT leads where first call > 30min after createdAt` | Hot-lead handling |

### Axis D — Wellbeing quality (*are they sustainable?*)
Source: `Attendance`, `AttendanceLog`, `DailyMood`, streak fields on `User`.

| Metric | Formula | Why |
|---|---|---|
| Attendance regularity | `PRESENT_or_LATE_days / working_days_in_window` | Showing up |
| On-time rate | `PRESENT / (PRESENT + LATE)` | Punctuality |
| Mood trend | `avg(mood) last 7d vs prior 7d` (Mood enum mapped to 1-5) | Catching burnout before it costs deals |
| Streak preservation | `1 if no streak break in window else 0` | Continuity discipline |

---

## 2. Proposed composite formula

Each axis is normalised to **0–100** using the team-wide P10–P90 of the metric
over the previous 30 days as the floor/ceiling (so a "perfect score" tracks the
top-decile performer, not a theoretical max — keeps it meaningful as the team
grows).

```
QualityScore = 0.30·A  +  0.35·B  +  0.25·C  +  0.10·D
```

Weights rationale:
- **B (funnel) = 35%** — the only axis directly tied to revenue.
- **A (activity) = 30%** — what they do every hour.
- **C (behavioural) = 25%** — Lalit's persistent pain point ("commitments missed").
- **D (wellbeing) = 10%** — a tilt, not a driver. Heavily weighting mood risks
  rewarding low-effort cheerful agents over high-effort grinders. 10% nudges
  managers to notice an agent slipping before the slip becomes a number drop.

A score of **70** means "consistently above team median on every axis". **85+**
is exceptional. Below **50** triggers a coaching flag on the manager 1-on-1
report.

---

## 3. Time windows

The same formula should be computable over different lenses — Lalit's question
("hour, dates, month, week") points at exactly this.

| Window | Use case | Notes |
|---|---|---|
| **Today** | Real-time agent self-check on the dashboard | A/C only — funnel needs more time |
| **Rolling 7 days** | "How's the week going" — weekly 1-on-1s | Default for most surfaces |
| **Rolling 30 days** | Monthly review, performance reviews | Smooths out one-off bad days |
| **Calendar month** | Reconcile with target-setting cycle | Reset at month-start so monthly target windows align |
| **Quarter** | Promotion / probation decisions | Long enough for funnel C+D to settle |
| **All-time** | Career stat, badge eligibility | Read-only |

Recommendation: ship **Today, 7d, 30d** in v1. Add quarter once the team
crosses the 90-day mark using the system.

---

## 4. Where it surfaces (UI placement proposal)

| Page | What appears | Who sees it |
|---|---|---|
| `/dashboard` PersonalScoreboard | Single 0-100 score, rolling 7d, axis bars on tap | Agent themselves |
| `/admin/team` (proposed comparison page) | Sortable table — name, score, 4 axis sub-scores, 7d Δ | Admin + Manager |
| `/manager/1-on-1/[agentId]` (proposed) | 30d score + trend chart + coaching flags | Manager only |
| Daily digest email | Top 3 + bottom 3 scores in the team scope | Admin + Manager |
| Lead detail page | Quality-bias warning if the *owner's* axis-B score < 40 (suggests reassignment) | Admin + Manager |

Do **not** show the axis-D (wellbeing) sub-score to anyone except the agent
themselves — surfacing "Sandeep's mood is dropping" on a manager dashboard
crosses a privacy line. Managers see it only as the (already-blended) composite.

---

## 5. Open questions for Lalit

Three things we need confirmed before building:

1. **Weight reality-check.** The proposed split is 30/35/25/10. Does that
   match how you'd intuitively rank an agent if you had to grade them today,
   or do you weight funnel-outcome closer to 50%?

2. **Penalty vs. floor.** When an agent has *zero* activity in an axis (e.g.
   brand-new agent, no booked deals yet), should that axis show as N/A and the
   composite weight redistribute? Or should it score zero and drag the total
   down? The former is fairer to new hires, the latter is harsher and pushes
   ramp-up speed.

3. **Comparison group.** Should an agent's quality score be benchmarked
   against (a) their own team only (Dubai vs India differ structurally), (b) the
   whole company, or (c) a "people at the same tenure as them" cohort? Affects
   both fairness and what a "good score" actually means.

---

## Appendix — schema fields this depends on

- `User.role`, `User.team`, `User.xp`, `User.followupStreak`, `User.coldCallStreak`, `User.dailyStreak`
- `Lead.status`, `Lead.createdAt`, `Lead.aiScore`, `Lead.budgetMin`, `Lead.budgetCurrency`, `Lead.ownerId`
- `Activity.type`, `Activity.status`, `Activity.scheduledAt`, `Activity.completedAt`, `Activity.isNoShow`, `Activity.rescheduledCount`, `Activity.attendedByUserId`
- `CallLog.outcome`, `CallLog.durationSec`, `CallLog.startedAt`, `CallLog.userId`, `CallLog.leadId`
- `Attendance.status`, `Attendance.date`
- `AttendanceLog.loginAt`, `AttendanceLog.userId`
- `DailyMood.mood`, `DailyMood.date`
- `Target.metric`, `Target.value`, `Target.period`, `Target.userId`, `Target.team`

No new tables needed. All four axes are derivable from existing columns.
