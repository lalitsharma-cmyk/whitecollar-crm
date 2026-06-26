# White Collar Realty CRM — Release Log

This file is the canonical record of production releases. Each release is a named,
frozen baseline with an exact commit, a tag, a deploy date, the Service-Worker
cache version live at the time, and a rollback point. Releases are **frozen** once
recorded — subsequent work happens on a new branch and is recorded as a new
release, never by editing a shipped one.

---

## RELEASE 1 — Active Follow-up Board + Revisit Queue  ·  **FROZEN**

| Field | Value |
|---|---|
| **Status** | **Production baseline — FROZEN** |
| **Commit** | `9406e23` (`Active Follow-up Board exclusions + Revisit Queue (Release 1 foundation)`) |
| **Tag** | `release-1-20260626` |
| **Deployed** | 2026-06-25 |
| **Service Worker** | **v70** |
| **Rollback point** | `b9b279e` (`Three lead-detail fixes: alt-number gating, Property Enquired sync, 10-min follow-up default`) |
| **Branch** | `main` |

### What shipped

1. **"Complete" rolls the follow-up forward (+1 day).**
   Completing a follow-up no longer blanks the follow-up date — it moves it to
   `completion + 1 day` (terminal-guarded: terminal/closed/rejected leads are not
   rolled forward). Replaces the previous behaviour where Complete cleared the date.

2. **Follow-up field removed from Log Call / Log WhatsApp.**
   The conversation-logging forms (Log Call, Log WhatsApp) no longer read or write a
   follow-up date. Follow-up scheduling is now owned by the explicit
   Complete/Snooze/Escalate actions, not piggy-backed onto a call/WhatsApp log.

3. **Active Follow-up Board exclusions (one shared definition — `activeBoardWhere()`).**
   A single DRY source of truth for "what appears on the Active Follow-up Board",
   wired identically into the Action List board, the Leads follow-up chips
   (Today+Overdue / Today / Overdue / Future), and the Dashboard Overdue + Upcoming
   widgets so they reconcile 1:1. The board now **excludes**:
   - rejected / terminal / closed (inactive) leads,
   - cold-call & revival-origin leads,
   - `MASTER_DATA`-origin leads **unless** they are *both* assigned (`ownerId`) *and*
     scheduled (`followupDate`).

   Net effect observed on the live data: the board dropped from **125 → 74** leads
   (9 terminal-with-follow-up + 44 cold/revival follow-ups fell off), and Action-List
   Overdue now equals the Leads Overdue chip exactly.

4. **Revisit Queue (`/revisit-queue`).**
   A new read-only, permission-scoped page (agent = own, manager = team, admin = all)
   listing terminal-status leads that still carry a `followupDate`. This is the
   landing place for rejected/closed leads that still have a pending follow-up.
   Returning a lead to active = an admin changing its status off the terminal value
   via the existing inline editor (no convert button this release — view + separation
   only).

### Verification at release
- Full regression suite green (76 checks), including the reframed
  `data-integrity-jun25` invariant plus new `active-board-exclusions` and
  `revisit-queue` invariants.
- Additive + reversible. No production data was modified.

> **RELEASE 1 is FROZEN.** Any change to the above behaviour is a new release.

---

## RELEASE 2 — Customer Layer  ·  **DESIGN PHASE (not shipped)**

Release 2 introduces the **Customer Layer** — an additive, computed-by-default
grouping of enquiries (Leads) under a canonical, immutable-UUID Customer, with an
auditable/reversible link/unlink model and a read-only 360 view.

- **Status:** design phase — **separate from Release 1**, which stays frozen.
- **Foundation (Step 1):** already built on branch `feat/customer-layer-foundation`
  (HEAD `9ad1f9e`) — schema additions, the pure computed layer, the detection engine,
  the read-only 360 page, and the link/unlink service. **Not merged, not deployed;
  the migration has not been applied to production.**
- **Design:** see [`RELEASE-2-CUSTOMER-LAYER-DESIGN.md`](./RELEASE-2-CUSTOMER-LAYER-DESIGN.md)
  for the complete, review-ready implementation design (16 sections + open questions).
- **Read-only production duplicate/merge audit** (Step 2, analysis only, no data
  touched): `customer-duplicate-audit-2026-06-26.md`.

Release 2 will ship in phases (additive schema → read-only detection + 360 → run &
present the audit → on owner approval, reversibly link historical enquiries →
enable detection for new enquiries), each independently rollback-able. No enquiry
data is ever lost at any phase.

---

## Phase 1 — CLOSED (2026-06-26)

| Field | Value |
|---|---|
| **Status** | **CLOSED — closing audit passed on LIVE production data** |
| **Prod commit** | `b9e0bce` |
| **Service Worker** | **v74** |
| **Regression** | **82/82 green** (`scripts/regression.ts`) |
| **Audit date** | 2026-06-26 |
| **Data writes** | **None** — audit was read-only / rolled-back-transaction only |

Phase 1 is closed. The closing audit ran against the **live** production database and
verified, end to end, that every reporting surface reconciles, that follow-up
hygiene holds, that the Revival reject/promote lifecycle behaves, and that
role-based permissions and the migration ledger are clean. Nothing below modified
production data — counts are observed, and the one lifecycle proof (promote) was
executed inside a rolled-back transaction.

### Closing audit — proven on live data

**1. Reporting reconciliation (517 live leads, every bucket adds up).**
- By origin: `ACTIVE_LEAD` **211** + `REVIVAL` **46** + `MASTER_DATA` **260** = **517**.
- Active-vs-terminal within ACTIVE_LEAD: active **144** + terminal **67** = **211**.
- Terminal split: lost **65** + closed **2** = **67**.
- Assignment: assigned **210** + unassigned **1** = **211**.
- Buyer pool: pool **38** + converted **1** (= 39 buyer records in scope).

**2. Follow-up hygiene (Active Follow-up Board = 144 active leads).**
- **0** active leads carry a follow-up date older than 26-Jun.
- Earliest follow-up date across active leads = **26-Jun** (today); **0** null follow-ups.
- Distribution: **76** due today + **68** future = **144** — matches the active count exactly.

**3. Revival reject + promote lifecycle.**
- **Reject:** Mukul Dudeja stays `REVIVAL` / *Not Interested* and is **never** promoted to a Lead.
- **Promote:** Prakhar Sharma promoted in a **rolled-back transaction** — `REVIVAL → ACTIVE_LEAD`
  with owner, Smart-Timeline history, and status all preserved; **production left untouched**
  (the transaction was rolled back after the assertion).

**4. Permissions (role scoping verified).**
- Agent **Tanuj** sees **181 / 517** leads — his own only, **0 leakage**, and **no buyer-data access**.
- Buyer-data gate by market: **Dubai = true**, **India = false**.
- **No MANAGER accounts exist** in production, so manager subtree scoping is **code-verified only**
  (asserted in `scripts/regression.ts`, not exercised against a live manager login).

**5. Migration ledger reconciled.**
- `prisma migrate status` = **"Database schema is up to date!"** after the four hand-applied
  migrations were marked `--applied` on 2026-06-26. See
  [`MIGRATION-LEDGER.md`](./MIGRATION-LEDGER.md) for the full reconciliation and the
  safe procedure for future migrations.

### Verification at close
- Full regression suite green (**82 checks**, `scripts/regression.ts`).
- Audit was **read-only / rolled-back** — additive, reversible, **no production data modified**.

> **Phase 1 is CLOSED.** Any change to the above behaviour is a new release/phase.
