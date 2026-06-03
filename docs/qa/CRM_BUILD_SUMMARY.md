# White Collar Realty CRM — Build Summary
**Prepared:** 4 June 2026 | **Commit:** d2056a4
**Purpose:** Full record of what was built, what is partially built, what is pending, and what to do next.

---

## PART 1: WHAT WAS BUILT (COMPLETE FEATURES)

### Core Infrastructure
- **Next.js 16.2.6** with App Router, server components, `export const dynamic = "force-dynamic"` on data-heavy pages
- **React 19.2.4** with concurrent rendering
- **Prisma 6.19.3** ORM with **Neon Postgres** (PostgreSQL)
- **NextAuth v5 (beta)** with Prisma adapter — session-based authentication
- **Tailwind CSS v4** for styling
- **Vercel** deployment with CI via `npm run push` (git push + deploy hook)
- **GitHub Actions** cron (`.github/workflows/cron.yml`) for sub-daily scheduled jobs
- **Vercel crons** (`vercel.json`) for daily/weekly jobs — 2 cron limit respected

### Authentication and Authorization
- Login / logout via NextAuth
- Role-based access: ADMIN, MANAGER, AGENT
- Team-scoped queries (Dubai / India / null)
- Role-scoped UI: nav links hidden by role in MobileShell.tsx
- Admin-only section (`adminOnly`, `managerOrAdmin`, `agentHidden` flags in nav config)

### Dashboard (/dashboard)
- Sales Command Center with date range filter (URL params `?from=&to=`)
- IST timezone throughout (UTC+5:30 offset applied to all date logic)
- Redirect to today's date on first load
- **TODAY section:** 4 urgent tiles (hot leads untouched, overdue follow-ups, site visits, calls today) + 5 scheduled tiles
- **UPCOMING section:** Follow-ups next 7 days, leads by status
- **TEAM PERFORMANCE section:** Team Scoreboard, Weekly Summary (with vs-last-week comparison)
- **ANALYTICS section:** 8 KPI tiles + By Salesperson table (raw SQL replacing 30 sub-queries)
- **Today's Mission** card: picks highest-priority single lead (NEGOTIATION/EOI first, then HOT untouched, then oldest overdue)
- Admin-only: team filter tabs (Dubai/India/All), Admin morning queue widget
- Agent-only: call target progress bar
- Attendance "I'm here" check-in widget (all roles)
- Morning greeting with current time

### Mobile Shell (MobileShell.tsx)
- Responsive layout: desktop sidebar (264px fixed) vs. mobile hamburger drawer + bottom nav
- Bottom navigation: Home, Leads, Revival, To Do, Properties
- Safe area insets: `env(safe-area-inset-top/bottom)` for iPhone notch
- Back button with `router.back()` + parent route fallback for PWA
- Scroll lock on drawer open (useBodyScrollLock)
- Global overlay components: QuickSearch, QuickAddLeadFab, KeyboardShortcutsHelp, XPToastHost, DealCelebrationHost, OnboardingTour, PWAInstallNudge
- PWA: manifest.ts configured, add-to-home-screen supported

### Leads Module (/leads, /leads/[id])
- Lead list with search, filter tabs (All, Today, Overdue, Hot, Site Visit, Negotiation, Unassigned, Dubai, India)
- Per-lead Call (tel://), WhatsApp (wa.me), Copy Phone buttons
- Kanban view and Archived view toggle
- Lead detail: BANT card, activity timeline, call log form, note/remark entry, sticky notes, AI summary panel, assignment, stage dropdown
- Lead creation form + Quick Add Lead FAB (global overlay)
- Stage change with confirmation dialog
- "Flag for Manager Review" / escalate action
- EOI workflow fields: eoiStage, eoiAmount, bookingFormStatus, kycStatus, commissionAmount, commissionStatus
- Property interests linking (LeadProperty, LeadProject models)

### Action List (/action-list)
- Three sections: Ready to Close (NEGOTIATION+EOI), Needs Attention (flagged), Follow-ups Overdue
- Per-card: Call button, WhatsApp button with pre-filled message, Mark Done, Snooze, Escalate, Full History link
- Admin view: all teams. Manager view: own team. Agent view: own leads.
- "Next step" and "Why you" rationale per lead

### Pipeline (/pipeline)
- Kanban view with columns per stage
- Lead cards with days-in-stage, AI score chip, budget, commission estimate, "at risk" badge
- Owner/Team/AI score filter dropdowns
- List view toggle
- Mobile note: drag disabled, tap to open lead

### Cold Calls / Revival Engine (/cold-calls)
- Daily progress bar and gamification mission card
- Start session flow: one cold lead at a time, log outcome, promote to lead
- Import cold data button
- Assign to agent button
- Revival leaderboard sidebar
- XP awards per call completed, per conversion

### Reports Suite (/reports/*)
- Reports home: 3 hero decision tiles, funnel visualization (text-based %), top projects table, call heatmap (7 days × 24 hours), 11 sub-report links
- /reports/leaderboard: agent performance table, rank medals
- /reports/activity: today's activity feed with CSV export
- /reports/commission: commission tracking by stage and agent
- /reports/daily: full daily summary
- /reports/sla: SLA violation tracking
- /reports/travel: travel reimbursement calculation
- /reports/team-comparison: Dubai vs India comparison
- /reports/sources: lead source analysis
- /reports/ytd: year-to-date performance
- /reports/cooling: leads going cold analysis
- CSV exports available on most reports

### Settings (/settings)
- Testing Mode toggle (master automation kill switch)
- Round-robin assignment toggle
- Speed-to-lead toggle
- BANT gate stage selector
- Travel rate (₹/km)
- Festival theme selector (10 festivals with visual themes)
- Calendar subscription URL (personal iCal export)
- Push notification test button
- Notification preferences (8 toggleable categories)
- AI Features toggle

### Admin Pages (/admin/*)
- /admin/users: user list (read-only, 7 users)
- /admin/templates: WhatsApp + Email templates (8 each), edit/create/delete, placeholder cheat sheet
- /admin/workflows: workflow builder with 9 starter templates, trigger/condition/action editor
- /admin/audit: audit log with action/user/entity/IP (all CRM actions logged)
- /admin/attendance: 14-day rolling grid with per-agent per-day status dropdowns
- /admin/vault: admin view of all vault entries, filterable by agent and kind
- /admin/health: system health check endpoint
- /admin/integrations: external integration management
- /admin/dedup: lead deduplication tool
- /admin/targets: per-agent monthly call/conversion targets
- /admin/imports: bulk import history
- /admin/ai-trial: AI trial mode management with cost cap
- /admin/awaiting-team: leads awaiting team assignment
- /admin/cron-health: cron job health dashboard
- /admin/quality: lead quality metrics
- /admin/rejected-leads: rejected/lost lead review
- /admin/site-visits: site visit tracking
- /admin/team-mood: team mood tracking (DailyMood model)

### WhatsApp Integration
- Pre-filled wa.me deep links on Action List, Lead list, Activity Board
- Message templates with {{name}}, {{agent}}, {{project}}, {{budget}} placeholders
- Log WhatsApp action in lead activity timeline

### Intake / Lead Import (/intake)
- Lead intake form for manual entry
- CSV bulk import with column mapping
- MIS data import support (attributedAgentName field for historical call attribution)

### Notifications
- Push notifications via Web Push API (web-push package)
- Push subscription management (per device)
- Notification bell icon in header with unread count
- /notifications page for full notification history
- Notification preferences per category

### Gamification
- XP system: points awarded for calls, conversions, streak maintenance
- Level system based on cumulative XP
- Streak tracking (daily activity streak)
- Badges for milestones
- XPToastHost: animated XP gain notifications
- DealCelebrationHost: celebration animation on deal close
- Revival Engine leaderboard
- Agent leaderboard in /reports/leaderboard

### Vault (/vault, /admin/vault)
- Private agent journal: JOURNAL, VENT, WIN, LESSON, GRATITUDE, DEAL_STORY, RESET
- Admin-only overview of all entries (searchable by agent and kind)
- Fully private to individual agents in their own view

### Attendance
- /admin/attendance: 14-day grid for all agents
- Auto-marking logic: PRESENT before 10:30am IST, LATE after (currently broken — see BUG-001)
- Manual status dropdowns: PRESENT, LATE, ABSENT, ON_LEAVE, WFH
- AttendanceLog model tracking exact login times

### AI Features (Trial Mode)
- AI lead scoring: HOT/WARM/COLD classification (0–100 numeric score)
- AI call summarization
- AI next-action suggestion
- AI extraction from remarks (budget, timeline, objections)
- AiTrialRun model with cost cap enforcement
- AI usage logging (AiUsageLog model)
- CustomerProfile and IntelligenceMatch models for property preference matching
- Currently OFF — requires Testing Mode to be OFF first

### API Routes (/api/*)
- /api/leads: CRUD for leads
- /api/call-logs: call log create/read + /api/call-logs/export CSV
- /api/reports/export: leads/calls CSV export
- /api/cron/*: scheduled job endpoints (attendance backfill, follow-up reminders, etc.)
- /api/push: push notification subscription management
- /api/me: current user profile
- /api/health: system health (commit hash, DB connectivity)
- /api/whatsapp: WhatsApp log creation
- /api/vault: vault entry CRUD
- /api/templates: template CRUD
- /api/workflows: workflow CRUD and trigger
- /api/intake: lead intake submission
- /api/cold-data: cold lead import and management
- /api/ai/*: AI scoring, summarization, extraction endpoints
- /api/calendar.ics: iCal feed for calendar subscription

### Maintenance Scripts (/scripts/*.ts)
An extensive library of one-off scripts for database operations:
- Backfill scripts: phone normalization, call attribution, India currency fix, remark reparsing
- Import scripts: read-mis.cjs (MIS call data reader), seed-templates.ts, seed-saved-filters.ts
- Admin tools: reset-admin-pw.ts, list-users.ts, inspect-users.ts, setup-real-users.ts
- Cleanup: cleanup-testing-data.ts, wipe-leads-only.ts, purge-orphans.ts, clean-prod.ts
- Testing: load-test.ts, smoke-new-queries.ts, test-db.ts
- Deployment: deploy.sh (git push + Vercel deploy hook trigger)

---

## PART 2: PARTIALLY BUILT (INCOMPLETE FEATURES)

### User Management
**Built:** /admin/users list view (read-only)
**Missing:** Invite User modal, Edit User (role, team, name), Deactivate User, Manager role promotion UI
**Impact:** Cannot add agents without developer database access

### Lead Detail Page Mobile Layout
**Built:** Full lead detail page (desktop)
**Missing:** Mobile-optimized layout (quick info card, expandable sections, Quick Log Call button)
**Impact:** Mobile agents face very long scroll to perform basic actions

### Cold Call Count
**Built:** Revival Engine session flow
**Missing:** Real-time count passed to "Start session" button — currently shows hardcoded 20
**Impact:** Misleading when cold data is 0

### Activity Type Filtering
**Built:** /activities page (Action Board)
**Missing:** `?type=CALL` and `?type=MEETING` query parameter handling
**Impact:** Dashboard links to filtered activity views that do not filter

### Server-Side Role Guards
**Built:** Frontend nav hiding by role
**Missing:** Server-side `requireRole()` on /reports/* routes
**Impact:** Agents can access reports via direct URL

### Attendance Auto-Marking
**Built:** AttendanceLog model, auto-attendance cron logic
**Missing:** Working — records not being written to Attendance table despite agent logins
**Impact:** 14 days of attendance data blank for all agents

---

## PART 3: NOT BUILT (CONFIRMED GAPS)

| Feature | Notes |
|---------|-------|
| /call-logs standalone page | 404. No browseable call log list page. |
| Invite/Edit/Deactivate user from UI | All user changes require direct DB access |
| Lead pagination | All leads load in one query — will crash at scale |
| Workflow automations | Engine built, zero configured |
| WhatsApp message preview modal | Message sends directly without in-CRM preview |
| Stage-specific mobile pipeline action | No "Move Stage" bottom sheet for mobile kanban |
| Commission summary report | commission fields exist in schema; no aggregated report |
| Site visit confirmation flow | No attended/no-show tracking, no auto stage advance |
| Bulk follow-up date setter | No bulk edit for follow-up dates |
| Stale lead cleanup tool | No UI for archiving 90+ day inactive leads |

---

## PART 4: EXTERNAL DEPENDENCIES AND INTEGRATIONS

| Service | Purpose | Status |
|---------|---------|--------|
| Neon Postgres | Primary database | Active — production |
| Vercel | Hosting, serverless functions, cron | Active — Hobby plan |
| GitHub Actions | Sub-daily cron jobs | Active (cron.yml) |
| NextAuth (beta) | Authentication sessions | Active |
| Web Push API | Push notifications | Built — not subscribed by agents |
| Anthropic Claude API | AI scoring, summarization | Built — feature OFF |
| WhatsApp | Deep links only (wa.me) — no API integration | Active |
| Google Calendar | iCal feed output only — no two-way sync | Active |
| Acefone | Call integration (API routes exist) | Status unknown |
| MIS (Google Sheets) | Historical call data imported via read-mis.cjs | Import complete |

---

## PART 5: TECH STACK REFERENCE

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js | 16.2.6 |
| UI Library | React | 19.2.4 |
| Language | TypeScript | ^5 |
| Styling | Tailwind CSS | ^4 |
| ORM | Prisma | 6.19.3 |
| Database | Neon Postgres | — |
| Auth | NextAuth | ^5.0.0-beta.31 |
| Forms | react-hook-form + zod | ^7 / ^4 |
| Charts | Recharts | ^3.8.1 |
| Icons | Lucide React | ^1.16.0 |
| Date handling | date-fns | ^4.3.0 |
| PDF generation | pdfkit | ^0.18.0 |
| CSV parsing | papaparse | ^5.5.3 |
| Excel | xlsx | ^0.18.5 |
| Push notifications | web-push | ^3.6.7 |
| AI SDK | @anthropic-ai/sdk | ^0.98.0 |
| Hosting | Vercel | Hobby plan |
| DB host | Neon | Free tier |

---

## PART 6: DATABASE SCHEMA HIGHLIGHTS

- **30+ Prisma models** across: users, leads, activities, call logs, templates, workflows, notifications, attendance, audit, vault, targets, AI models, properties
- **Lead model:** 80+ fields covering the full lifecycle from inquiry to EOI to booking
- **Key indexes on Lead:** status, source, ownerId, createdAt, eoiStage, forwardedTeam
- **Missing indexes for scale:** followupDate, isColdCall+lastTouchedAt, aiScore, needsManagerReview
- **Pipeline stages enum:** NEW, CONTACTED, QUALIFIED, SITE_VISIT, NEGOTIATION, EOI, BOOKING_DONE, WON, LOST
- **Activity types:** CALL, WHATSAPP, EMAIL, SITE_VISIT, OFFICE_MEETING, VIRTUAL_MEETING, HOME_VISIT, EXPO_MEETING, COLD_TO_LEAD (+ more)
- **FundReadiness enum:** includes MIS-imported values (IMMEDIATE_BUYER, SHORT_TERM_BUYER, etc.) alongside standard CRM values

---

## PART 7: DEPLOYMENT PROCESS

```
# Deploy to production:
npm run push  
# → git push origin main + triggers Vercel deploy hook

# Verify deployment:
curl https://crm.whitecollarrealty.com/api/health
# Response should include "commit": "d2056a4" (or current HEAD)

# Database migrations:
npx prisma migrate deploy  # Run pending migrations in production
```

**Cron setup:**
- Vercel crons (daily or less): defined in `vercel.json` — max 2, currently 2 used
- Sub-daily crons: defined in `.github/workflows/cron.yml` — hits `/api/cron/*` endpoints with `Authorization: Bearer $CRON_SECRET`

---

## PART 8: WHAT TO BUILD NEXT (ORDERED BY PRIORITY)

### Sprint 1 — Go-Live Prerequisites (1 week)
1. **Fix attendance auto-marking** — debug IST timezone in attendance cron/login hook
2. **Add /leads pagination** — cursor-based, 50 per page, Prisma `skip`/`take`
3. **Add server-side role guard to /reports/*** — session check + redirect for AGENT role
4. **Fix /activities ?type= filter** — read searchParams, apply Prisma where clause
5. **Fix "Needs Lalit" hardcode** — replace with `me.name` in dashboard/page.tsx
6. **Fix /admin/users breadcrumb** — change href to `/settings`
7. **Fix cold call session count** — pass real count to button
8. **Add role-based visibility to /settings** — hide admin sections from non-admins

### Sprint 2 — Team Operations (1–2 weeks)
9. **Build "Invite Agent" UI** — modal in /admin/users to create user with temp password
10. **Configure 3 starter workflows** — follow-up reminder, new lead assigned, 7-days-in-NEW alert
11. **Add missing database indexes** — followupDate, isColdCall, aiScore, needsManagerReview
12. **Archive stale test leads** — clean up 370–424 day pipeline artifacts
13. **Add date picker to /reports/activity** — today / yesterday / custom range

### Sprint 3 — Mobile Polish (2–3 weeks)
14. **Simplify /leads/[id] on mobile** — quick info card + expandable sections + sticky Log Call button
15. **Add "Change Stage" bottom sheet on pipeline mobile** — replaces drag for mobile agents
16. **Add column count strip to pipeline mobile** — stage count bar above kanban
17. **Add "Log Quick Call" bottom sheet** — 3-field minimum for fast mobile logging

### Sprint 4 — Scale Readiness (before 5,000+ leads)
18. **Upgrade Vercel plan** — Pro plan for 60s function timeout and better concurrency
19. **Enable Neon connection pooling** — pgBouncer or Prisma Accelerate
20. **Add Redis/KV cache for dashboard counts** — 60-second TTL for KPI tiles
21. **Implement streaming CSV export** — chunked response for large datasets

---

## PART 9: WHAT NOT TO BUILD YET

| Feature | Reason |
|---------|--------|
| Full offline mode / Service Worker | Complexity > benefit for current team size and locations |
| Two-way Google Calendar sync | Requires OAuth scopes; not worth the security surface area yet |
| Email sending from CRM | WhatsApp is the primary channel; email volume does not justify the build |
| WhatsApp Business API (real messages) | Current wa.me deep link approach is sufficient and simpler |
| GPS-based travel tracking | Manual entry is accurate enough at current team size |
| Org chart visualization | Not needed until 15+ agents |
| Customer portal (client-facing) | Out of scope for a sales ops tool |
| AI features (production rollout) | Trial mode is ready — test with 1 agent first before wider rollout |

---

## PART 10: FUTURE ROADMAP (6–18 MONTHS)

| Phase | Feature |
|-------|---------|
| Phase 2 (3 months) | Commission tracking dashboard, Site visit confirmation flow, Assign MANAGER role to team lead |
| Phase 3 (6 months) | AI features production rollout, Property preference matching UI, WhatsApp Business API |
| Phase 4 (12 months) | Multi-office support, Client portal (lead self-service), Advanced analytics (cohort analysis, deal velocity) |
| Phase 5 (18 months) | Mobile app (React Native) if PWA proves insufficient, Org chart, HR module |

---

## APPENDIX: CURRENT SYSTEM METRICS (4 June 2026)

| Metric | Value |
|--------|-------|
| Total leads in system | 44 |
| Leads in active pipeline (not WON/LOST) | 41 |
| Total users | 7 (3 ADMIN, 4 AGENT, 0 MANAGER) |
| Call logs in database | 600+ (mostly MIS import via admin@wcrcrm.com) |
| WhatsApp templates | 8 |
| Email templates | 8 |
| Workflows configured | 0 |
| Testing Mode | ON |
| Current commit | d2056a4 |
| Production URL | https://crm.whitecollarrealty.com |
| Database | Neon Postgres (free tier) |
| Hosting | Vercel Hobby plan |
| Active cron jobs | 2/2 (Vercel limit reached — additional crons use GitHub Actions) |
