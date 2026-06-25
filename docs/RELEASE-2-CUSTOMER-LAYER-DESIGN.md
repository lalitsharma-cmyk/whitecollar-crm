# Release 2 — Customer Layer · Implementation Design

**Status:** Design / review-ready · **NOT** built beyond the Step-1 foundation · NOT deployed
**Foundation branch (read-only reference):** `feat/customer-layer-foundation` (HEAD `9ad1f9e`)
**Production baseline:** `main` @ `9406e23` (Release 1, frozen — see `RELEASES.md`)
**Audit referenced:** `customer-duplicate-audit-2026-06-26.md` (read-only prod analysis, Step 2)

> This document is a design specification. It does not change code, schema, or
> production data. It grounds every statement in the foundation that already
> exists on the branch above, and marks everything Release 2 must add as
> **`[TO BUILD]`**.

---

## Executive summary

The **Customer Layer** makes a *person* — not a row — the canonical unit in the
CRM. Today every enquiry is a standalone `Lead`. The same human who enquires about
three projects becomes three disconnected leads. The Customer Layer adds an
**additive** grouping: an immutable-UUID `Customer` that one or more enquiries can
be *linked* under, giving a single read-only **360 view** (one timeline, one
contact rollup, one computed status/owner) without ever merging, collapsing, or
deleting the underlying enquiries.

The architecture obeys one owner rule above all: **"everything that can be computed
should be computed; everything that must be stored should be immutable."** A
`Customer` stores almost nothing — only its UUID, an optional admin display-name
override, and an optional admin canonical-owner override. Its **status, owner,
confidence, contact rollup, health, last-activity and summary are all computed live
from the linked enquiries on every read**, so a new enquiry can never make a stored
value go stale. The relationship itself is recorded in an **immutable, append-only
`CustomerLinkAudit`** that makes every grouping decision explainable and exactly
reversible.

Detection is advisory only: an engine **detects, scores, and recommends** duplicate
candidates, but **never auto-merges, auto-links, or deletes** — an admin always
makes the call through the audited link service. Linking and unlinking are always
reversible (unlink restores the enquiry to its exact standalone state). Nothing on
the timeline is ever deleted; the UI **filters** events, never removes them. The
360 view is permission-scoped: a viewer sees only the enquiries under a customer
that they are allowed to see.

### What's already built (Step 1) vs what Release 2 adds

| Capability | State | Where |
|---|---|---|
| Prisma `Customer` model (UUID id, `displayName?`, `canonicalOwnerId?`, timestamps) | **Built** | `prisma/schema.prisma` (branch) |
| `Lead.customerId?` nullable FK (defaults NULL for every existing lead) | **Built** | `prisma/schema.prisma` (branch) |
| Immutable `CustomerLinkAudit` model (all decision/transition fields) | **Built** | `prisma/schema.prisma` (branch) |
| Idempotent additive migration (`20260626120000_add_customer_layer`) | **Built, NOT applied to prod** | `prisma/migrations/…` (branch) |
| Pure computed layer — status / owner / confidence / summary / displayName | **Built** | `src/lib/customer/compute.ts` |
| Duplicate detection engine (detect / score / recommend; tiers) | **Built** | `src/lib/customer/detect.ts` |
| Link / unlink service (sets `customerId` + writes immutable audit, atomic) | **Built** | `src/lib/customer/link.ts` |
| Customer-360 read-only data loader (permission-scoped, computed-on-read) | **Built** | `src/lib/customer/query.ts` |
| Customer-first search resolution + locked 6-step ranking | **Built** | `src/lib/customer/search.ts`, `searchRank.ts` |
| Locked 22-event timeline taxonomy + chip groups | **Built** | `src/lib/customer/timelineEvents.ts` |
| Read-only Customer 360 page | **Built** | `src/app/(app)/customers/[id]/page.tsx` |
| Master-timeline client (filter chips; never removes events) | **Built** | `src/components/CustomerTimeline.tsx` |
| Unit tests (compute / detect / search) | **Built** | `src/lib/customer/*.test.ts` |
| **HTTP API routes** (link / unlink / merge / detection-candidates / 360 / search) | **`[TO BUILD]`** | — |
| **Merge-two-customers** writer (link-not-collapse; re-parent enquiries) | **`[TO BUILD]`** | — |
| **Rollback / bulk-unlink** writer (`ROLLBACK` audit) | **`[TO BUILD]`** | — |
| **Duplicate-detection popup** UI (consolidated summary + 4 actions) | **`[TO BUILD]`** | — |
| **Admin link/merge review screen** | **`[TO BUILD]`** | — |
| **Migration-audit review screen** | **`[TO BUILD]`** | — |
| **Customer-first wiring into the live global search bar** | **`[TO BUILD]`** | — |
| **Customer index / list page** | **`[TO BUILD]`** | — |
| **Computed customer health** (`computeCustomerHealth`) | **`[TO BUILD]`** (taxonomy reserved; deliberately NO schema field) | — |
| **Regression invariants for the customer layer** | **`[TO BUILD]`** | `scripts/regression.ts` |
| **Junk/placeholder-phone guard in the production dedup path** | **`[TO BUILD]`** (audit applied it locally; prod path still raw) | `lib/dedup`, `intelligenceCheck`, importer dedup |

> Note: a pre-existing `src/app/(app)/customers/page.tsx` (a redirect to
> `/leads?filter=won`) and the older `CustomerIntelligenceCard` / `customerHistory.ts`
> are the **legacy** "customers removed" stub and the per-lead duplicate-history
> feature — **not** the Customer Layer. Release 2 replaces the redirect stub with a
> real customer index `[TO BUILD]`.

---

## 1. Customer Layer architecture

### The additive Customer ↔ Enquiry model

An **enquiry IS a `Lead`** — unchanged. The only structural addition to `Lead` is a
nullable `customerId`. A `Customer` is the canonical human; it is a parent that
groups enquiries. The relationship is strictly **1 Customer → many enquiries**
(one enquiry belongs to at most one customer). Every existing lead defaults
`customerId = NULL` = *standalone enquiry*, so introducing the layer changes the
meaning of zero existing rows.

```
            ┌──────────────────────────────┐
            │           Customer            │   STORED + IMMUTABLE (tiny):
            │  id (uuid)        ← immutable │   • id (uuid)
            │  displayName?     ← override  │   • createdAt
            │  canonicalOwnerId?← override  │   STORED + OVERRIDE-ONLY (admin):
            │  createdAt/updatedAt          │   • displayName? (else computed)
            └──────────────┬───────────────┘   • canonicalOwnerId? (else computed)
                           │ 1
                           │
                           │ N   (Lead.customerId, nullable, SetNull)
            ┌──────────────┴───────────────┐
            │       Lead  (= Enquiry)       │   SOURCE OF TRUTH (never duplicated
            │  phones, emails, remarks,     │   onto the Customer):
            │  ownerId, status, projects,   │   • phones / emails / alt-contacts
            │  followupDate, activities …   │   • remarks / activities / timeline
            │  customerId? ──────────────►  │   • assignments / owner / status
            └──────────────────────────────┘   • projects / follow-up dates
                           ▲
                           │ append-only, immutable
            ┌──────────────┴───────────────┐
            │      CustomerLinkAudit        │   STORED + IMMUTABLE (decision log):
            │  who / when / why             │   • action LINK|UNLINK (text)
            │  action, confidenceSnapshot,  │   • performedBy / performedAt
            │  matchFactors, prev/new owner │   • confidence snapshot + factors
            │  prevCustomerId/newCustomerId │   • owner + customer transition
            └──────────────────────────────┘   (basis for reversibility)
```

### The 3-tier Single Source of Truth

1. **STORED + IMMUTABLE** — the Customer's UUID identity, all `CustomerLinkAudit`
   rows, link/created dates, created-by, and (Release 2) merge/rollback audit rows.
   Written once; never mutated.
2. **SOURCE-OF-TRUTH = the Enquiry/Lead** — phones, emails, remarks, assignments,
   activities, projects, follow-up dates, status. The Customer **never duplicates or
   owns** any of this. To know a customer's phone numbers you read the union of the
   linked enquiries' phones — live.
3. **COMPUTED-LIVE** — status, owner-of-record, confidence, health, last-activity,
   contact rollup/summary, displayName-by-default. **Never stored.** Recomputed every
   render by the pure functions in `compute.ts`.

The two admin overrides (`displayName`, `canonicalOwnerId`) are the *only* concession
to storage beyond identity + audit, and each is a single explicit label that the
system never auto-derives from a new enquiry.

### Data-flow (read path)

```
  HTTP GET /customers/:id
        │
        ▼
  getCustomer360(me, id)                         ← src/lib/customer/query.ts
        │  leadScopeWhere(me)  ──────────────────► role-scoped enquiry filter
        ▼                                           (+ deletedAt:null)
  Customer + its VISIBLE enquiries  ── Prisma ──► DB
        │
        ├─► computeCustomerStatus(enquiries)             ┐
        ├─► computeCustomerOwner(enquiries, canonical)   │  PURE — no DB,
        ├─► computeCustomerSummary(enquiries)            │  no Date.now(),
        ├─► confidenceFromEnquiries(enquiries)           │  deterministic
        ├─► computeDisplayName(enquiries, override)      ┘
        │
        ├─► Activity[] across linked enquiries  ─────► master timeline events
        └─► CustomerLinkAudit[] for this customer ───► LINK/UNLINK timeline events
        │
        ▼
  Customer360 { displayName, status, ownerOfRecord, confidence, summary,
                enquiries[], timeline[] }   →  read-only 360 page (computed, not stored)
```

### Data-flow (write path — link/unlink)

```
  admin decision (link these enquiries / unlink this one)
        │  authz: ADMIN-only  [TO BUILD route]
        ▼
  linkEnquiry({ leadId, targetCustomerId|null, performedById, reason,
                confidenceSnapshot, factors, prev/currentOwnerId })
        │  one transaction (atomic):
        ├─ 1. Lead.update { customerId = target | null }
        └─ 2. CustomerLinkAudit.create { action, transition, snapshot, rollbackAvailable:true }
        │
        ▼
  next read recomputes EVERYTHING from the new enquiry set — no stored value to update
```

---

## 2. Customer table schema

The schema below is **built** on the branch and captured here verbatim from
`prisma/schema.prisma`. It is **purely additive**: two new tables + one new nullable
column + indexes/FKs; **no existing table or column is altered or dropped.**

### `Customer`

```prisma
model Customer {
  // IMMUTABLE identity — a surrogate UUID, NEVER a mobile/email/name.
  id               String   @id @default(uuid())
  // OPTIONAL admin display-name override. NULL ⇒ display name is COMPUTED from
  // the linked enquiries (most recent / most-complete name). Label only — not identity.
  displayName      String?
  // OPTIONAL admin canonical owner-of-record override. NULL ⇒ owner is COMPUTED
  // (single shared owner, else "MULTIPLE"). Never auto-derived from a new enquiry.
  canonicalOwnerId String?
  canonicalOwner   User?    @relation("CustomerCanonicalOwner", fields: [canonicalOwnerId], references: [id], onDelete: SetNull)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  enquiries        Lead[]               @relation("CustomerEnquiries")
  linkAudits       CustomerLinkAudit[]

  @@index([canonicalOwnerId])
  // NOTE: there is deliberately NO `healthMeta` / status / owner column — those are
  // all COMPUTED. Storing them would let a new enquiry make a persisted value stale.
}
```

### `Lead` addition (only the new lines)

```prisma
model Lead {
  // …existing fields unchanged…
  customerId      String?
  customer        Customer?   @relation("CustomerEnquiries", fields: [customerId], references: [id], onDelete: SetNull)
  // …
  @@index([customerId])
}
```

`onDelete: SetNull` means deleting a `Customer` **detaches** its enquiries back to
standalone — it never cascade-deletes an enquiry. Zero data loss by construction.

### `CustomerLinkAudit` (immutable, append-only)

```prisma
model CustomerLinkAudit {
  id                 String    @id @default(cuid())
  customerId         String?
  customer           Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)
  leadId             String
  action             String    // "LINK" | "UNLINK"  (text, no enum — log can't be invalidated by a future enum edit)
  performedById      String?
  performedBy        User?     @relation("CustomerLinkAuditActor", fields: [performedById], references: [id], onDelete: SetNull)
  performedAt        DateTime  @default(now())
  reason             String?
  confidenceSnapshot Int?      // live confidence AT decision time (otherwise never stored)
  matchFactors       Json?     // the boolean factors that produced the score
  previousOwnerId    String?   // owner-of-record transition (narrative)
  currentOwnerId     String?
  prevCustomerId     String?   // customer-membership transition — the basis for reversibility
  newCustomerId      String?
  rollbackAvailable  Boolean   @default(true)

  @@index([customerId])
  @@index([leadId])
  @@index([performedById])
  @@index([performedAt])
}
```

> **Release 2 addition `[TO BUILD]`:** extend the `action` value-set the *service*
> writes to include `MERGE` and `ROLLBACK` (still a text column — no enum migration,
> so the immutable log can never be invalidated). The column already accepts these;
> only the writer and the UI need to learn them.

### Indexes & FKs
- `Lead(customerId)` — the hot index: "give me all sibling enquiries of this customer".
- `Customer(canonicalOwnerId)`; `CustomerLinkAudit(customerId | leadId | performedById | performedAt)`.
- All three FKs are `ON DELETE SET NULL` (User, Customer) — audit and enquiries survive deletes.

### Migration SQL shape (idempotent — built, NOT applied to prod)

`prisma/migrations/20260626120000_add_customer_layer/migration.sql` creates both
tables with `CREATE TABLE IF NOT EXISTS`, adds the column with
`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "customerId" TEXT`, creates each index
with `CREATE INDEX IF NOT EXISTS`, and adds each FK inside a
`DO $$ … EXCEPTION WHEN duplicate_object THEN NULL; END $$;` guard. It is therefore
safe to re-run and safe to apply ahead of the Prisma `_prisma_migrations` catch-up,
matching the repo's existing additive-migration convention.

**Additive confirmation:** every existing lead keeps `customerId = NULL`; applying
this migration changes **zero** existing rows' meaning. The 360 page, link service,
search and detection are all build-verified but become *live* only once this gated
migration deploys (P2a).

---

## 3. Customer Linking workflow

Linking groups one or more enquiries under a single canonical customer. **Admin-only.**
The full path is *detect → recommend → admin reviews → admin links*.

**Step-by-step**

1. **Detect (advisory).** When an admin opens a candidate enquiry (or the
   detection review screen `[TO BUILD]`), the server fetches a role-scoped,
   `deletedAt:null` candidate pool and calls `detectCandidates(lead, pool)`
   (`detect.ts`). This returns scored `DetectMatch[]` (strongest first) with tier
   (`Very High` / `High` / `Medium`), score (0–100), reasons, and the raw factors.
   **It writes nothing.**
2. **Recommend.** The UI presents the candidates with their confidence + reasons.
   `Very High` (verified mobile/email) → labelled **Safe Merge**; everything else →
   **Manual Review**. No action is pre-selected and nothing auto-links.
3. **Admin reviews.** The admin inspects the consolidated evidence (the popup in
   §4 / §9) and chooses one of the four actions. Only the admin can trigger a write.
4. **Link.** On "Add enquiry under existing" (or creating a new customer and linking
   the first enquiry), the route (`[TO BUILD]`, ADMIN-gated) calls `linkEnquiry`:
   - sets `Lead.customerId = targetCustomerId` (creating the `Customer` first if this
     is a brand-new customer), and
   - writes **one** immutable `CustomerLinkAudit` row capturing `action: "LINK"`,
     `performedById`, `reason`, `confidenceSnapshot`, `matchFactors`, the
     owner-of-record transition, and `prevCustomerId → newCustomerId`.

   Both steps run in **one transaction** (`linkEnquiryInTx`), so a link is atomic.
5. **Computed after.** Nothing else is written. The next read of the customer
   recomputes status (`computeCustomerStatus`), owner-of-record
   (`computeCustomerOwner`), confidence (`confidenceFromEnquiries`), summary
   (`computeCustomerSummary`) and displayName (`computeDisplayName`) from the new
   enquiry set. The 360 timeline gains a `CUSTOMER_LINKED` event sourced from the
   audit row.

**Who triggers / what's written / what's computed**

| Phase | Actor | Writes | Computed after |
|---|---|---|---|
| Detect | system (on admin's screen) | nothing | candidate scores/tiers/reasons |
| Recommend | system | nothing | Safe-Merge vs Manual-Review labels |
| Review | admin | nothing | — |
| Link | admin | `Lead.customerId` + 1 `CustomerLinkAudit` (atomic) | status/owner/confidence/summary/displayName + timeline event |

---

## 4. Duplicate Merge workflow

When detection surfaces a likely-duplicate, the admin sees a **duplicate-detection
popup** with a consolidated summary and **four actions**. Every action is
**link-not-collapse**: no enquiry row is ever merged into another, overwritten, or
deleted. "Merge" means *re-parent enquiries under one Customer*, never destroy one.

**The 4 admin actions**

| Action | What it does | Writes |
|---|---|---|
| **1. Add enquiry under existing customer** | Link the new/standalone enquiry under an existing `Customer`. | `linkEnquiry(leadId, targetCustomerId)` → `Lead.customerId` + `LINK` audit. |
| **2. Merge customer records** | Two *existing* customers are the same human → re-parent the smaller customer's enquiries under the larger (survivor), then the empty customer is left with zero enquiries (detached, not deleted, so its audit history survives). | `[TO BUILD]` merge writer: one `linkEnquiry(... target=survivor)` per moved enquiry (each writes its own transition audit) + one `MERGE` audit row recording `sourceCustomerId → survivorCustomerId`. All in one transaction. Fully reversible (each move's audit carries its `prevCustomerId`). |
| **3. Create separate customer** | The candidates are *different* people → create a new `Customer` and link only this enquiry under it (explicitly NOT merging). | `Customer.create` + `linkEnquiry(leadId, newCustomerId)` → `LINK` audit. The other enquiry is untouched. |
| **4. Cancel** | Dismiss — no decision now. | nothing. |

**The popup contents** (consolidated summary — see wireframe in §9):
- The candidate group's **computed display name(s)** and per-enquiry name/project/owner.
- **Confidence score + tier** (`Very High` / `High` / `Medium`) from `detect.ts`.
- **Reasons** (the human-readable evidence list, e.g. `✓ Same email`, `✓ Similar name`)
  in strongest-first order, from `computeCustomerConfidence`.
- A **side-by-side contact diff** (phones, emails, projects, status, owner) so the
  admin sees exactly what overlaps and what conflicts.
- The four action buttons; **Safe Merge** is offered only for `Very High`
  (verified mobile/email); `Medium` shows **Manual Review** with merge de-emphasised.

**Confidence + reasons** are computed by `computeCustomerConfidence`
(`sameMobile`+60, `sameEmail`+55, `sameAlternateNumber`+35, `similarName`+25,
`sameCompany`+20; clamped 0–100) and tiered by `tierForFactors`
(`sameMobile || sameEmail` → Very High; `sameAlternateNumber` → High; `similarName`
→ Medium). The score shown in the popup is snapshotted into `confidenceSnapshot` if
the admin proceeds, so the decision stays explainable even as the data later changes.

---

## 5. Merge audit trail

Every link / unlink / merge / rollback decision writes exactly **one** immutable
`CustomerLinkAudit` row (see §2 for the schema). The row captures the *complete*
decision so it is explainable months later **and** is the data that makes the action
reversible.

**Every field, and why it matters six months later**

| Field | Captures | Why it makes the decision explainable / reversible |
|---|---|---|
| `id` | the audit row identity (cuid) | stable handle for "undo this exact decision" |
| `customerId` | the customer the decision concerns | discover the decision from either side (target on LINK, source on UNLINK) |
| `leadId` | the enquiry linked/unlinked | which enquiry moved |
| `action` | `LINK` / `UNLINK` (/ `MERGE` / `ROLLBACK` `[TO BUILD]`) | what happened, in plain text |
| `performedById` + `performedAt` | **who** and **when** | accountability — "Lalit linked this on 26 Jun, 18:04" |
| `reason` | the admin's free-text justification | **why** — the human rationale at decision time |
| `confidenceSnapshot` | the live score at decision time | the *evidence strength* the admin acted on, frozen (confidence is otherwise never stored) |
| `matchFactors` | the boolean factors (`sameEmail`, `similarName`, …) | exactly *which signals* drove it — reproducible even if the underlying data later changes |
| `previousOwnerId` → `currentOwnerId` | owner-of-record transition | the assignment narrative around the merge |
| `prevCustomerId` → `newCustomerId` | customer-membership transition | **the reversibility key** — to undo, re-apply the inverse transition |
| `rollbackAvailable` | whether this decision can still be undone | lets an admin lock a historical decision |

Because the log is **append-only and never mutated**, the full sequence of rows is a
replayable history of how every customer grouping came to be. Reversibility (see §6)
is mechanical: the `prevCustomerId`/`newCustomerId` pair on each row is precisely the
information needed to put an enquiry back where it was.

---

## 6. Rollback strategy (data / link level)

This section is about reversing **link decisions**, not deploys (deploy/schema
rollback is §16).

**Unlink restores exact standalone state.** `unlinkEnquiry` (built) calls
`linkEnquiry` with `targetCustomerId = null`: it sets `Lead.customerId = NULL` and
writes an `UNLINK` audit row whose `prevCustomerId` records where the enquiry came
from. Because the enquiry's own data (phones, status, owner, activities, remarks) was
never moved onto the customer — the customer only *referenced* it — clearing the
reference returns the enquiry to **byte-for-byte its prior standalone state**. Nothing
to restore beyond the single column.

**Per-link reversibility.** Every link is independently reversible because each link
wrote its own audit row with its own transition. Undoing link *N* does not disturb
links *N−1* or *N+1*. The audit's `prevCustomerId`/`newCustomerId` is the inverse map.

**Merge reversibility `[TO BUILD]`.** A "Merge customer records" (§4 action 2) is
implemented as a *set* of per-enquiry links plus one `MERGE` summary row. Rolling it
back = replaying each moved enquiry's audit in reverse (re-parent each back to its
`prevCustomerId`), then writing a `ROLLBACK` summary row. No enquiry is recreated
because none was ever destroyed.

**Bulk unlink `[TO BUILD]`.** "Detach all enquiries from this customer" iterates the
customer's currently-linked enquiries and calls `unlinkEnquiry` for each in one
transaction, writing one `UNLINK` row per enquiry (so the trail stays granular) and
optionally one `ROLLBACK` summary. Afterwards every formerly-linked enquiry is
standalone again (`customerId = NULL`) and the customer is empty (its audit history
intact). This is exactly the data-level escape hatch invoked during a phase rollback
(§16): set all `customerId = NULL`, append audit — and **no enquiry data is lost.**

---

## 7. Permission matrix

Grounded in `leadScopeWhere(me)` (`src/lib/leadScope.ts`): **ADMIN** → all leads
(no filter, `deletedAt:null`); **MANAGER** → team-scoped (`forwardedTeam` matches
`normalizeTeam(me.team)` — strict, a Dubai manager never sees India leads); **AGENT**
→ own leads only (`ownerId === me.id`). The Customer-360 loader already enforces this:
a customer with **no enquiry visible to the caller** returns `null` (treated as
not-found, never disclosing existence).

`SUPER-ADMIN(admin)` below = the `ADMIN` role (the highest role in this CRM).

| Capability | AGENT | MANAGER | SUPER-ADMIN (admin) |
|---|:--:|:--:|:--:|
| **View 360 page** | ✅ scoped — only customers with ≥1 of *their own* enquiries; sees only their own enquiries/events under it | ✅ scoped — customers with ≥1 *team* enquiry; sees only team enquiries/events | ✅ full — every customer, every enquiry/event |
| **See which enquiries belong to a customer** | own only (others hidden) | team only | all |
| **Link an enquiry under a customer** | ❌ | ❌ (default) — *OPEN QUESTION: allow team-scoped linking?* | ✅ |
| **Unlink an enquiry** | ❌ | ❌ (default) | ✅ |
| **Merge customer records** | ❌ | ❌ | ✅ |
| **Edit canonical owner / displayName** | ❌ | ❌ | ✅ |
| **Run detection (advisory candidates)** | 👁️ *OPEN QUESTION: read-only near-dup hint?* (default ❌) | 👁️ default ❌ | ✅ |
| **Run the migration audit / bulk detection report** | ❌ | ❌ | ✅ |

Defaults are **admin-only for every mutating action and for running detection**,
matching the foundation's stated AUTH (`link.ts`: "ADMIN-only"). Whether managers may
link within their team, and whether agents see read-only near-duplicate hints, are
listed as open questions for the owner (§ Open questions). The **360 view itself is
always permission-scoped per viewer** regardless of who may link.

---

## 8. API changes

No customer HTTP routes exist yet — **all routes below are `[TO BUILD]`** (the
foundation provides the server-side functions they call). Every mutating route is
**ADMIN-gated** via `requireUser()` + role check; every read route is scoped via
`leadScopeWhere`. Mutations are **idempotent-safe** because each writes an audit row
and re-reads current membership before acting.

| Method & path | Purpose | Payload / query | Authz | Idempotency | Calls (built) |
|---|---|---|---|---|---|
| `GET /api/customers/:id` *(or RSC loader)* | Customer-360 data | — | scoped (`leadScopeWhere`); not-found if no visible enquiry | read-only | `getCustomer360` |
| `GET /api/customers/search?q=` | Customer-first search | `q` (name/phone/email) | scoped | read-only | `resolveCustomers` (→ `rankCustomerSearchRows`) |
| `GET /api/customers/:leadId/candidates` | Detection candidates for an enquiry | `leadId` | ADMIN | read-only (no writes) | `detectCandidates` over a scoped pool |
| `POST /api/customers/link` | Link an enquiry under a customer (or new) | `{ leadId, targetCustomerId?, createCustomer?: {displayName?}, reason?, confidenceSnapshot?, factors? }` | ADMIN | safe — re-reads `customerId`, writes `LINK` audit | `linkEnquiry` |
| `POST /api/customers/unlink` | Unlink an enquiry → standalone | `{ leadId, reason? }` | ADMIN | safe — `UNLINK` audit, no-op if already null | `unlinkEnquiry` |
| `POST /api/customers/merge` | Merge two customers (re-parent enquiries) | `{ sourceCustomerId, survivorCustomerId, reason? }` | ADMIN | safe — per-enquiry `LINK` + one `MERGE` audit, all-in-tx | `linkEnquiry` ×N + merge writer `[TO BUILD]` |
| `POST /api/customers/rollback` | Roll back a link/merge / bulk-unlink | `{ auditId }` **or** `{ customerId, bulkUnlink:true }` | ADMIN | safe — inverse transitions + `ROLLBACK` audit | rollback writer `[TO BUILD]` |
| `PATCH /api/customers/:id` | Set canonical owner / displayName override | `{ canonicalOwnerId?, displayName? }` | ADMIN | idempotent update | `prisma.customer.update` |

**Wiring `[TO BUILD]`:** add a *customer-first* branch to the live global search bar
so a person-search resolves to customers (via `resolveCustomers`) before falling
through to standalone enquiries.

---

## 9. UI wireframes (textual)

References the already-built prototypes: the read-only **360 page**
(`src/app/(app)/customers/[id]/page.tsx`) and the **master-timeline client**
(`src/components/CustomerTimeline.tsx`).

### 9.1 Read-only Customer 360 (built)

```
┌─────────────────────────────────────────────────────────────────────┐
│ CUSTOMER                                              [ Active ]      │  status pill (computed)
│ Ravi Upadhyay                                                        │  computed displayName
│ 6f3a…-uuid (mono)                                                    │  immutable id
├─────────────────────────────────────────────────────────────────────┤
│  Owner of record   Enquiries   First enquiry   Last enquiry         │  computed summary card
│  Mehak Mukhija         2        12 Jun 2026     24 Jun 2026          │
│  Phones [+9170…][+9199…]   Emails [upadhyay84ravi@gmail.com]         │  union rollup (chips)
│  Properties enquired [Binghatti Skyflame][Binghatti Titania]        │
│  Sources [website][import]                                           │
│  ── Match confidence (computed) — 80% ──                            │  why-one-customer
│  [✓ Same email] [✓ Similar name]                                    │
├─────────────────────────────────────────────────────────────────────┤
│ Enquiries (2)                                                        │
│  Ravi · Binghatti Skyflame · website · Dubai   Mehak   [Fresh Lead] │  → links to /leads/:id
│  Ravi · Binghatti Titania · import · Dubai     Mehak   [Invalid No] │
├─────────────────────────────────────────────────────────────────────┤
│ Master timeline   [All][Calls][WhatsApp][Notes][Follow-ups][Merges]…│  filter chips (never remove)
│  ● 24 Jun 18:04  Enquiry linked to customer — "same email" — Lalit  │  CUSTOMER_LINKED (audit)
│  ● 24 Jun 10:12  Call logged — Connected — Mehak                    │  CALL_LOGGED
│  ● 12 Jun 09:30  Lead created — website                            │  LEAD_CREATED
├─────────────────────────────────────────────────────────────────────┤
│ Read-only · status/owner/confidence/summary computed live · not     │
│ editable here.                                                      │
└─────────────────────────────────────────────────────────────────────┘
```
**Desktop:** 4-up summary grid, full timeline rail. **Mobile:** summary collapses to
2-up; chips horizontally scroll; timeline is single-column (`CustomerTimeline` already
renders responsively).

### 9.2 Duplicate-detection popup `[TO BUILD]` (consolidated summary + 4 actions)

```
┌──────────────── Possible duplicate detected ─────────────────┐
│  Confidence: 80%  ·  Tier: VERY HIGH        [Safe Merge ✓]    │
│  Evidence: [✓ Same email] [✓ Similar name]                   │
│ ───────────────────────────────────────────────────────────  │
│             THIS enquiry            CANDIDATE                 │
│  Name       Ravi                    Ravi                      │
│  Email      upadhyay84ravi@…        upadhyay84ravi@…   ← match│
│  Phone      +917018120792           +919999999999 (junk⚠)    │
│  Project    Binghatti Skyflame      Binghatti Titania        │
│  Owner      Mehak                   Mehak                     │
│  Status     Fresh Lead              Invalid Number           │
│ ───────────────────────────────────────────────────────────  │
│  [ Add under existing customer ]   [ Merge customer records ]│
│  [ Create separate customer ]      [ Cancel ]                │
│  Reason (optional): […………………………]                            │
└──────────────────────────────────────────────────────────────┘
```
Medium-tier variant: header reads **MANUAL REVIEW**, the merge buttons are
de-emphasised, and a caption warns "similar name only — likely different people".
**Mobile:** the two-column diff stacks (this-then-candidate per field); actions become
a vertical button stack.

### 9.3 Inquiry-history table `[TO BUILD]` (within 360 / customer view)

A denser, sortable variant of the Enquiries block: columns *Date · Name · Project ·
Source · Owner · Status · [open]*, sorted newest-first, each row linking to
`/leads/:id`. Mobile → cards (date + name header, project/owner/status stacked).

### 9.4 Merged master-timeline with filter chips (built — `CustomerTimeline.tsx`)

Chips from `TIMELINE_CHIPS`: *All · Calls · WhatsApp · Notes · Assignments ·
Follow-ups · Status · AI · Imports/Exports · Created · Merges · Recycle*. Only chips
with ≥1 event render (plus "All"). Selecting a chip **filters** (events hidden, never
removed; default = All). Per-event coloured dot by taxonomy type. Mobile → chips
scroll horizontally; events single-column.

### 9.5 Admin link/merge review screen `[TO BUILD]`

```
┌──────────────── Customer link / merge review (ADMIN) ───────────────┐
│  Filter: [Safe Merge (2)] [Manual Review (11)] [All]   Team:[Dubai▾]│
│ ─────────────────────────────────────────────────────────────────── │
│  ▸ Ravi              2 enquiries  80% Very High  [Review →]          │
│      Binghatti Skyflame + Titania · same email                      │
│  ▸ Aksa behlim       2 enquiries  80% Very High  [Review →]  ⚠cross-owner
│  ▸ Saurabh           2 enquiries  25% Medium     [Review →]          │
│      Central Park Resorts / Paras Manor · similar name only         │
└─────────────────────────────────────────────────────────────────────┘
```
Clicking **Review** opens the §9.2 popup pre-filled with that group's evidence.
Mobile → list cards; Review opens the popup full-screen.

### 9.6 Migration-audit review screen `[TO BUILD]`

A read-only presentation of `customer-duplicate-audit-2026-06-26.md`: the 8 metrics,
the 2 Safe-Merge groups, the 11 Manual-Review groups, the junk-number key finding,
and a **per-group "approve link"** affordance (admin-only) used during P2d. Shows the
batch/throttle status during linking. Mobile → metric cards then grouped lists.

---

## 10. Migration strategy

The owner-approved sequence is **build → full read-only audit → present → approve →
link historical (reversibly) → validate → enable detection for new**. Each step is
non-destructive and independently reversible.

1. **Build (done).** Schema + computed layer + detection + 360 + link service exist on
   the branch; migration written, **not applied**.
2. **Full read-only audit (done — Step 2).** `customer-duplicate-audit-2026-06-26.md`,
   produced against production read-only, **no data modified**. Headline numbers to
   carry into the link phase:
   - **512** active leads analyzed (`deletedAt:null`).
   - **494 candidate Customers** (13 multi-enquiry groups + 481 singletons).
   - **31** enquiries inside multi-enquiry clusters; **18** duplicate enquiries.
   - **2 Safe-Merge** (Very-High, same-email): **Ravi** and **Aksa behlim**.
   - **11 Manual-Review** (Medium / similar-name-only): Saurabh, Gagan, Rahul, Sanjay,
     the size-6 "Unknown" artifact, Abhinav, Ankush/Ankur, Nikhil, Gaurav, Ajay, Siddharth.
   - **0 same-mobile clusters** after excluding **placeholder/junk numbers**.
3. **Present.** Surface the audit in the migration-audit review screen (§9.6) for the
   owner: 2 one-click Safe-Merge suggestions; 11 Manual-Review groups; the junk-number
   finding; the cross-owner caveat on Aksa behlim.
4. **Approve.** Owner explicitly approves which groups to link (default: only the 2
   Very-High, and only after the cross-owner owner-of-record decision for Aksa behlim).
5. **Link historical (reversibly).** For each approved group, create a `Customer` and
   `linkEnquiry` each member — writing the immutable audit per enquiry. **Reversible**
   at all times (bulk-unlink, §6).
6. **Validate.** Re-run the audit invariants + spot-check the linked customers' 360
   views; confirm enquiry counts/status/owner reconcile and no enquiry data changed.
7. **Enable detection for new enquiries.** Turn on the advisory detection popup for
   newly-created enquiries (admin-facing).

**Batch / throttle plan.** The historical link set is tiny (the audit links **31**
enquiries across **13** groups; the safe set is **2** groups / ~4 enquiries), so
linking is a handful of transactions — no large backfill. The plan still throttles:
process **one group per transaction**, sequentially, ≤ N groups/run, on Neon's
free-tier compute budget (see §11). Each transaction is small (1 `Lead.update` + 1
audit insert per enquiry).

**Junk-number guard applied BEFORE linking `[TO BUILD]`.** The audit found that the
placeholder **`9999999999`** falsely merged Ravi-B with an unrelated Supriya Jain on a
raw last-10 match; the audit excluded all-same-digit / ramp placeholders
(`0000000000`, `9999999999`, `1234567890`, …) before bucketing. The same guard MUST be
applied in the production dedup path (`lib/dedup`, `intelligenceCheck`, importer
dedup) and in the detection candidate-pool builder **before any historical link
runs**, so a dummy-numbered enquiry never drives a link. Blank / "Unknown" names are
likewise excluded from name-only clustering (the size-6 "Unknown" group is an
artifact, not a person).

---

## 11. Performance impact

**Detection cost — bucketed, not O(n²).** The audit's method is the template: bucket
candidates by normalized **last-10 phone** and **lowercased email**, then run the
detection engine only *within* a bucket (plus name-similarity blocking), assembling
clusters with union-find. This avoids the all-pairs comparison. For a single-enquiry
detection (the live popup), the candidate pool is just the same-bucket rows (already
role-scoped + `deletedAt:null`), typically a handful — `detectCandidates` is then
linear over that small pool.

**360 computed-on-read cost.** `getCustomer360` issues a bounded set of queries: one
`Customer` + scoped enquiries, one `Activity.findMany` (`take: 500`) across the linked
enquiries, one `CustomerLinkAudit.findMany` (`take: 200`). The compute functions are
pure and cheap (linear over the enquiry/activity arrays). For the expected scale
(customers have 2–6 enquiries), this is well within request budget.

**Caching options (if needed later).** Because everything is computed, caching is
*optional and safe to add last*: (a) per-request memoization (already implicit), (b)
short-TTL cache of the computed `Customer360` keyed by customer id + a cheap
"max(enquiry.updatedAt, lastAudit.performedAt)" stamp (invalidate when an enquiry or
link changes), (c) a denormalized **read-model** only if profiling demands it — but
never a *stored* status/owner (that would violate the single-source-of-truth rule;
any cache must be invalidatable and derived, never authoritative).

**New indexes.** `Lead(customerId)` (the sibling-lookup hot path) is built;
`Customer(canonicalOwnerId)` and the four `CustomerLinkAudit` indexes are built. For
detection-at-scale, *optional* functional indexes on the **last-10 phone** and
**lowercased email** buckets `[TO BUILD]` (e.g. an expression index) would make
bucketing index-assisted rather than scan-based.

**Expected query counts.** 360 page ≈ 3 queries + the `leadScopeWhere` CTE (managers
only). Search ≈ 2 queries (matching enquiries → their customers). Link/unlink = 1
transaction (1 read + 2 writes). Detection candidates = 1 scoped pool fetch.

**Neon free-tier considerations.** Per the memory note, Neon free tier pauses prod at
the compute-hour cap and CU-hours are driven by *compute-awake time*, not query count.
The Customer Layer adds **no new cron / no new always-on workload** — detection runs
on-demand on an admin's screen, and the historical link is a one-time, tiny, throttled
batch. It therefore does not materially change the compute-awake profile. (If the
Launch-tier upgrade lands first, this is a non-issue.)

---

## 12. Security review

- **Authz on every action.** Every mutating route (`link`, `unlink`, `merge`,
  `rollback`, `PATCH`) is **ADMIN-gated** (`requireUser()` + role check) before
  touching the service. The service helpers (`link.ts`) are `server-only` and assume
  the caller already proved authorization — routes must not bypass that.
- **No PII leakage across scopes.** Reads go through `leadScopeWhere(me)`: an agent
  sees only their own enquiries under a customer; a manager only their team's; a
  customer with no visible enquiry returns **null (not-found)**, never disclosing
  existence. The 360 summary/timeline are assembled *only* from the visible enquiries —
  an agent never sees a sibling enquiry (or its phone/email/remarks) owned by another
  agent.
- **Immutable audit.** `CustomerLinkAudit` is append-only — written once by the
  service, never updated or deleted; there is no update/delete path on it. This is the
  tamper-evident record behind every grouping.
- **No auto-merge.** Detection (`detect.ts`) is pure detect/score/recommend and writes
  nothing; only an admin decision through the audited service ever links. There is no
  code path that links/merges without a `performedById`.
- **Junk-number guard.** Placeholder/ramp numbers are excluded before bucketing so a
  dummy number can never drive a false link (§10) — both a data-integrity and a
  security control (prevents cross-person data exposure via a shared dummy number).
- **Soft-delete respected.** `deletedAt:null` is enforced in `leadScopeWhere`, and the
  detection engine defensively skips `deleted` candidates (`scoreCandidate` returns
  null). A recycle-binned enquiry never participates in detection, linking, or a 360
  view.
- **Rate-limit on detection `[TO BUILD]`.** The detection-candidates endpoint should be
  rate-limited per user (it reads a scoped pool); the live popup is naturally throttled
  by being admin-screen-driven, but the endpoint guard prevents abuse/scraping.

---

## 13. Edge cases

| Case | Handling |
|---|---|
| **Placeholder / junk phone** (`9999999999`, `0000000000`, ramps) | Excluded before bucketing (junk-number guard, §10). Confirmed in audit: prevents the false Ravi-B ↔ Supriya Jain merge. |
| **Same name, different person** (Saurabh, Gagan, Rahul…) | Name-only similarity → **Medium** tier → **Manual Review**, never auto-linked. The 11 audit groups are exactly this. |
| **Shared family phone** (two real people, one number) | Same-mobile raises confidence but **does not auto-link** — admin must confirm via the popup diff (different names/emails are visible). If genuinely different people, admin chooses "Create separate customer". |
| **One person, two emails** | `computeCustomerSummary` unions both emails; detection matches on *either* email (`emailsEqual` checks primary+alt both ways). Linking under one customer surfaces both in the rollup. |
| **Merged, then needs unlink** | `unlinkEnquiry` returns each enquiry to exact standalone state; the link's audit `prevCustomerId` is the restore key (§6). |
| **Enquiry converted, then customer needs split** | Conversion is a Lead status (not a customer property) — splitting = unlink the enquiry and link it under a new/other customer; the converted status rides with the enquiry (source of truth), so the split never loses the conversion. |
| **Multi-owner customer** | `computeCustomerOwner` returns `MULTIPLE` (rendered "Multiple Owners") until an admin pins `canonicalOwnerId`. A new differently-owned enquiry flips the computed owner to MULTIPLE — it never silently reassigns. (Audit's Aksa behlim is the live cross-owner case.) |
| **Enquiry soft-deleted after linking** | `leadScopeWhere` hides `deletedAt != null`, so the deleted enquiry drops out of the 360 summary/timeline and detection automatically (computed-on-read). The `customerId` link + its audit remain intact; restoring the enquiry brings it back into the customer with zero extra work. |
| **Circular / duplicate links** | Impossible by shape: `Lead.customerId` is a single nullable FK (an enquiry has at most one customer); re-linking to the same customer is a harmless no-op transition (re-reads current membership). A customer cannot reference a customer. |
| **Confidence ties** | Search ties break via the locked 6-step order (§ Search ranking); detection ties sort by `score desc` then `tierRank` (`detectCandidates`). Deterministic — pure functions, no `Date.now()`. |
| **Customer with zero visible enquiries** | `getCustomer360` returns `null` → not-found (no existence disclosure). |
| **"Unknown" / blank-name cluster** | Excluded from name-only clustering (artifact, not a person — audit's size-6 group). |

---

## 14. Regression checklist

Add the following invariants to `scripts/regression.ts` (read-only, pure where
possible — the customer compute/detect/search/timeline modules are import-safe), and
keep all Release 1 invariants green.

**New customer-layer invariants `[TO BUILD]`**
- **`customer-computed-layer-pure`** — `compute.ts` / `detect.ts` / `searchRank.ts` /
  `timelineEvents.ts` are pure: no `Date.now()`, no DB, no `server-only`; same inputs →
  same outputs (the existing `*.test.ts` assert this).
- **`customer-link-reversibility`** — in a rolled-back transaction: link then unlink
  returns the lead to `customerId = NULL`; two audit rows written with correct
  `prev/newCustomerId` transitions.
- **`customer-audit-immutability`** — no code path updates or deletes a
  `CustomerLinkAudit` row (service only creates).
- **`customer-permission-scoping`** — `getCustomer360` / `resolveCustomers` apply
  `leadScopeWhere`; a customer with no caller-visible enquiry resolves to null.
- **`customer-no-auto-merge`** — `detect.ts` performs no writes (detect/score/recommend
  only); linking requires a `performedById`.
- **`customer-additive-schema`** — `Lead.customerId` is nullable and defaults NULL;
  the migration is `IF NOT EXISTS`/guarded (additive only).
- **`customer-single-source-of-truth`** — the `Customer` model stores **no** computed
  value (no status/owner/health/phone column); only id + the two overrides + timestamps.
- **`customer-junk-number-guard`** `[TO BUILD]` — placeholder numbers are excluded from
  detection bucketing.

**Release 1 invariants kept green** — `active-board-exclusions`, `revisit-queue`,
the reframed `data-integrity-jun25`, the AL-Overdue == Leads-chip reconciliation,
plus the existing read-only invariant suite (76 checks at R1).

---

## 15. Deployment plan

Phased and additive. Each phase: **backup → tag → tests → deploy → verify → record
rollback point**. The Service-Worker cache is bumped on any phase that ships UI.

| Phase | Ships | Pre-deploy | Verify | Rollback point |
|---|---|---|---|---|
| **P2a — additive schema (empty)** | Apply `20260626120000_add_customer_layer` (2 tables + nullable column + indexes/FKs). **Zero data.** | DB backup; tag `r2-p2a-pre`; tsc + build + full regression incl. new customer invariants | `customerId` exists & NULL on all leads; `Customer`/`CustomerLinkAudit` empty; app health green; existing flows unchanged | `9406e23` (R1) |
| **P2b — read-only detection + 360** | Customer-first search wiring, 360 route/page, detection-candidates endpoint, admin review screens (read-only). **No link button live yet.** | tag `r2-p2b-pre`; SW bump; regression | 360 renders for a hand-linked test customer in a rolled-back tx / staging; search resolves; detection returns candidates; **no writes possible** | P2a |
| **P2c — run & present audit** | Migration-audit review screen populated from the read-only audit. | tag `r2-p2c-pre` | Owner can view the 2 Safe-Merge + 11 Manual-Review groups; numbers reconcile with `customer-duplicate-audit-2026-06-26.md`; still no production writes | P2b |
| **P2d — link historical (ON APPROVAL)** | Enable the link/merge/unlink/rollback routes; apply the **junk-number guard** first; link only owner-approved groups (default the 2 Very-High; resolve Aksa behlim owner-of-record first), throttled one group/transaction. | DB backup; tag `r2-p2d-pre`; dry-run in rolled-back tx | Each linked customer's 360 reconciles (enquiry count/status/owner); audit rows written; **bulk-unlink rehearsed**; no enquiry data changed | P2c (and bulk-unlink to restore `customerId=NULL`) |
| **P2e — detection for new enquiries** | Turn on the advisory duplicate-detection popup for newly-created enquiries (admin-facing). | tag `r2-p2e-pre`; SW bump; regression | New enquiry triggers advisory popup; still detect/recommend only; admin-gated link | P2d |

Throughout: additive + feature-flagged where possible; office-hours for the
schema/migration phase; risk-disclosure + explicit owner approval before P2d (the
only phase that writes production data), per the standing production-safety rule.

---

## 16. Rollback plan

Per-phase, with the guarantee that **no enquiry data is ever lost at any phase**
(the Customer Layer only *references* enquiries; it never moves their data).

| Phase | Rollback action | Why it's safe |
|---|---|---|
| **P2a (schema)** | Drop the additive objects: `DROP TABLE "CustomerLinkAudit"`, drop the `Lead.customerId` FK + index + column, `DROP TABLE "Customer"`. | The tables are empty and the column is nullable/unused — dropping changes zero existing rows. (Or simply leave the unused additive objects in place and un-deploy the app — equally safe.) |
| **P2b / P2c (read-only)** | Un-deploy the app to the prior tag; SW reverts on next load. | No production writes occurred — purely additive read surfaces. |
| **P2d (historical link)** | **Bulk-unlink**: set every linked `customerId = NULL` and append `UNLINK`/`ROLLBACK` audit rows (§6); optionally delete the (now-empty) `Customer` rows. Then un-deploy if needed. | Each enquiry returns to byte-for-byte its standalone state; its phones/status/owner/remarks/activities were never touched. The audit trail of what happened is preserved. |
| **P2e (new-enquiry detection)** | Feature-flag off the advisory popup; un-deploy. | Detection never wrote anything; turning it off is inert. |

**Data-loss guarantee.** At no phase is an enquiry merged-into, overwritten, or
deleted. Linking only sets a nullable pointer; unlinking clears it. Even a full
schema rollback (drop `Customer`) uses `ON DELETE SET NULL`, which detaches enquiries
rather than deleting them. The worst-case rollback is "every enquiry is standalone
again, exactly as before Release 2," with the immutable audit available for forensics.

---

## OPEN QUESTIONS (need the owner's decision)

1. **Who may link / merge?** Default in this design is **admin-only** for all mutating
   actions (matches the foundation's `link.ts` AUTH). Should **managers** be allowed to
   link/merge **within their own team's scope** (team-strict, like buyer-assign), or
   stay strictly admin-only?
2. **Auto-suggest threshold.** Detection already tiers Very-High / High / Medium.
   Should the live popup **only** surface **Very-High** (verified mobile/email) as a
   suggestion, or also surface **High**? And should **Medium** (similar-name-only) be
   shown at all in the live flow, or confined to the admin review screen?
3. **Read-only near-duplicate hint for agents?** Should an agent see a *non-actionable*
   "this person may already exist" hint on a lead they own (read-only, no link button),
   or is any duplicate surfacing strictly admin-only?
4. **Aksa behlim owner-of-record.** This Very-High safe-merge spans **two different
   owners**. Which owner should be pinned as `canonicalOwnerId` on merge — or should it
   intentionally compute to "Multiple Owners" until decided?
5. **Customer index page.** The legacy `/customers` route is a redirect to
   `/leads?filter=won`. For Release 2, should `/customers` become a real
   **customer-list/index** (search-first), and if so who can see it (admin-only, or
   scoped for all roles)?
6. **displayName policy.** Keep `displayName` **computed-by-default** (current design —
   most-recent/most-complete enquiry name) and let admins override only when needed, or
   require an explicit display name at customer-creation time?
7. **Health definition (when built).** Computed health is reserved in the taxonomy but
   not yet built. What inputs define it (recency of last activity, engagement count,
   status mix), and what are the band thresholds (e.g. Hot / Warm / Cold)?
8. **Manual-Review backlog.** Beyond the 2 Safe-Merge groups, do you want the 11
   Manual-Review groups worked during P2d (admin confirms each), or deferred to
   business-as-usual after the layer is live?
