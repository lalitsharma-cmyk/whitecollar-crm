# White Collar Realty CRM — Role Permission Matrix
**Audit Date:** 4 June 2026 | **Source:** Code inspection (MobileShell.tsx, dashboard/page.tsx, schema.prisma)
**Roles in system:** ADMIN, MANAGER, AGENT

---

## 1. NAVIGATION ACCESS

| Nav Section | Link | ADMIN | MANAGER | AGENT |
|------------|------|-------|---------|-------|
| WORKSPACE | Dashboard | YES | YES | YES |
| WORKSPACE | Leads | YES | YES | YES |
| WORKSPACE | Revival Engine | YES | YES | YES |
| WORKSPACE | Action List | YES | YES | YES |
| WORKSPACE | Properties | YES | YES | YES |
| WORKSPACE | Vault | YES | YES | YES |
| WORKSPACE | Reports | YES | YES | NO (agentHidden:true) |
| SETUP | My Profile | YES | YES | YES |
| SETUP | Settings | YES | YES | YES |
| SETUP | Help | YES | YES | YES |
| TEAM | Team & Roles | YES | YES | NO (managerOrAdmin) |
| TEAM | Awaiting Team | YES | YES | NO (managerOrAdmin) |
| ADMIN | Lead Intake | YES | NO | NO (adminOnly) |

**Notes:**
- Agents cannot see the Reports section in the sidebar. They can still access it directly via URL — no server-side guard is visible in the reports page source (route-level auth check not confirmed in this audit).
- Settings page is accessible to all roles in the sidebar — but most settings (like Testing Mode, Round-robin, AI) are admin-level actions. The page itself does not appear to conditionally hide admin-only settings from agents.

---

## 2. DASHBOARD VIEW SCOPING

| Feature | ADMIN | MANAGER | AGENT |
|---------|-------|---------|-------|
| Team filter toggle (Dubai/India/All) | YES | NO (locked to own team) | NO (locked to own team) |
| KPI tiles scope | All teams OR selected team | Own team only | Own leads only |
| Morning greeting + Today's Mission | YES | YES | YES |
| By-Salesperson table | YES | YES (own team) | NO |
| Team Scoreboard card | YES | YES | NO |
| Weekly Summary card | YES | YES | NO |
| Team funnel KPIs | YES | YES | NO |
| Attendance "I'm here" | YES | YES | YES |
| Call target progress bar | NO | NO | YES (own target) |
| Admin morning queue widget | YES | NO | NO |

---

## 3. LEADS MODULE

| Action | ADMIN | MANAGER | AGENT |
|--------|-------|---------|-------|
| View all leads (44) | YES | NO (team only) | NO (own leads only) |
| Filter by team | YES | NO | NO |
| Filter by owner | YES | YES (team) | NO |
| Export leads to CSV | YES | Unknown | Unknown |
| Import leads (via /intake) | YES | NO (no nav link) | NO |
| Create new lead | YES | YES | YES |
| View lead detail | YES | YES (team) | YES (own) |
| Edit lead (stage, fields) | YES | YES | YES |
| Delete/archive lead | Assumed YES | Unknown | NO (assumed) |
| Assign lead to agent | YES | YES (team agents) | NO |
| Mark needs manager review | YES | YES | YES (flag own leads) |
| Log call | YES | YES | YES |
| Add note/remark | YES | YES | YES |
| Log WhatsApp | YES | YES | YES |
| Schedule activity | YES | YES | YES |
| Reject/lose lead | YES | YES | YES |

---

## 4. ACTION LIST

| View Scope | ADMIN | MANAGER | AGENT |
|-----------|-------|---------|-------|
| All teams | YES | NO | NO |
| Own team | YES (via team filter) | YES | NO |
| Own leads only | YES (via filter) | YES (own leads) | YES |
| "Mark done" button | YES | YES | YES (own) |
| "Snooze" button | YES | YES | YES (own) |
| "Escalate" button | YES | YES | YES |

---

## 5. COLD CALLS / REVIVAL ENGINE

| Action | ADMIN | MANAGER | AGENT |
|--------|-------|---------|-------|
| View all cold data | YES | YES (team) | YES (own) |
| Import cold data | YES | Assumed YES | NO |
| Assign to agent | YES | YES (team) | NO |
| Promote to lead | YES | YES | YES |
| Start call session | YES | YES | YES |

---

## 6. PIPELINE KANBAN

| Action | ADMIN | MANAGER | AGENT |
|--------|-------|---------|-------|
| Filter by team | YES | YES | NO |
| Filter by owner | YES | YES (team) | NO (own only) |
| View all leads | YES | YES (team) | YES (own) |
| Drag to change stage | YES | YES | YES |
| Stage change requires confirmation | YES | YES | YES |

---

## 7. REPORTS

| Report | ADMIN | MANAGER | AGENT |
|--------|-------|---------|-------|
| Reports main page | YES | YES | NO (nav hidden) |
| Funnel analysis | YES | YES | NO |
| Leaderboard | YES | YES | NO |
| Activity feed | YES | YES | NO |
| Daily Report | YES | YES | NO |
| SLA Report | YES | YES | NO |
| Travel Reimbursement | YES | YES | NO |
| Team Comparison | YES | YES (own team) | NO |
| Commission Report | YES | YES | NO |
| CSV exports | YES | Assumed YES | NO |

**Gaps noted:** Reports nav link is hidden for agents in the sidebar (`agentHidden: true`), but there is no explicit route-level guard preventing a direct URL access by an agent. This should be verified in the route code.

---

## 8. SETTINGS

| Setting | ADMIN | MANAGER | AGENT |
|---------|-------|---------|-------|
| Testing mode toggle | YES | NO (assumed) | NO |
| Round-robin toggle | YES | NO | NO |
| Travel rate | YES | NO | NO |
| Speed-to-lead toggle | YES | NO | NO |
| BANT gate | YES | NO | NO |
| Festival theme | YES | NO | NO |
| Calendar subscription URL | YES | YES (own) | YES (own) |
| Push notification test | YES | YES | YES |
| Notification preferences | YES | YES | YES |
| AI features | YES | NO | NO |

**Gap:** The settings page appears to show ALL settings to any logged-in user who navigates to /settings. Admin-only settings (Testing Mode, Round-robin, AI) may be visible to agents/managers. Server-side auth guards on the Settings API endpoints (POST/PATCH) should be confirmed.

---

## 9. ADMIN PAGES

| Page | ADMIN | MANAGER | AGENT |
|------|-------|---------|-------|
| /admin/users | YES | NO | NO |
| /admin/templates | YES | NO | NO |
| /admin/workflows | YES | NO | NO |
| /admin/audit | YES | NO | NO |
| /admin/attendance | YES | YES (team?) | NO |
| /admin/vault | YES | NO | NO |
| /admin/health | YES | NO | NO |
| /admin/integrations | YES | NO | NO |
| /admin/dedup | YES | NO | NO |
| /admin/targets | YES | YES (team) | NO |
| /admin/imports | YES | NO | NO |
| /admin/ai-trial | YES | NO | NO |
| /team | YES | YES | NO |
| /admin/awaiting-team | YES | YES | NO |
| /intake | YES | YES? | NO |

---

## 10. PERMISSION GAPS & RECOMMENDATIONS

### Gap 1: Reports pages accessible via direct URL for agents
**Risk:** Agents who know the URL `/reports` can access reports data. The nav link is hidden but there's no route guard.
**Recommendation:** Add `requireRole("MANAGER")` or equivalent server-side check to all /reports/* route handlers.

### Gap 2: Settings page shows admin-only controls to all roles
**Risk:** Agents or managers could see (and potentially toggle) Testing Mode, AI Features, or Round-robin settings.
**Recommendation:** Add role-based conditional rendering in /settings/page.tsx to hide admin-only sections from non-admin users.

### Gap 3: User management is read-only — no invite/edit UI
**Risk:** Adding a new agent requires direct database access or a workaround. This is a blocking issue for team growth.
**Recommendation:** Add an "Invite User" form to /admin/users that creates a user with a temporary password or sends a magic link.

### Gap 4: Manager can set managerId (hierarchy) for agents
**Risk:** Per audit log, `user.manager.set` actions were performed by Lalit. The ability to set reporting lines is an admin-level action but may be accessible to managers.
**Recommendation:** Confirm that /team page's "Assign Manager" action is gated to ADMIN only.

### Gap 5: Agent can escalate leads they don't own
**Risk:** On the Action List, "Escalate" button is visible for admin viewing all leads. In an agent view, an agent may escalate a lead that belongs to another agent (if they can see it through team scope).
**Recommendation:** Confirm escalate API checks `lead.ownerId === user.id OR user.role in [ADMIN, MANAGER]`.

---

## 11. CURRENT USERS TABLE

| User | Email | Role | Team |
|------|-------|------|------|
| Lalit Sharma | lalitsharma@whitecollarrealty.com | ADMIN | — |
| Sameer | sameer@whitecollarrealty.com | ADMIN | — |
| Admin (system) | admin@wcrcrm.com | ADMIN | — |
| Dinesh Gill | dineshgillwcr@gmail.com | AGENT | Dubai |
| Mehak Mukhija | mehakmukhijawcr@gmail.com | AGENT | Dubai |
| Tanuj Chopra | tanujchoprawcr@gmail.com | AGENT | India |
| Yasir Khan | saleswhitecollarrealty@gmail.com | AGENT | India |

**Observations:**
- No MANAGER role currently assigned to any user
- The Dashboard "BY SALESPERSON" table hardcodes "Needs Lalit" in the column header — this is not dynamic based on who is logged in. When Sameer or the system Admin logs in, the column still says "Lalit."
- 3 ADMIN accounts exist — this is unusual. `admin@wcrcrm.com` has 608 call logs (imported from MIS), suggesting it was used as the "importer" user during data migration. It owns 0 leads.
