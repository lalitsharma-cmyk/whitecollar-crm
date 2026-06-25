# Release 2 — Customer Layer · Implementation Design

**Status:** Design / review-ready · product decisions **LOCKED** (owner-approved 2026-06-26) · **NOT** built beyond the Step-1 foundation · NOT deployed
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

There is exactly **one canonical `Customer` per real person** — the layer never
creates a duplicate customer record for the same human. **Ownership stays at the
Enquiry level** (`Lead.ownerId`): linking enquiries under a customer never moves
ownership onto the customer (the customer's owner-of-record is *computed*, with an
optional admin pin — §1, §3, §4). With the Customer as the master entity, the CRM
adopts the **master-entity pattern** of Salesforce / HubSpot / Zoho / Dynamics:
the `Customer` is the master record and Leads/Enquiries are its child records,
surfaced through a dedicated **Customer Index** master module (§1, §9).

The architecture obeys one owner rule above all: **"everything that can be computed
should be computed; everything that must be stored should be immutable."** A
`Customer` stores almost nothing — only its UUID, an optional admin display-name
override, and an optional admin canonical-owner override. Its **lifecycle, owner,
confidence, contact rollup, health, last-activity and summary are all computed live
from the linked enquiries on every read**, so a new enquiry can never make a stored
value go stale. `displayName` is **computed by default and never stored** — the
nullable column exists *only* as an optional explicit admin override (a future
affordance), never auto-populated (decision 6, §1/§2).

**Lifecycle and Classification are two independent axes (refinement, 2026-06-26).** A
customer's **Lifecycle** (`Lead → Qualified → Customer → Inactive → Dormant → Merged`)
is **computed, never stored, and mutually exclusive** — exactly one at a time
(§"Customer States"). A customer's **Classification** (Investor / VIP / Blacklisted /
HNI / NRI / …) is an **independent, many-to-many set of admin-assigned tags** — a
customer may hold zero or many at once, alongside whatever the lifecycle is (so a person
can be **Dormant *and* Investor *and* VIP** simultaneously). `Investor` is therefore a
**tag, not a computed state**, and the vague `Active` state is dropped in favour of
`Inactive` (short window) and `Dormant` (long window). Classification is modelled by the
**reserved `Tag` + `CustomerTag` tables** — design-only, **NOT built in Release 2**,
purely additive, addable later with zero structural change (§"Reserved Tag data model").
**Health / AI / Relationship / Investment-Potential scores are reserve architecture
only** — inputs catalogued for the future, **no scoring and no schema column in Release
2** (decision 7; §"Reserved AI scoring"). The relationship itself is recorded in an
**immutable, append-only `CustomerLinkAudit`** that makes every grouping decision
explainable and exactly reversible.

Detection is advisory only: an engine **detects, scores, and recommends** duplicate
candidates, but **never auto-merges, auto-links, or deletes** — and **manual admin
review is mandatory: ALL detection results require admin approval before any
link/merge, with NO automatic merge, ever** (§3, §4, §10, §12). Linking, merging,
and unlinking are **ADMIN ONLY** (owner-locked 2026-06-26): managers and agents may
**not** mutate customers — their access is view-scoped only (§7). Detection drives
the admin flow by tier: **Very-High and High** candidates surface automatically in
the admin flow; **Medium** appears only inside a non-interrupting "Possible
Duplicates" review panel; **Low** is ignored (§3, §4, §9). Agents get a
**privacy-safe** generic hint only ("⚠ Possible duplicate exists — contact Admin if
required") — never the other customer's name, owner, phone, email, or any detail
(§7, §9, §12).

Linking and unlinking are always reversible (unlink restores the enquiry to its
exact standalone state). Nothing on the timeline is ever deleted; the UI
**filters** events, never removes them. The 360 view is permission-scoped: a viewer
sees only the enquiries under a customer that they are allowed to see.

The **Customer 360** is the master screen (§"Customer 360") — Name · Phone(s) · Email(s)
· **Lifecycle** · **Tags** *(reserved)* · **Health** *(reserved)* · Confidence ·
Duplicate score · Owner(s) · Enquiries · Properties · Activities · **Customer Timeline**
· Notes · Calls · WhatsApp · **AI Summary** *(reserved)* · **Investment History** *(computed
from converted enquiries)* · **Merge History** — extending the already-built read-only
360 page. It surfaces the **Customer timeline** (a **computed aggregate** of every
linked enquiry's activities **+** the customer-level link/merge events from
`CustomerLinkAudit`), distinct from the **Lead timeline** (the single-enquiry stream the
Lead detail still shows) — §"Customer Timeline vs Lead Timeline".

**Release 2 BUILD scope is unchanged and explicit (§"Release 2 build scope").** R2 ships
**only**: `Customer` (UUID) + nullable `Lead.customerId` + `CustomerLinkAudit` +
read-only detection + the Customer Index + the read-only Customer 360 + the admin
link/merge/unlink workflow + the audit-first migration. **Everything else is RESERVED**
(design-only, additive-later): the `Tag`/`CustomerTag` classification tables, the four
AI scores, AI Summary, and any tag UI. **Scalability guarantee:** every reserved feature
is a **new additive table/column or a pure compute helper**, addable in a later release
with **zero restructuring** of existing data; the only existing-table change R2 makes is
the additive nullable `Lead.customerId`.

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
| Read-only Customer 360 page (master screen — base to extend) | **Built** | `src/app/(app)/customers/[id]/page.tsx` |
| Master-timeline client (filter chips; never removes events) | **Built** | `src/components/CustomerTimeline.tsx` |
| Customer timeline = computed aggregate (⋃ enquiry Activity + CustomerLinkAudit; computed-on-read, NO new table) | **Built** (loader) | `src/lib/customer/query.ts` |
| Unit tests (compute / detect / search) | **Built** | `src/lib/customer/*.test.ts` |
| **HTTP API routes** (link / unlink / merge / detection-candidates / 360 / search) | **`[TO BUILD]`** | — |
| **Merge-two-customers** writer (link-not-collapse; re-parent enquiries) | **`[TO BUILD]`** | — |
| **Rollback / bulk-unlink** writer (`ROLLBACK` audit) | **`[TO BUILD]`** | — |
| **Duplicate-detection popup** UI (consolidated summary + 4 actions) | **`[TO BUILD]`** | — |
| **Admin link/merge review screen** | **`[TO BUILD]`** | — |
| **Migration-audit review screen** | **`[TO BUILD]`** | — |
| **Customer-first wiring into the live global search bar** | **`[TO BUILD]`** | — |
| **Customer Index — dedicated master module** (`/customers` list: Search · Filters · Lifecycle · Total enquiries · Last activity · Owner · Projects · Health) | **`[TO BUILD]`** (decision 5 — replaces the legacy redirect) | — |
| **Customer 360 `[TO BUILD]` blocks** (Duplicate score · Investment History [computed from converted enquiries] · fuller enquiry/notes/calls/WhatsApp surfacing) | **`[TO BUILD]`** (extends the built 360; no new stored field) | §"Customer 360" |
| **Customer Lifecycle** (computed: `Lead`/`Qualified`/`Customer`/`Inactive`/`Dormant`/`Merged`, mutually exclusive; `M`/`N` thresholds) | **Built (compute)** — `Inactive` state + `M` threshold new; wiring `[TO BUILD]`; deliberately NO schema field | `src/lib/customer/compute.ts` |
| **Customer Classification — `Tag` + `CustomerTag`** (M–N tags: Investor / VIP / Blacklisted / HNI / NRI / …) | **`[RESERVED / NOT BUILT IN R2]`** — 2 purely-additive new tables; design-only shape, addable later with ZERO existing-table change; NO `flags` column | §"Reserved Tag data model" |
| **Health Score · AI Score · Relationship Score · Investment Potential** (4 AI scores) | **`[RESERVED / NOT BUILT IN R2]`** — decision 7: computed-when-built (or additive cache); inputs catalogued; deliberately NO schema field | §"Reserved AI scoring" |
| **AI Summary** (relationship narrative on the 360) | **`[RESERVED / NOT BUILT IN R2]`** | §"Customer 360" / §"Reserved AI scoring" |
| **Tag management UI** (admin set/clear classification) | **`[RESERVED / NOT BUILT IN R2]`** — depends on the reserved tag tables | — |
| **Regression invariants for the customer layer** | **`[TO BUILD]`** | `scripts/regression.ts` |
| **Junk/placeholder-phone guard in the production dedup path** | **`[TO BUILD]`** (audit applied it locally; prod path still raw) | `lib/dedup`, `intelligenceCheck`, importer dedup |

> Note: a pre-existing `src/app/(app)/customers/page.tsx` (a redirect to
> `/leads?filter=won`) and the older `CustomerIntelligenceCard` / `customerHistory.ts`
> are the **legacy** "customers removed" stub and the per-lead duplicate-history
> feature — **not** the Customer Layer. The current `/customers` redirect is marked
> **to replace with the Customer Index** (decision 5): Release 2 swaps the redirect
> stub for a real, permission-scoped customer master list `[TO BUILD]`.
>
> **Scalability guarantee.** Every **`[RESERVED]`** feature above (Tag/CustomerTag, the
> 4 AI scores, AI Summary, tag UI) is realised as a **new additive table/column or a
> pure compute helper** — each can be added in a **later release with zero restructuring
> of existing data**. The only existing-table change Release 2 itself makes is the
> additive nullable `Lead.customerId`.

---

## 1. Customer Layer architecture

### The additive Customer ↔ Enquiry model

An **enquiry IS a `Lead`** — unchanged. The only structural addition to `Lead` is a
nullable `customerId`. A `Customer` is the canonical human; it is a parent that
groups enquiries. The relationship is strictly **1 Customer → many enquiries**
(one enquiry belongs to at most one customer). Every existing lead defaults
`customerId = NULL` = *standalone enquiry*, so introducing the layer changes the
meaning of zero existing rows.

**One canonical Customer per person (decision 4, LOCKED).** The layer never creates
a second `Customer` record for the same human, and it **never moves ownership onto
the customer**. Ownership lives — and stays — at the Enquiry level (`Lead.ownerId`):
each enquiry keeps its own owner, and the customer's "owner of record" is a
*computed* rollup (single shared owner, else `MULTIPLE`) with one optional admin
override (`canonicalOwnerId`). Grouping three enquiries under one customer therefore
re-parents nothing but a pointer and reassigns no agent.

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

### Customer Index — the master module (decision 5, LOCKED)

The Customer is the **master entity**; Leads/Enquiries are its **child records**.
This is the standard CRM master-entity pattern (Salesforce *Account/Contact* →
*Opportunity*; HubSpot *Contact* → *Deal*; Zoho *Contact* → *Deal*; Dynamics
*Contact* → *Opportunity*). Release 2 therefore ships a dedicated **`/customers`
master module** — a real customer list, **replacing the legacy `/customers`
redirect** (which currently sends to `/leads?filter=won`).

The Customer Index is a first-class list page (`[TO BUILD]`, §9.7) with:

| Column / control | Source |
|---|---|
| **Search** (name / phone / email) | `resolveCustomers` → `rankCustomerSearchRows` (customer-first) |
| **Filters** (owner / status / team / project / health) | computed rollups over the customer's enquiries |
| **Lifecycle** | computed customer **lifecycle** state — `Lead`/`Qualified`/`Customer`/`Inactive`/`Dormant`/`Merged` (§"Customer States"); mutually exclusive |
| **Tags** | classification tags (Investor / VIP / …) — **`[RESERVED / NOT BUILT IN R2]`**; column reserved, renders nothing until the tag tables ship |
| **Health** | computed-when-built (decision 7 — reserve only; column present, value pending) |
| **Total enquiries** | `count(enquiries)` |
| **Last activity** | `max(Activity.createdAt)` across linked enquiries |
| **Owner** | computed owner-of-record (single shared, else "Multiple"), or pinned `canonicalOwnerId` |
| **Projects** | union of `LeadInterestedProject` / discussed projects across enquiries |

Each row opens the read-only Customer 360 (§9.1). The index is **permission-scoped**
exactly like the 360 loader: a viewer sees only customers that have ≥1 enquiry
visible to them (`leadScopeWhere`), and a customer with no visible enquiry never
appears (no existence disclosure). It is a **read/navigation surface** — no
link/merge controls live here (those are admin-only and live in the review screens,
§9.5).

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
        ├─► computeCustomerStatus(enquiries)  ← lifecycle  ┐
        ├─► computeCustomerOwner(enquiries, canonical)     │  PURE — no DB,
        ├─► computeCustomerSummary(enquiries)              │  no Date.now(),
        ├─► confidenceFromEnquiries(enquiries)             │  deterministic
        ├─► computeDisplayName(enquiries, override)        ┘
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
  // NOTE: there is deliberately NO lifecycle / status / owner / health / score column —
  // those are all COMPUTED. Storing them would let a new enquiry make a persisted value
  // stale. Classification tags are NOT a column either: they live in the RESERVED
  // Tag/CustomerTag tables (§"Reserved Tag data model"), added in a LATER release with
  // zero change to this model. When the tag tables ship, the only addition here is a
  // back-relation:  // customerTags  CustomerTag[]   [RESERVED / NOT BUILT IN R2]
}
```

> **`displayName` policy (decision 6, LOCKED):** the display name is **computed by
> default and never stored**. The nullable `displayName` column is kept *only* as an
> optional explicit **admin override** (a future affordance); it is never
> auto-populated from an enquiry. Until an admin overrides it, the field stays NULL
> and the name is derived live by `computeDisplayName` (most-recent / most-complete
> enquiry name).
>
> **Health Score & AI scores (decision 7, LOCKED):** there is **no health column and no
> score column** and **no scoring computation in Release 2** — Health / AI / Relationship
> / Investment-Potential scores are *reserve architecture only* (§"Reserved AI scoring").
> The future inputs are catalogued there; when built each is a pure compute helper (no
> schema field, no redesign).
>
> **Classification tags = reserved tables, NOT a column (refinement 2026-06-26):**
> customer classification (`Investor` / `VIP` / `Blacklisted` / `HNI` / `NRI` / …) is
> **no longer** modelled as a `flags` column on `Customer`. It is modelled as a proper
> **many-to-many** via two **new reserved tables** `Tag` + `CustomerTag`
> (§"Reserved Tag data model") — **`[RESERVED / NOT BUILT IN R2]`**. `Customer` therefore
> gains **no** new column for classification; the tag tables are purely additive and
> land in a later release with zero change to this `Customer` model.

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

## Customer States — Lifecycle vs Classification (two independent axes)

**Refinement (owner-approved 2026-06-26).** A customer's "state" is **two
independent things**, not one. Conflating them is the mistake the
single-source-of-truth rule (§1) forces us to avoid:

1. **Customer Lifecycle** — *Where is this person in the funnel right now?* This is
   **derived from their enquiries**, so it **must be computed, never stored**, and it
   is **mutually exclusive** — a customer is in **exactly one** lifecycle state at any
   moment.
2. **Customer Classification** — *What standing labels does this person carry?* These
   are **human-assigned tags** that **cannot be computed** from enquiries, are
   **many-to-many** (a customer may hold zero or many at once), and are **independent
   of the lifecycle**.

**These are orthogonal axes.** A single customer can be — simultaneously — **Dormant**
(lifecycle) **and** an **Investor** **and** a **VIP** (classification). The lifecycle
answers "funnel position"; the classification answers "what kind of relationship this
is". One never constrains the other.

> **Key change vs the prior draft:** `Investor` is **no longer** a computed/lifecycle
> state — it is now a **classification tag**. The vague **`Active`** lifecycle state is
> **dropped**; a new **`Inactive`** state (short-window) is **added** between
> `Customer` and `Dormant`.

### A. Customer Lifecycle (COMPUTED live, NEVER stored, mutually exclusive)

Computed from the customer's linked enquiries on every read (alongside owner /
confidence in `compute.ts`). It is a single **precedence-ordered** value — the
highest-precedence condition that holds wins, so **exactly one** lifecycle state is
ever in effect:

```
Lead → Qualified → Customer → Inactive → Dormant → Merged
```

| Precedence | State | Holds when (over the linked enquiries) |
|:--:|---|---|
| 1 (highest) | **Merged** | the customer was merged into another (now has zero enquiries because they were re-parented to a survivor — §4 action 2). Terminal display state. |
| 2 | **Customer** | ≥1 enquiry is **converted / booked** (a won / booking lead status). |
| 3 | **Qualified** | ≥1 enquiry is **qualified** (≥1 qualified enquiry, BANT-qualified) and none is converted. |
| 4 | **Inactive** | **no recent engagement** — last `Activity` / contact older than the **short** window `M` days (but newer than `N`), and not already Customer/Qualified. *Short-term quiet.* |
| 5 | **Dormant** | **long-term inactivity** — last `Activity` / contact older than the **long** window `N` days, and not already Customer/Qualified. *Long-term quiet.* |
| 6 (lowest) | **Lead** | **only new / uncontacted** enquiries (no qualified/converted enquiry and no recorded activity yet). |

**Per-state definition (plain English):**
- **Lead** — only *new / uncontacted* enquiries; nothing has been worked yet.
- **Qualified** — at least **one qualified enquiry** exists (and none converted).
- **Customer** — at least **one converted / booked** enquiry exists.
- **Inactive** — **no recent engagement** within the *short* window (recency tripped at
  `M` days). Recoverable; just gone quiet recently.
- **Dormant** — **long-term inactivity** (recency tripped at the *long* window `N`
  days). Effectively cold.
- **Merged** — this customer was **merged into another** customer (its enquiries now
  live under the survivor). Terminal.

**Parameters (two thresholds — proposed defaults, owner to confirm):**
- **Precedence** = the order above (Merged → Customer → Qualified → Inactive → Dormant →
  Lead). This is the tie-breaker when more than one could apply.
- **`M` (Inactive threshold)** = days of no activity to become **Inactive** — **proposed
  default `M = 30` days** (short window).
- **`N` (Dormant threshold)** = days of no activity to become **Dormant** — **proposed
  default `N = 90` days** (long window). `N > M`.
- Both are **configurable settings/parameters**, not per-customer columns.

**Reconfirmed: computed live, never stored (Single Source of Truth).** The lifecycle is
recomputed every read from the current enquiry set, so adding/working/converting an
enquiry — or time simply passing — can never leave a *stored* value stale. There is
**no lifecycle column** on `Customer`.

### B. Customer Classification (INDEPENDENT, many-to-many TAGS — NOT lifecycle)

Classification is a set of **standing, human-assigned labels** that describe *what kind
of relationship* this person is. They are **independent of the lifecycle**, **many-to-
many** (a customer may carry **zero or many** at once), and **cannot be computed** from
enquiry data — so they are **stored** and audited (like `canonicalOwnerId`).

Candidate classification tags (seed set — extensible):

| Tag | Meaning |
|---|---|
| **Investor** | investor profile (was previously mis-modelled as a lifecycle/computed state — now a tag). |
| **VIP** | high-priority / VIP relationship. |
| **Blacklisted** | do-not-engage. |
| **HNI** | high-net-worth individual. |
| **Broker** | broker / channel partner. |
| **Developer** | developer-side contact. |
| **Corporate** | corporate / company buyer. |
| **NRI** | non-resident Indian. |
| **Golden Visa** | Golden-Visa interest / holder. |
| **Returning Customer** | repeat / returning customer. |
| **Referral Partner** | referral source. |
| *(…extensible)* | further admin-defined tags as needed. |

A customer holds **any subset** of these at once — e.g. `Investor + VIP + NRI`
alongside whatever the computed lifecycle currently is. Classification is **admin-
managed** (set/cleared by admins, fully audited).

**Modeled via reserved tag tables (DESIGN ONLY — not built in Release 2).** Rather than
a single `flags` string, classification is modelled as a proper **many-to-many** via two
**new** tables — see the reserved data model in §"Reserved Tag data model" below. These
are **purely additive** (new tables, no change to any existing table) and can be added
in a **later release with zero structural changes**.

---

## Reserved Tag data model — `[RESERVED / NOT BUILT IN R2]`

> **This entire section is DESIGN-ONLY.** The tables below are **reserved** — their
> shape is fixed now so a later release can add them **without any structural change**.
> They are **NOT created by the Release 2 migration** and **NOT in `schema.prisma`**.
> Release 2 ships **no tag tables, no `flags` column, and no tag UI** (see §"Keep
> Release 2 BUILD scope unchanged").

Classification (§B above) is modelled as a clean **many-to-many**: a `Tag` dictionary
plus a `CustomerTag` join. Both are **new tables** — **no existing table is altered**.

### `Tag` `[RESERVED]`

```prisma
// [RESERVED / NOT BUILT IN R2] — design-only shape; not in schema.prisma yet.
model Tag {
  id        String   @id @default(cuid())
  name      String   @unique            // "Investor", "VIP", "Blacklisted", "HNI", …
  category  String?                      // optional grouping (e.g. "profile" | "risk" | "segment")
  createdAt DateTime @default(now())

  customerTags CustomerTag[]
}
```

**Seed list** = the classification tags in §B (Investor, VIP, Blacklisted, HNI, Broker,
Developer, Corporate, NRI, Golden Visa, Returning Customer, Referral Partner, …).

### `CustomerTag` `[RESERVED]` (M–N join, audited / immutable-ish)

```prisma
// [RESERVED / NOT BUILT IN R2] — design-only shape; not in schema.prisma yet.
model CustomerTag {
  id         String   @id @default(cuid())
  customerId String                      // → Customer
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  tagId      String                       // → Tag
  tag        Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)
  addedById  String?                      // → User (who applied it) — audited
  addedBy    User?    @relation(fields: [addedById], references: [id], onDelete: SetNull)
  addedAt    DateTime @default(now())

  @@unique([customerId, tagId])           // a tag applies to a customer at most once
  @@index([customerId])
  @@index([tagId])
}
```

A `CustomerTag` row is **append-style and audited** (who added which tag, when); it is
**admin-managed**. Removing a classification is a deliberate admin action (and, when
built, would itself be audited in the same spirit as `CustomerLinkAudit`).

**Purely additive — addable later with NO structural change.** Both tables are **brand
new**; introducing them adds **zero** columns to `Customer`, `Lead`, or any existing
table. They can therefore land in a **future release** behind their own migration
without touching, restructuring, or backfilling any existing data — the data model here
simply **reserves the shape**.

---

## Customer Timeline vs Lead Timeline

The CRM now has **two** timeline concepts. They are deliberately different scopes, and
both obey the Single-Source-of-Truth rule (§1) — neither introduces a new stored table.

### Lead timeline (existing — enquiry-specific)

The **Lead timeline** is what the Lead detail page shows today: the `Activity` rows
**for that one enquiry** (calls, WhatsApp, notes, status changes, follow-ups, … on that
single `Lead`). It is scoped to **one enquiry** and is unchanged by Release 2. The Lead
detail page **keeps the Lead timeline** exactly as-is.

### Customer timeline (NEW — computed aggregate across all the customer's enquiries)

The **Customer timeline** is a **computed-on-read aggregate** — it is **not** a new
stored table. For a given customer it is the union of:

1. **every linked enquiry's `Activity` rows** — i.e. ⋃(Activity) across **all** the
   customer's enquiries (calls / WhatsApp / notes / status / follow-ups / imports / …),
   **and**
2. **customer-level events** — `link` / `unlink` / `merge` / `rollback` sourced from
   this customer's **`CustomerLinkAudit`** rows.

Properties:
- **Newest-first**, merged into a single stream.
- **Filterable by the locked 22-event taxonomy** (the same `TIMELINE_CHIPS` groups used
  by `CustomerTimeline.tsx`, §9.4) — Calls · WhatsApp · Notes · Assignments · Follow-ups
  · Status · AI · Imports/Exports · Created · **Merges** · Recycle.
- **Append-only and nothing hidden** — the UI **filters** events (chips), it **never
  deletes or suppresses** any event. Default view shows All.
- **Permission-scoped** — assembled only from the enquiries the viewer may see
  (`leadScopeWhere`), so an agent never sees a sibling enquiry's activity owned by
  someone else (§7, §12).
- **Computed-on-read (no new stored table)** — consistent with Single Source of Truth;
  it is recomputed from the current enquiry set + audit rows on every load, so it can
  never go stale (`getCustomer360` already gathers `Activity.findMany` across linked
  enquiries + `CustomerLinkAudit.findMany`, §"Data-flow", §11).

**Where each is shown.** The **Customer 360** (§"Customer 360", §9.1) shows the
**Customer timeline** (the aggregate). The **Lead detail** keeps the **Lead timeline**
(the single-enquiry stream). Same underlying `Activity` data, two different scopes.

---

## Customer 360 — the master screen

The **Customer 360** is the **master screen** of the Customer Layer: a single
read-only, permission-scoped view of one canonical person. A **read-only 360 page is
already built** (`src/app/(app)/customers/[id]/page.tsx` + `CustomerTimeline.tsx`,
§9.1) — this section specifies the **full** screen it grows into; Release 2 **extends
that existing page** (it does not start a new one). Everything here is **read-only**
and **scoped per viewer** (admin sees all; manager/agent see only their visible
enquiries under the customer — §7); a customer with no visible enquiry is **not-found**
(no existence disclosure).

### Fields (each marked built-vs-reserved)

| # | Field / block | What it shows | State |
|---|---|---|---|
| 1 | **Name** | computed `displayName` (admin override else most-recent/most-complete enquiry name) | **Built** (computed) |
| 2 | **Phone(s)** | union of phones across linked enquiries (chips) | **Built** (computed rollup) |
| 3 | **Email(s)** | union of emails across linked enquiries (chips) | **Built** (computed rollup) |
| 4 | **Lifecycle** | computed lifecycle badge — `Lead`/`Qualified`/`Customer`/`Inactive`/`Dormant`/`Merged` (§"Customer States" A); mutually exclusive | **Built** (computed; `Inactive` state new — wiring `[TO BUILD]`) |
| 5 | **Tags** | classification chips (Investor / VIP / Blacklisted / HNI / …) | **`[RESERVED / NOT BUILT IN R2]`** (tag tables) |
| 6 | **Health** | health score badge | **`[RESERVED]`** (decision 7 — renders "—") |
| 7 | **Confidence** | computed match-confidence % + reason chips ("why one customer") | **Built** (computed) |
| 8 | **Duplicate score** | top detection candidate's score/tier for this customer (admin-only evidence) | **`[TO BUILD]`** (uses built `detect.ts`) |
| 9 | **Owner(s)** | owner-of-record — single shared owner, else "Multiple"; per-enquiry owners listed | **Built** (computed; `canonicalOwnerId` pin override) |
| 10 | **Enquiries** | list of all linked enquiries (date · name · project · source · owner · status), each → `/leads/:id` | **Built** |
| 11 | **Properties** | union of `LeadInterestedProject` / discussed projects across enquiries | **Built** (computed union) |
| 12 | **Activities** | per-enquiry activity items feeding the timeline | **Built** |
| 13 | **Customer Timeline** | the computed aggregate stream (§"Customer Timeline vs Lead Timeline") — newest-first, 22-event chip filters, append-only | **Built** (computed-on-read) |
| 14 | **Notes** | notes across the linked enquiries | **Built** (within timeline / enquiries) |
| 15 | **Calls** | call logs across the linked enquiries | **Built** (within timeline / enquiries) |
| 16 | **WhatsApp** | WhatsApp activity across the linked enquiries | **Built** (within timeline / enquiries) |
| 17 | **AI Summary** | generated narrative summary of the relationship | **`[RESERVED]`** (§"Reserved AI scoring" — not built in R2) |
| 18 | **Investment History** | computed from the customer's **converted** enquiries (booked units / values) | **`[TO BUILD]`** (computed from converted-enquiry data; no new stored field) |
| 19 | **Merge History** | the customer's `CustomerLinkAudit` link/unlink/merge/rollback rows (who/when/why) | **Built** (from `CustomerLinkAudit`; merge/rollback writers `[TO BUILD]`) |

### Properties

- **Read-only.** No edit/link/merge controls live on the 360 — those are admin-only
  review screens (§9.5). The 360 is a **navigation + read** surface.
- **Permission-scoped per viewer** (§7) — every block is assembled from only the
  enquiries the caller may see; reserved blocks render a neutral placeholder ("—").
- **Computed-live** — lifecycle / owner / confidence / contact rollup / summary /
  Investment History are recomputed on read (no stored value to go stale).
- **Base to extend** — the already-built read-only 360 page (§9.1 wireframe) is the
  starting point; Release 2 adds the `[TO BUILD]` blocks (Duplicate score, Investment
  History, fuller enquiry/notes/calls/WhatsApp surfacing) and **reserves** the rest
  (Tags, Health, AI Summary) as placeholders.

---

## Reserved AI scoring — `[RESERVED / DESIGN-ONLY — NOT BUILT IN R2]`

> Four scores are **reserved architecture only**. Release 2 **does not build any of
> them** and adds **no schema column** for them (decision 7). When built, each is
> **COMPUTED** per the Single-Source-of-Truth rule (recomputed on read, never stored) —
> or, only if profiling ever demands it, a **clearly-additive optional cache** that is
> derived and invalidatable (never the authoritative value, never a stored status).

| Score | What it would express | Candidate inputs (all derivable / already-present) |
|---|---|---|
| **Health Score** | overall account health / engagement strength | last activity recency, days inactive (vs `M`/`N`), total enquiries, computed confidence, duplicate status, budget-filled completeness, documents present, AI score |
| **AI Score** | model-derived quality / intent signal | enquiry remarks/notes content, contact cadence, response signals, source quality, project fit, recency |
| **Relationship Score** | depth/warmth of the relationship over time | meeting/site-visit count, two-way contact frequency, tenure (first→last enquiry span), returning-customer signal, owner continuity |
| **Investment Potential** | likelihood/scale of (further) investment | converted-enquiry count & value (Investment History), budget band, HNI/Investor classification (reserved tag), number of projects engaged, Golden-Visa interest |

**Modeling note.** Each score, when built, is a **pure compute helper** in
`src/lib/customer/` (the same pattern as `computeCustomerStatus` / `confidenceFromEnquiries`)
taking the customer's enquiries (+ activities) and returning a number/band — **no new
`Customer` column**. An optional short-TTL derived cache (keyed by
`max(enquiry.updatedAt, lastAudit.performedAt)`, §11) may be added **last** if profiling
demands, but must remain invalidatable and derived — never authoritative.

---

## Release 2 build scope (unchanged + explicit)

The refinement above adds **design reserves only**; it does **not** widen what Release 2
builds. To be unambiguous:

### Release 2 BUILDS (only these)

- **`Customer`** model (immutable UUID + the two admin overrides).
- **Nullable `Lead.customerId`** FK (the **only** existing-table change — additive,
  defaults NULL).
- **`CustomerLinkAudit`** (immutable, append-only decision log).
- **Detection (read-only)** — `detect.ts` detect/score/recommend; **writes nothing**.
- **Customer Index** — the `/customers` master list (replacing the legacy redirect).
- **Read-only Customer 360** — the master screen (extending the built page).
- **Admin link / merge / unlink workflow** — admin-only, audited, reversible.
- **The audit-first migration** — build → read-only audit → present → approve → link
  historical (reversibly) → validate → enable detection (§10).

### RESERVED (design-only — additive-later, NO structural change, NOT built in R2)

- **`Tag` + `CustomerTag`** classification tables (Investor / VIP / Blacklisted / HNI /
  NRI / …) — purely additive new tables; **no `flags` column**.
- **Health Score · AI Score · Relationship Score · Investment Potential** — four AI
  scores; computed-when-built (or an additive optional cache); **no schema field in R2**.
- **AI Summary** on the 360.
- **Any tag-management UI.**

### Scalability guarantee (one line)

> **Every reserved feature is a NEW additive table/column (or a pure compute helper) —
> addable in a later release with ZERO restructuring of any existing data.** The only
> existing-table change Release 2 itself makes is the additive nullable `Lead.customerId`.

---

## Entity Relationship Diagram

Textual ERD for the whole CRM as it stands **with the Customer Layer added** (matching
the rendered **ERD v2**). Field names are grounded in the real schema: existing entities
from `prisma/schema.prisma` on `main`; the three Customer-Layer entities (`Customer`,
`Lead.customerId`, `CustomerLinkAudit`) from the foundation branch
`feat/customer-layer-foundation`; plus the **`[RESERVED]`** `Tag` / `CustomerTag` M–N
(classification — design-only, not built in R2).

**The ONLY schema change to an existing table is the additive nullable
`Lead.customerId`.** Every other entity below is **unchanged** by Release 2. The two
genuinely new tables built in R2 are `Customer` and `CustomerLinkAudit`; `Tag` and
`CustomerTag` are **reserved** (new additive tables, NOT built in R2) and the
**Customer timeline is an aggregate** (no stored table) — see notes below.

### Entities & key fields

- **Customer** *(NEW — master entity)*
  - `id` (UUID, immutable PK) · `canonicalOwnerId?` → User (admin owner override) ·
    `displayName?` (admin override; else computed) · `createdAt` · `updatedAt`
  - Computed-on-read (NOT columns): **lifecycle** (`Lead`/`Qualified`/`Customer`/
    `Inactive`/`Dormant`/`Merged` — mutually exclusive), owner-of-record, confidence,
    displayName, summary/contact-rollup, **health / AI / relationship / investment-
    potential scores** *(all RESERVED — §"Reserved AI scoring")*.
  - **1 → N** `Lead` (its enquiries) · **1 → N** `CustomerLinkAudit` · **`[RESERVED]` 1 →
    N** `CustomerTag` (classification — §"Reserved Tag data model").
  - **Customer timeline** is **not a stored relation** — it is a **computed aggregate**
    over the linked enquiries' `Activity` rows **+** this customer's `CustomerLinkAudit`
    events (§"Customer Timeline vs Lead Timeline").

- **Lead / Enquiry** *(existing + NEW `customerId?`)*
  - `id` (cuid PK) · `customerId?` → Customer *(**the only new existing-table
    column** — nullable, `onDelete: SetNull`)* · `ownerId?` → User (relation
    "LeadOwner") · `name` · `altName?` · `phone?` · `altPhone?` · `email?` ·
    `altEmail?` · `currentStatus?` · `source` (LeadSource) · `sourceDetail?` ·
    `followupDate?` · `leadOrigin` (default `ACTIVE_LEAD`) · `deletedAt?` (soft delete).
  - **Child of** Customer (`N → 1`, optional). Source of truth for all contact /
    activity / ownership data (never duplicated onto Customer).

- **CustomerLinkAudit** *(NEW — immutable, append-only)*
  - `id` (cuid PK) · `customerId?` → Customer · `leadId` → Lead ·
    `action` (text: `LINK` / `UNLINK` / `MERGE` / `ROLLBACK`) · `performedById?` →
    User · `performedAt` · `reason?` · `confidenceSnapshot?` · `matchFactors?` (Json) ·
    `previousOwnerId?` / `currentOwnerId?` (owner transition) · `prevCustomerId?` /
    `newCustomerId?` (membership transition — the reversibility key) ·
    `rollbackAvailable` (default true).
  - **N → 1** Customer · **N → 1** Lead · **N → 1** User (actor).

- **Tag** *(`[RESERVED / NOT BUILT IN R2]` — new dictionary table)*
  - `id` (cuid PK) · `name` (unique — `Investor` / `VIP` / `Blacklisted` / `HNI` /
    `Broker` / `Developer` / `Corporate` / `NRI` / `Golden Visa` / `Returning Customer` /
    `Referral Partner` / …) · `category?` · `createdAt`.
  - **1 → N** `CustomerTag`. Seeded with the classification set (§"Customer States" B).

- **CustomerTag** *(`[RESERVED / NOT BUILT IN R2]` — new M–N join, audited)*
  - `id` (cuid PK) · `customerId` → Customer · `tagId` → Tag · `addedById?` → User
    (who applied it) · `addedAt` · `@@unique([customerId, tagId])`.
  - **N → 1** Customer · **N → 1** Tag · **N → 1** User (actor). Realises the
    **many-to-many** customer ↔ classification relationship. **Purely additive** — adding
    these two tables changes **no** existing table (not even `Customer`).

- **User** *(Owner / actor — existing)*
  - `id` (cuid PK) · `email` · `name` · `role` (Role) · `team?` · `managerId?` (self-ref).
  - **1 → N** `Lead` (owns, via `ownerId`) · **0..1 → N** `Customer` (canonical owner,
    via `canonicalOwnerId`) · **1 → N** `Activity` (actor) · **1 → N**
    `CustomerLinkAudit` (actor) · self-ref **1 → N** `User` (manager → reports).

- **Activity** *(Timeline — existing)*
  - `id` (cuid PK) · `leadId` → Lead · `userId?` → User · `type` (ActivityType — the
    22-event taxonomy: CALL / WHATSAPP / EMAIL / SITE_VISIT / OFFICE_MEETING /
    VIRTUAL_MEETING / … / LEAD_CREATED / STATUS_CHANGE / ASSIGNMENT / …) · `status` ·
    `outcome?` · `followupDate?` · `scheduledAt?` / `completedAt?` · `createdAt`.
  - **Append-only** per enquiry. **N → 1** Lead, **N → 1** User. The customer master
    timeline is the union of Activity across the customer's linked enquiries.

- **Project** *(Property — existing)* ↔ **LeadInterestedProject** ↔ **Lead**
  - `Project`: `id` · `name` · `developer?` · `city` · `country` (default "UAE") ·
    `active` · `status` (ProjectStatus).
  - `LeadInterestedProject` (join): `id` · `leadId` → Lead · `projectId` → Project ·
    `@@unique([leadId, projectId])`.
  - **N – N** between Lead and Project ("enquired / interested"), modelled through the
    `LeadInterestedProject` join row.

- **Per-enquiry detail (existing, unchanged) — each `1 → N` from Lead:**
  - **CallLog** (`leadId?` → Lead, `userId` → User, `direction`, `outcome`,
    `startedAt`).
  - **Note** (`leadId` → Lead, `userId?` → User, `body`, `createdAt`).
  - **LeadFieldHistory** (`leadId` → Lead, `field`, `oldValue?`/`newValue?`,
    `changedById?` → User, `changedAt`).
  - **Assignment** (`leadId` → Lead, `userId` → User, `reason?`, `assignedAt`).

### Relationships & cardinality (summary)

```
User ──1:N──< Lead            (Lead.ownerId → User ; "LeadOwner")
User ──0..1:N──< Customer      (Customer.canonicalOwnerId → User ; admin override)
User ──1:N──< Activity         (Activity.userId → User)
User ──1:N──< CustomerLinkAudit(CustomerLinkAudit.performedById → User ; actor)
User ──1:N──< User             (self-ref: manager → reports)

Customer ──1:N──< Lead         (Lead.customerId → Customer ; NULLABLE, SetNull)  ◄── the ONLY new existing-table column
Customer ──1:N──< CustomerLinkAudit

Lead ──1:N──< Activity         (Activity.leadId → Lead)
Lead ──1:N──< CallLog          (CallLog.leadId → Lead)
Lead ──1:N──< Note             (Note.leadId → Lead)
Lead ──1:N──< LeadFieldHistory (LeadFieldHistory.leadId → Lead)
Lead ──1:N──< Assignment       (Assignment.leadId → Lead)
Lead ──1:N──< CustomerLinkAudit(CustomerLinkAudit.leadId → Lead)

Lead >──N:N──< Project         via LeadInterestedProject (interested / enquired)

# ─── RESERVED (design-only; NOT built in R2 — additive-later, zero existing-table change) ───
Customer >──N:N──< Tag         via CustomerTag (classification: Investor/VIP/…)   [RESERVED]
Customer ──1:N──< CustomerTag  (CustomerTag.customerId → Customer)                [RESERVED]
Tag      ──1:N──< CustomerTag  (CustomerTag.tagId → Tag)                          [RESERVED]
User     ──0..1:N──< CustomerTag (CustomerTag.addedById → User ; who tagged)      [RESERVED]

# ─── COMPUTED AGGREGATE (no stored table) ───
Customer ⇐⇐ Customer Timeline  = ⋃(Activity over linked Leads) ∪ (this Customer's CustomerLinkAudit), computed-on-read
```

**Explicit statement:** the introduction of the Customer Layer changes **exactly one
existing table** — it adds the nullable `Lead.customerId` foreign key. `Customer` and
`CustomerLinkAudit` are the new tables built in R2; **all other entities (User, Activity,
Project, LeadInterestedProject, CallLog, Note, LeadFieldHistory, Assignment) are
unchanged.** The **`[RESERVED]`** `Tag` / `CustomerTag` pair (classification M–N) is
**not built in R2**; when it lands later it is **two purely additive new tables** that
change **no** existing table (not even `Customer`). The **Customer timeline** is a
**computed-on-read aggregate** (union of the linked enquiries' `Activity` plus this
customer's `CustomerLinkAudit` events) — **not a new stored table.**

---

## 3. Customer Linking workflow

Linking groups one or more enquiries under a single canonical customer. **ADMIN ONLY**
(decision 1, LOCKED — managers and agents may not link/merge/unlink). It produces
**one canonical customer per person** and **never moves ownership** off the enquiry
(decision 4). **Manual admin review is mandatory** (decision 8): every detection
result requires explicit admin approval before any link/merge — there is **no
automatic link or merge, ever**. The full path is
*detect → recommend → admin reviews → admin approves → admin links*.

**Tier → where it surfaces (decision 2, LOCKED).** Detection tiers candidates
**Very-High / High / Medium / Low**:

| Tier | Trigger (factors) | Surfaced where |
|---|---|---|
| **Very-High** | verified `sameMobile` or `sameEmail` | **automatically in the admin flow** (offered as *Safe Merge*) |
| **High** | `sameAlternateNumber` | **automatically in the admin flow** (Manual Review) |
| **Medium** | `similarName` only | **only** inside the non-interrupting **"Possible Duplicates" review panel** — never interrupts workflow |
| **Low** | weaker / below threshold | **ignored** (not surfaced) |

**Step-by-step**

1. **Detect (advisory).** When an admin opens a candidate enquiry (or the
   detection review screen `[TO BUILD]`), the server fetches a role-scoped,
   `deletedAt:null` candidate pool and calls `detectCandidates(lead, pool)`
   (`detect.ts`). This returns scored `DetectMatch[]` (strongest first) with tier
   (`Very High` / `High` / `Medium` / `Low`), score (0–100), reasons, and the raw
   factors. **It writes nothing.**
2. **Recommend (by tier — decision 2).** The UI surfaces candidates according to
   their tier: **Very-High** and **High** appear **automatically in the admin flow**
   (Very-High labelled **Safe Merge**, High as **Manual Review**); **Medium** appears
   **only** in the non-interrupting **"Possible Duplicates" review panel** and never
   interrupts the workflow; **Low is ignored**. No action is ever pre-selected and
   **nothing auto-links or auto-merges** — admin approval is mandatory (decision 8).
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

When detection surfaces a likely-duplicate, the **admin** (ADMIN ONLY — decision 1)
sees a **duplicate-detection popup** with a consolidated summary and **four
actions**. Every action requires the admin's explicit decision — **manual review is
mandatory and nothing is ever auto-merged** (decision 8). Every action is
**link-not-collapse**: no enquiry row is ever merged into another, overwritten, or
deleted. "Merge" means *re-parent enquiries under one Customer*, never destroy one,
and **never reassigns ownership** (owner stays at the enquiry — decision 4).

**Where each tier shows up (decision 2):** **Very-High** and **High** drive this
popup automatically in the admin flow (Very-High → *Safe Merge*; High → *Manual
Review*). **Medium** does **not** raise this popup — it is confined to the
non-interrupting **"Possible Duplicates" review panel** (§9.2 variant). **Low** is
ignored.

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
  (verified mobile/email); `High` shows **Manual Review**; `Medium` is not shown here
  at all — it lives only in the "Possible Duplicates" review panel (decision 2), and
  `Low` is never surfaced. Whichever action the admin picks, it only takes effect on
  their explicit confirmation (no auto-apply — decision 8).

**Confidence + reasons** are computed by `computeCustomerConfidence`
(`sameMobile`+60, `sameEmail`+55, `sameAlternateNumber`+35, `similarName`+25,
`sameCompany`+20; clamped 0–100) and tiered by `tierForFactors`
(`sameMobile || sameEmail` → **Very High** → auto-surface; `sameAlternateNumber` →
**High** → auto-surface; `similarName` → **Medium** → review-panel-only; anything
weaker → **Low** → ignored). The score shown in the popup is snapshotted into
`confidenceSnapshot` if the admin proceeds, so the decision stays explainable even as
the data later changes.

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

**LOCKED (decision 1):** **Customer link / merge / unlink — and every customer
mutation — is ADMIN ONLY.** Managers and agents may **not** link, merge, unlink, edit
overrides, or run detection. Their access to the Customer Layer is **view-scoped
only**. This supersedes the prior "manager team-scoped linking?" open question — the
answer is **no**.

Read access is grounded in `leadScopeWhere(me)` (`src/lib/leadScope.ts`): **ADMIN** →
all leads (no filter, `deletedAt:null`); **MANAGER** → team-scoped (`forwardedTeam`
matches `normalizeTeam(me.team)` — strict, a Dubai manager never sees India leads);
**AGENT** → own leads only (`ownerId === me.id`). The Customer-360 loader already
enforces this: a customer with **no enquiry visible to the caller** returns `null`
(treated as not-found, never disclosing existence).

`SUPER-ADMIN(admin)` below = the `ADMIN` role (the highest role in this CRM).

| Capability | AGENT | MANAGER | SUPER-ADMIN (admin) |
|---|:--:|:--:|:--:|
| **View 360 page** | ✅ scoped — only customers with ≥1 of *their own* enquiries; sees only their own enquiries/events under it | ✅ scoped — customers with ≥1 *team* enquiry; sees only team enquiries/events | ✅ full — every customer, every enquiry/event |
| **View Customer Index (`/customers`)** | ✅ scoped (own-enquiry customers only) | ✅ scoped (team customers only) | ✅ full |
| **See which enquiries belong to a customer** | own only (others hidden) | team only | all |
| **Link an enquiry under a customer** | ❌ | ❌ | ✅ **only** |
| **Unlink an enquiry** | ❌ | ❌ | ✅ **only** |
| **Merge customer records** | ❌ | ❌ | ✅ **only** |
| **Roll back / bulk-unlink** | ❌ | ❌ | ✅ **only** |
| **Edit canonical owner / displayName override / admin flags** | ❌ | ❌ | ✅ **only** |
| **Run detection (advisory candidates)** | ❌ | ❌ | ✅ **only** |
| **See a duplicate *hint*** | 👁️ **privacy-safe generic only** — "⚠ Possible duplicate exists — contact Admin if required"; **never** the other customer's name/owner/phone/email/any detail (decision 3) | ❌ (no hint by default) | ✅ full evidence + actions |
| **Run the migration audit / bulk detection report** | ❌ | ❌ | ✅ **only** |

Every mutating action **and** running detection are **admin-only**, matching the
foundation's stated AUTH (`link.ts`: "ADMIN-only"). The **only** non-admin duplicate
surfacing permitted is the agent's **privacy-safe generic hint** (decision 3): it may
say a possible duplicate exists and to contact Admin, but must **never** expose the
other customer's name, owner, phone, email, or any other detail — see §9 and §12. The
**360 view and Customer Index are always permission-scoped per viewer**, independent
of who may mutate.

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
| `PATCH /api/customers/:id` | Set canonical owner / displayName override (and, when built, admin flags) | `{ canonicalOwnerId?, displayName?, flags? `[TO BUILD]` }` | ADMIN | idempotent update | `prisma.customer.update` |

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
│ CUSTOMER                                  [ Lead ]  Tags:[ — ]       │  lifecycle pill (computed) · Tags reserved
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
│ Read-only · lifecycle/owner/confidence/summary computed live · not   │
│ editable here. Tags/Health reserved (render "—" until built).        │
└─────────────────────────────────────────────────────────────────────┘
```
> The pill shows the **computed lifecycle** (here `Lead` — Ravi has recent activity but
> no qualified/converted enquiry, so the precedence falls through to the lowest state).
> **Tags** (classification) and **Health** render a neutral "—" — both are reserved (not
> built in R2). The full Customer 360 field list is in §"Customer 360".

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
**High-tier variant:** header reads **MANUAL REVIEW** (auto-surfaced in the admin
flow alongside Very-High — decision 2); Safe-Merge is not offered, the merge buttons
stay available but un-highlighted. **Mobile:** the two-column diff stacks
(this-then-candidate per field); actions become a vertical button stack.

**Medium tier does NOT raise this popup.** Per decision 2, `Medium`
(similar-name-only) is shown **only** inside the non-interrupting **"Possible
Duplicates" review panel** (an admin-only, collapsible side panel / tab that lists
medium-confidence groups for optional review — it never interrupts the workflow and
never auto-selects an action). The caption there warns "similar name only — likely
different people". `Low` is never surfaced.

### 9.2a Agent privacy-safe duplicate hint `[TO BUILD]` (decision 3)

The **only** duplicate surfacing an AGENT ever sees on a lead they own. It is a
generic, non-actionable banner — **no other-customer detail, no link button**:

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠ Possible duplicate exists — contact Admin if required.     │
└──────────────────────────────────────────────────────────────┘
```

It MUST NOT reveal the other customer's name, owner, phone, email, project, status,
or even how many duplicates exist — only that one *may* exist. (Managers see no hint
by default.) The full evidence diff + the four actions are admin-only (§9.2). This is
both a UX and a **security control** (§12).

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

### 9.7 Customer Index — master module `[TO BUILD]` (decision 5)

Replaces the legacy `/customers` redirect with the customer **master list** (§1).
Customer is the master entity; Leads/Enquiries are its child records (Salesforce /
HubSpot / Zoho / Dynamics pattern). Permission-scoped per viewer (own / team / all).

```
┌──────────────────── Customers (master) ────────────────────────────────────┐
│ [ Search name / phone / email …… ]  Owner:[All▾] Lifecycle:[All▾] Proj:[▾]  │
│ ─────────────────────────────────────────────────────────────────────────  │
│  Name            Lifecycle  Enq  Last activity  Owner    Projects   Health  │
│  Ravi Upadhyay   Lead        2   24 Jun 2026    Mehak    Binghatti… [ — ]   │
│  Aksa behlim     Qualified   2   22 Jun 2026    Multiple  Sobha…    [ — ]   │
│  Saurabh         Inactive    1   18 Jun 2026    Tanuj     Central…  [ — ]   │
│  …                                                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

Columns: **Search · Filters · Lifecycle · Total enquiries · Last activity · Owner ·
Projects · Health**. The **Lifecycle** column is the computed, mutually-exclusive state
(`Lead`/`Qualified`/`Customer`/`Inactive`/`Dormant`/`Merged`, §"Customer States" A).
Each row → the read-only Customer 360 (§9.1). **Health** column is present but
**value-pending** (decision 7 — reserve only; renders "—" until built); a **Tags**
column (classification) is likewise **reserved** and omitted from R2. **No link/merge
controls** here — those are admin-only review screens (§9.5). Mobile → one card per
customer (name + lifecycle header; enquiries/owner/last-activity stacked).

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
4. **Approve (manual review mandatory — decision 8).** An **admin** must explicitly
   approve which groups to link (default: only the 2 Very-High, and only after the
   cross-owner owner-of-record decision for Aksa behlim). **No group is ever
   auto-linked or auto-merged** — every historical link, like every live link, passes
   through explicit admin approval. (Approval is admin-only — decision 1.)
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
- **No auto-merge — manual admin review mandatory (decision 8).** Detection
  (`detect.ts`) is pure detect/score/recommend and writes nothing; **every** link and
  merge requires explicit admin approval through the audited service. There is **no
  automatic merge, ever**, and **no** code path that links/merges without a
  `performedById`. All four popup actions (and all historical links, §10) take effect
  only on the admin's confirmation.
- **Admin-only mutations (decision 1).** Link / unlink / merge / rollback / override
  edits and running detection are **ADMIN ONLY**; managers and agents are view-scoped.
  The mutating routes (§8) all enforce a role check before calling the service.
- **Agent duplicate hint is privacy-safe (decision 3).** The only duplicate surfacing
  a non-admin ever receives is the agent's **generic** hint ("⚠ Possible duplicate
  exists — contact Admin if required"). It MUST NOT leak the other customer's name,
  owner, phone, email, project, status, or even the duplicate count — preventing
  cross-scope PII disclosure via the dedup surface. Full evidence + actions stay
  admin-only.
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
  value (no **lifecycle**/status/owner/**health**/**score**/phone column) and **no
  classification `flags` column**; only id + the two overrides + timestamps. (The
  classification `Tag`/`CustomerTag` tables and the AI scores are RESERVED, not in the
  R2 schema — §"Reserved Tag data model", §"Reserved AI scoring".)
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

## LOCKED DECISIONS (owner-approved 2026-06-26)

The prior open questions are now **owner-approved decisions** and are folded throughout
this document. Summary (decisions 1–8 locked 2026-06-26; decision 9 = the 2026-06-26
refinement):

1. **Customer Link & Merge = ADMIN ONLY.** Managers and agents may **not**
   link/merge/unlink or run any customer mutation — they are **view-scoped only**.
   (§7 Permission Matrix; §8 routes; §12.)
2. **Auto-suggest thresholds.** **Very-High AND High** → surface **automatically** in
   the admin flow. **Medium** → only inside a non-interrupting **"Possible
   Duplicates" review panel** (never interrupts workflow). **Low** → **ignored**.
   (§3, §4, §9.)
3. **Agent duplicate hint = privacy-safe.** Agents see **only** a generic "⚠ Possible
   duplicate exists — contact Admin if required" — **never** the other customer's
   name, owner, phone, email, or any detail. (§7, §9.2a, §12.)
4. **One canonical Customer; ownership at the Enquiry level.** Never create duplicate
   customer records for the same person; never move ownership onto the customer.
   (§1, §3, §4.)
5. **Customer Index = dedicated master module.** A real `/customers` list (Search ·
   Filters · **Lifecycle** · Total enquiries · Last activity · Owner · Projects ·
   Health) where Customer is the master entity and Leads/Enquiries are child records
   (Salesforce / HubSpot / Zoho / Dynamics pattern); the legacy redirect is **to
   replace**. Permission-scoped. (§1, §9.7.)
6. **displayName = computed by default**, never stored unless an admin explicitly
   overrides (future); the nullable column remains only as that optional override.
   (§1, §2.)
7. **AI scores = reserve architecture only** — **Health Score · AI Score · Relationship
   Score · Investment Potential** are **not** implemented in Release 2 (computed-when-
   built; deliberately NO schema column; inputs catalogued in §"Reserved AI scoring").
   (§1; built-vs-to-build table.)
8. **Manual review mandatory.** **ALL** detection results require admin approval
   before any link/merge; **NO automatic merge, ever**. (§3, §4, §10, §12.)
9. **Lifecycle and Classification are TWO INDEPENDENT axes (refinement 2026-06-26).**
   - **Customer Lifecycle = COMPUTED, never stored, mutually exclusive (exactly one):**
     `Lead → Qualified → Customer → Inactive → Dormant → Merged`. (`Active` dropped;
     `Inactive` added.) Two thresholds — **Inactive = `M` days (proposed 30)**,
     **Dormant = `N` days (proposed 90)**. (§"Customer States" A.)
   - **Customer Classification = INDEPENDENT, many-to-many admin TAGS:** Investor / VIP /
     Blacklisted / HNI / Broker / Developer / Corporate / NRI / Golden Visa / Returning
     Customer / Referral Partner / … — a customer may hold zero or many at once,
     orthogonal to lifecycle. **`Investor` is a tag, not a computed state.** Modelled via
     the **reserved `Tag` + `CustomerTag` tables** — purely additive, **NOT built in R2**,
     addable later with zero structural change (**no `flags` column**). (§"Customer
     States" B; §"Reserved Tag data model".)
   - **Customer 360** is the master screen, surfacing the **computed Customer timeline**
     (aggregate of all enquiries' activities + `CustomerLinkAudit`), distinct from the
     enquiry-scoped **Lead timeline**. (§"Customer 360"; §"Customer Timeline vs Lead
     Timeline".)

---

## Remaining open items

The product decisions above are locked. The following genuinely still need owner
input (or are deferred), and are *not* blockers for the design being review-ready:

1. **Lifecycle thresholds `M` / `N` (§"Customer States").** The lifecycle axis is now
   locked as **`Lead → Qualified → Customer → Inactive → Dormant → Merged`** (computed,
   mutually exclusive). The only items left to **confirm** are the two day-thresholds:
   **Inactive = `M` days (proposed `M = 30`)** and **Dormant = `N` days (proposed
   `N = 90`)**, with `N > M`. The classification axis is settled as **reserved tags**
   (`Tag` / `CustomerTag`, not built in R2) — no `flags` column is contemplated.
2. **Aksa behlim owner-of-record (operational, P2d).** This Very-High safe-merge spans
   **two different owners**. Which owner is pinned as `canonicalOwnerId` on merge, or
   does it intentionally compute to "Multiple Owners" until decided? (Resolve before
   linking this specific group — §10 step 4.)
3. **Manual-Review backlog (operational, P2d).** Beyond the 2 Safe-Merge groups, work
   the **11 Manual-Review** groups during P2d (admin confirms each), or defer to
   business-as-usual after the layer is live?
4. **AI score inputs/bands (future — decision 7).** When the reserved scores (Health /
   AI / Relationship / Investment Potential) are eventually built, confirm the exact
   input weighting and band thresholds. Out of scope for Release 2 (reserve only).
