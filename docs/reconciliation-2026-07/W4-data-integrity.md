# W4 — Data Integrity Audit (Workstream 6 / Audit-4)

**Date:** 2026-07-17 · **DB:** Neon Postgres (prod) · **Mode:** STRICTLY READ-ONLY
**Method:** three temp `scripts/_audit_data_*.ts` probes (SELECT / `count` / `groupBy` / `findMany({take})` only), run via `npx tsx`, deleted after each run. **Every query executed was a READ — zero UPDATE/DELETE/INSERT/executeRaw.**

**Population:** 6,188 leads total · **3,856 live** (non-deleted) · 2,332 soft-deleted. 4,204 call logs · 1,014 live buyer records (+1,088 soft-deleted). Status sets from `src/lib/lead-statuses.ts`: TERMINAL=37 (CLOSED 11 + LOST 26).

---

## Headline verdict

The two rule-compliance items most likely to be real findings — **Lost/Rejected still assigned** and **follow-up on terminal records** — are both at **ZERO**. Their idempotent backfill scripts have already run and prod is clean. Phone normalization is also fully backfilled (0 gaps). **No broken foreign keys, no corrupted serial dates, no broken buyer conversions.**

The remaining findings are **duplicates** (needs human link/merge decisions) and **duplicate activity-log rows** (timeline noise). Nothing here is a silent-corruption emergency.

### Bucket summary

| Bucket | Items |
|---|---|
| ✅ **CLEAN / already auto-fixed** | Lost/Rejected unassign (0), terminal-followup (0), phone normalization (0), Excel serials (0), orphan FKs (0), module coherence, callLog module-linking (0) |
| 🟡 **NEEDS LALIT (ambiguous — no silent change)** | Duplicate customers (phone + email link/merge), duplicate activity rows dedup, `+91`-only leads with no real number |
| ⚪ **FYI / NO ACTION (expected buckets, not defects)** | createdTimeKnown=false (import-fidelity), untriaged missing-status, Revival-pool unassigned, attempt/ghosting pending backfill, soft-deleted buyers |

### Top 5 issues by row-count

1. **Duplicate activity-log rows** — 360 excess rows across 321 groups (Check 11)
2. **Email duplicate groups** — 54 leads in 25 groups (~14 older-genuine) (Check 1b)
3. **Phone duplicate groups** — 45 leads in 14 groups (24 genuine) (Check 1a)
4. **`+91`-only leads (no real phone number)** — 18 live leads (Check 1a degenerate)
5. **Rejected leads missing Previous Owner** — 8 leads (Check 5, low severity)

---

## Check 1 — Duplicate customers

### 1a. Phone (`phoneCanonical` shared across >1 live lead)
**14 groups / 45 leads.** Classified:

- **12 GENUINE groups / 24 leads** — proper 12-digit canonicals (91/971 + national). These are real candidate duplicates. Examples:
  - `cmrhnit8q…` / `cmrhnitkg…` **Pukar** (…9542) — two India leads created 07-06 & 07-07, both null-status → accidental double-entry.
  - `cmrau83xp…` / `cmraq08vq…` **Chitranshu** (…7786, also shares email) — same-day Dubai double-entry.
  - `cmqdggak5…` (**Niraj**, created 2020-11-22) / `cmr7t8dv3…` (**Niraj**, 07-05, "Needs Review", …4328) — old record re-imported.
  - `cmqt7yn19…` **Gaurav Sharma** / `cmrm7fzeq…` **Unknown** (…9520) — matches baseline group 2.
- **2 DEGENERATE groups / 21 leads (NOT real dups):**
  - **18 leads** whose phone is literally **`+91`** (country code only, no number) → canonical collapses to `"91"`. Confirmed: raw phone = `+91` for all sampled. These are 18 *distinct* people with a **missing phone number**, not duplicates. Owned across Dubai+India. Sample ids: `cmqc1qdpq…` Mohammed, `cmrehtpwo…` Hudaifa, `cmrbl9plo…` Gurjeet, `cmrehpe0c…` Marwan, `cmr8s7hc3…` Anjali.
  - **3 leads** on a `…9999` placeholder (9999999999-type test number): `cmr1mjtm…` Abc (Junk), `cmqw51yvk…` Sameer, `cmqt6ngls…` Ravi (Invalid).

**Bucket:** MANUAL REVIEW / NEEDS LALIT. Genuine dups → **Link** via Customer Identity Center (reversible virtual profile, `src/lib/customer/link.ts`) or **Merge** (irreversible → explicit approval). The 18 `+91`-only leads are a **data-entry gap** (re-collect number), not a merge.

### 1b. Email (case-insensitive, shared across >1 live lead)
**25 groups / 54 leads.** Classified: **2 test-email groups**, **9 groups entirely inside the 2026-07-15 import/demo wave** (all members null-status, unowned, no team — e.g. Tarun/Abhi/Abhinav/Abhishek/Avantika), **14 older genuine groups** spanning real history. Examples:
- `ab***@gmail.com` (4 records) — `cmr1mjtm…` Abc(Junk), `cmr7t8h7z…` Divya, `cmrm53cc3…` Tarun, `cmrm6tw89…` Avantika (= baseline group 1).
- `ro***@gmail.com` (2) — `cmr3nu4k9…` Rohit (Tanuj) / `cmr7t8ro3…` Rohit (Yasir) (= baseline group 10) — same client, two owners.
- `in***@gmail.com` (3) — three **Ramesh** Dubai leads created 07-08 → genuine triple-entry.

**Baseline reconciliation:** the curated `docs/reviews/duplicate-review-2026-07-16.md` listed **10 groups / 22 leads** (8 email + 2 phone). This automated exhaustive scan finds **more** because it (a) normalizes every phone via `phoneCanonical` suffix, (b) includes the 2026-07-15 test/import wave, and (c) surfaces the degenerate clusters the curated list omitted. The 10 baseline groups are all present within these results.

**Bucket:** MANUAL REVIEW / NEEDS LALIT (link vs merge per group). Recommend triaging the 07-15 wave + test emails as data-cleanup first, then link the ~14 older genuine groups.

---

## Check 2 — Phone formatting variance (canonical NULL, phone present)
**0.** `phoneCanonical` is fully backfilled — 3,782 live leads have a phone, all 3,782 have a canonical. **Bucket:** CLEAN (`scripts/backfill-phone-canonical.ts` already applied; idempotent going forward).

---

## Check 3 — Lost/Rejected still assigned (rule-compliance)
**0 violations.** No live lead that is LOST-by-status OR `rejectedAt != null` still carries an `ownerId`. The Lost/Rejected auto-unassign rule is fully in force. **12** booked/closed leads retain an owner — that is **intended** (the owner is the booking attribution), not a violation. **Bucket:** CLEAN. Remediation script `scripts/backfill-lost-rejected-unassign.ts` exists and is idempotent (dry-run by default; `--apply` writes a revertable OperationLog) should any future drift appear.

---

## Check 4 — Follow-up on terminal records
**0.** No live lead in a TERMINAL status (booked/sold/leased OR lost) carries an active `followupDate`. **Bucket:** CLEAN. `scripts/backfill-terminal-followup.ts` already ran; the reject flow + `/update` path now clear follow-ups at the source.

---

## Check 5 — Missing Previous Owner on rejected leads
**8** of 487 live rejected leads have `previousOwnerId = NULL`. **All 8 are currently unowned**, and all are terminal/test-grade: Junk (4), Broker (2), Invalid Number, Other. Samples: `cmqr2go9a…` Franklyn (Invalid), `cmqz1d0gr…` Roselin (Broker), `cmrd349pu…` Thelma (Junk), `cmrkcyv6e…` QA (Junk).

**Assessment:** these were almost certainly **rejected directly from an unowned/pool state** (never assigned to an agent), so `previousOwnerId = NULL` is **correct** — there was no previous owner to preserve. **Bucket:** LOW / likely-non-issue. No safe auto-fix (a previous owner cannot be invented). Confirm with Lalit only if the "Previous Owner" display on these looks wrong.

---

## Check 6 — Import-timestamp-as-created (FYI)
`createdTimeKnown`: **false = 5,510**, **null = 678**, **true = 0**. The import-fidelity backfill has flagged 5,510 leads as *time-unknown* (their "Created Time" correctly renders blank rather than a fabricated time). Exact-timestamp clusters confirm **date-only imports defaulting to noon IST** (`06:30:00Z` = 12:00 IST): 230 leads at 2026-07-01, 24 at 07-14, plus ~10 smaller batches. One precise cluster (30 leads @ 2026-06-20 11:14:28) = a real-time bulk action. **Bucket:** FYI / working-as-designed — the `createdTimeKnown=false` flag is exactly the mechanism that handles this. No action.

---

## Check 7 — Excel serial dates
**0.** BuyerRecord `passportExpiry` is unused in prod (0 populated) with 0 bare-serial values; `transactionDate`/`followupDate` have 0 absurd-year rows; Lead `createdAt`/`followupDate`/`meetingDate`/`siteVisitDate` have 0 absurd-year rows. Lead `createdAt` year spread is sensible (2020:1, 2021:4, 2022:4, 2023:8, 2024:40, 2025:160, 2026:3,639). The known buyer-date-serial issue has been **fully remediated with no residue**. **Bucket:** CLEAN.

---

## Check 8 — Missing source / status
- **Missing `sourceRaw`: 0** live leads. Every live lead has a verbatim source.
- **Missing `currentStatus`: 2,536** live — but only **8** are ACTIVE_LEAD origin. The other ~2,528 are REVIVAL/MASTER_DATA (untriaged imports) whose blank status is the intended **"Unclassified"** bucket (per Lalit: quantify, don't force-fix).

**Bucket:** FYI (not errors). The 8 active-origin blank-status leads are the only ones worth a glance. No forced fix.

---

## Check 9 — Unassigned ACTIVE (workable, non-terminal) records
**1,894** workable leads have `ownerId = NULL` — but **1,892 are REVIVAL origin** (the Admin Revival pool, legitimately awaiting assignment) and only **2 are ACTIVE_LEAD**. The real "active leads awaiting an owner" number is **2**. **Bucket:** FYI / not alarming. No action.

---

## Check 10 — Orphan / broken foreign keys
| Relation | Broken rows |
|---|---|
| Lead.ownerId → missing User | **0** |
| Lead.ownerId → inactive User (live leads) | **0** |
| CallLog.leadId → missing Lead | **0** |
| CallLog.buyerId → missing BuyerRecord | **0** |
| CallLog.userId → missing User | **0** |
| Activity.leadId → missing Lead | **0** |
| Activity.userId → missing User | **0** |
| CallLog.leadId → **soft-deleted** Lead | **2** (row still exists — recycled lead, not a true orphan) |

**Bucket:** CLEAN. Referential integrity is intact. The 2 call logs pointing to soft-deleted leads are benign (the lead row persists; restore re-links them).

---

## Check 11 — Duplicate activity logs
**321 duplicate groups / 360 excess rows** (identical `leadId` + `type` + `description` within the same minute):

| Type | Groups | Excess rows |
|---|---|---|
| NOTE | 137 | 152 |
| CALL | 91 | 103 |
| TASK | 69 | 78 |
| STATUS_CHANGE | 13 | 13 |
| PROJECT_DISCUSSED | 8 | 11 |
| WHATSAPP | 3 | 3 |

Samples: `"followupDate → 2026-06-04"` ×5, `"budgetMin set to 40000000"` ×5, `"Agent tapped Call button"` ×4, `"Follow-up done after call"` ×4. Cause is double-submit / double-click / re-render on the write path. **The 103 excess CALL rows can slightly inflate call-attempt metrics.**

**Bucket:** NEEDS LALIT / MANUAL REVIEW. This is the largest row-count finding but **deleting activity rows is destructive** and could remove legitimate rapid actions — no idempotent dedup script exists yet. Recommend: (1) a guarded dedup script that keeps the earliest row per (leadId,type,description,minute) with a backup + OperationLog, run in dry-run first; and/or (2) add a debounce/idempotency guard on the activity write path to stop new dupes. Do **not** auto-delete without approval.

---

## Check 12 — Call-log module correctness
**0** call logs have both `buyerId` AND `leadId` set. **0** are fully unlinked. All 4,204 call logs resolve cleanly to exactly one module (lead or buyer). **Bucket:** CLEAN.

---

## Check 13 — Buyer/Revival/Lead count coherence
- **Lead by origin (live):** REVIVAL 3,088 · ACTIVE_LEAD 502 · MASTER_DATA 266 = **3,856** ✓ (matches live total).
- **BuyerRecord:** 1,014 live (ASSIGNED 846 · REJECTED 99 · CONVERTED 47 · ADMIN_POOL 22 = 1,014 ✓) + 1,088 soft-deleted.
- **Broken conversion links:** `poolStatus=CONVERTED` with `convertedLeadId=NULL` → **0**. `convertedLeadId` pointing to a missing Lead → **0**.

**Bucket:** CLEAN / coherent. FYI: soft-deleted buyers (1,088) exceed live (1,014) — consistent with the reversible bulk-delete recycle-bin design; not a defect.

---

## Check 14 — Attempt / ghosting fields (pending backfill)
`attemptCount>0`: 0 · `connectedCount>0`: 0 · `ghostingAt` set: 0 · `revivalCycle≠1`: 0 · `returnedToPoolAt` set: 0. All new owner-cycle fields sit at schema defaults. **This is expected** — the backfill has not run yet. **Bucket:** FYI / NOT a defect (as scoped).

---

## Remediation index

| Finding | Script (exists) | Status | Bucket |
|---|---|---|---|
| Lost/Rejected unassign | `scripts/backfill-lost-rejected-unassign.ts` | already applied (0 remaining) | SAFE AUTO-FIX |
| Terminal follow-up clear | `scripts/backfill-terminal-followup.ts` | already applied (0 remaining) | SAFE AUTO-FIX |
| Phone canonical normalize | `scripts/backfill-phone-canonical.ts` | already applied (0 remaining) | SAFE AUTO-FIX |
| Market co-write gaps | `scripts/backfill-market-gap.ts` | idempotent heal (not re-measured here) | SAFE AUTO-FIX |
| Duplicate customers (phone/email) | — (Customer Identity Center link, reversible) | needs per-group decision | **NEEDS LALIT** |
| `+91`-only leads (18) | — | re-collect phone / data cleanup | **NEEDS LALIT** |
| Duplicate activity rows (360) | — (no script yet) | needs guarded dedup + write-path debounce | **NEEDS LALIT** |
| Rejected missing prev-owner (8) | — | likely correct (rejected-from-pool) | LOW / confirm only |

_All numbers captured 2026-07-17 from prod via read-only probes. No data was modified._
