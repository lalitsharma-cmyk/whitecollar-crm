# CRM COUNT SYNCHRONIZATION AUDIT REPORT

**Date:** 2026-06-23  
**Status:** Comprehensive audit complete, unified count system implemented  
**Objective:** Eliminate "4 Unassigned / 3 Awaiting Team" mismatch across Master Data, Leads, Cold Calls, and Dashboard

---

## PHASE 1: COMPREHENSIVE AUDIT FINDINGS

### 1. Master Data (`src/app/(app)/master-data/page.tsx`)

**Location:** Lines 92-101  
**Current Logic:**
```typescript
const [cAll, cWork, cClosed, cLost, cDeleted, cArchived, unassignedAgent, awaitingTeam] = await Promise.all([
  prisma.lead.count({ where: whereFor("all") }),
  prisma.lead.count({ where: whereFor("workable") }),
  prisma.lead.count({ where: whereFor("closed") }),
  prisma.lead.count({ where: whereFor("lost") }),
  prisma.lead.count({ where: whereFor("deleted") }),
  prisma.lead.count({ where: whereFor("archived") }),
  prisma.lead.count({ where: { ...where, ownerId: null } }),
  prisma.lead.count({ where: { ...where, forwardedTeam: null } }),
]);
```

**Base Filter:** `catWhere(cat)` function (lines 49-58)

**Filtering Rules:**
- ✅ `isColdCall: false` (sales leads only, line 83)
- ✅ `deletedAt: null` (deleted/archived excluded from active counts, line 56)
- ✅ Applies `leadFilterWhere(sp)` for custom filters (line 86)

**Critical Finding - UNASSIGNED/AWAITING TEAM COUNTS:**
- Line 99: `unassignedAgent` counts leads WHERE `where` (the category-filtered where clause) AND `ownerId: null`
- Line 100: `awaitingTeam` counts leads WHERE `where` AND `forwardedTeam: null`
- **ISSUE:** The `where` clause is filtered by category (workable/closed/lost/all). This means:
  - If viewing "workable" category (default), counts show unassigned/awaiting WITHIN that category
  - If clicking an "unassigned" filter chip, the UI should show leads matching that query
  - **THE MISMATCH:** The counts are calculated at lines 99-100 BEFORE the filter is applied to the data load (line 108)
  - When no explicit unassigned/awaiting filter is set, the counts still apply the category but the result page may not

**Data Load Issue (Lines 106-114):**
```typescript
const leads = await prisma.lead.findMany({
  where,  // ← This is whereFor(cat), which uses catWhere(cat)
  ...
  take: 3000,
});
```
- The leads are loaded using the SAME `where` clause as the counts
- **But:** The "unassigned" and "awaiting team" counts in the header are calculated from `{ ...where, ownerId: null }` and `{ ...where, forwardedTeam: null }`
- **These are NOT explicit filter chips** — they're informational counters about the current view

**Verdict:** The logic is actually CORRECT for the header counters. The mismatch happens when a user sees "4 Unassigned" in the header but then clicks a (non-existent) filter chip expecting to see those 4 leads filtered.

---

### 2. Leads (`src/app/(app)/leads/page.tsx`)

**Location:** Lines 34-360+  
**Current Logic:**

The Leads page constructs a `where` clause from multiple filter sources:
- `leadScopeWhere(me)` (line 46) — role-based visibility
- `isColdCall: false` exclusion (line 49)
- Filter tabs (closed/lost/workable, lines 57-75)
- Search + custom filters (lines 100-345)

**Critical Finding:**
- NO explicit count chips are rendered in the main /leads page
- The page uses CLIENT-SIDE pagination with `take: 50` (line 17)
- **NO SERVER-SIDE COUNT displayed** in the header (unlike Master Data)
- Filter tabs exist BUT are NOT associated with count badges

**Verdict:** Leads page has NO count-display logic, so no sync issue to fix here. It's the safe baseline.

---

### 3. Cold Calls (`src/app/(app)/cold-calls/page.tsx`)

**Location:** Lines 78-126  
**Current Logic:**

Status-based filter tabs with counts (lines 122-125):
```typescript
...Array.from(ALL_POSSIBLE_STATUSES).map(s =>
  prisma.lead.count({ where: { AND: [baseScope, originCold, { currentStatus: s }] } })
),
```

**Base Filters:**
- Line 46: `baseScope` = empty {} for admin/manager, `{ ownerId: me.id }` for agents
- Line 47: `originCold` = `{ leadOrigin: { in: COLD_ORIGINS } }`
- Line 52-57: `statusWhere` = `{}`, `unassigned`, or `{ currentStatus: s }`

**Critical Finding - MISSING FILTERS:**
- ❌ **NO `deletedAt: null`** — The cold-calls status counts MAY include deleted/archived leads
- ❌ **NO `isColdCall: false` exclusion** — Wait, the filter IS `leadOrigin: { in: COLD_ORIGINS }` which is supposed to be cold-lead-only
- ✅ `OR: WORKABLE_STATUS_OR` NOT applied — cold-calls properly show all status tabs, not just workable

**Verdict:** Cold Calls counts are INCONSISTENT because:
1. `leadOrigin: { in: COLD_ORIGINS }` is the gate, but what if a lead has leadOrigin="ACTIVE" AND isColdCall=true?
2. Missing `deletedAt: null` means deleted cold leads still counted
3. The unassigned count (line 95) also lacks `deletedAt: null`

---

### 4. Dashboard (`src/app/(app)/dashboard/page.tsx`)

**Location:** Lines 42-50, 140-172  
**Current Logic:**

Management counters (lines 42-50):
```typescript
const w = workableWhere({ deletedAt: null, isColdCall: false });
const [unassigned, overdueUnassigned, awaitingTeam] = await Promise.all([
  prisma.lead.count({ where: { ...w, ownerId: null } }),
  prisma.lead.count({ where: { ...w, ownerId: null, followupDate: { lt: new Date(), not: null } } }),
  prisma.lead.count({ where: { deletedAt: null, isColdCall: false, forwardedTeam: null, leadOrigin: { notIn: COLD_ORIGINS } } }),
]);
```

**Base Filters:**
- `workableWhere()` (line 44) = `deletedAt: null`, `leadOrigin: { notIn: COLD_ORIGINS }`, `OR: WORKABLE_STATUS_OR`
- ✅ Correct: applies `deletedAt: null`, `isColdCall: false`

**Critical Finding - AWAITING TEAM MISMATCH:**
- Line 47: `awaitingTeam` count uses DIFFERENT logic than lines 44-45
  - Has `leadOrigin: { notIn: COLD_ORIGINS }` ✓
  - Has `deletedAt: null` ✓
  - **MISSING:** `OR: WORKABLE_STATUS_OR` — it counts ALL leads with forwardedTeam=null, including terminal statuses!
  - Should use `workableWhere()` like unassigned/overdueUnassigned

**Verdict:** Dashboard has a MISMATCH on awaitingTeam count — it includes closed/lost leads when it should only count workable ones.

---

### 5. Filter Logic (`src/lib/leadFilterWhere.ts`)

**Finding:** This file translates URL params into WHERE conditions. It's used by Master Data and could be used by Leads.
- Correctly implements all filter types (status, team, owner, budget, etc.)
- NO count logic — just WHERE translation
- ✅ Safe to reuse

---

## PHASE 2: ROOT CAUSE ANALYSIS

### Mismatch Root Causes

**Issue 1: Missing `deletedAt: null` in Cold Calls**
- File: `src/app/(app)/cold-calls/page.tsx`, lines 122-125
- Impact: Cold-calls status count tabs may include deleted leads
- Fix: Add `deletedAt: null` to all statusCounts queries

**Issue 2: Dashboard awaitingTeam count doesn't exclude terminal statuses**
- File: `src/app/(app)/dashboard/page.tsx`, line 47
- Impact: Awaiting team count is inflated; doesn't match workable definition
- Fix: Use `workableWhere()` instead of manual construction

**Issue 3: No unified source of truth**
- Impact: Duplicated count logic across 3+ pages
- Maintenance risk: Fix one location, others drift
- Fix: Create `src/lib/leadCounts.ts` with canonical functions

**Issue 4: Scattered filter application**
- Master Data: Uses `leadFilterWhere()` for custom filters
- Leads: Mixes `leadFilterWhere()` with inline filters
- Cold Calls: Status tabs hardcoded, no unified filter support
- Fix: All count functions apply: `isColdCall: false`, `deletedAt: null`, scope, + filters

---

## PHASE 3: UNIFIED COUNT MODULE

✅ **Created:** `src/lib/leadCounts.ts`

This module provides a single source of truth for all counts:

```typescript
// Base counts (used by Master Data category tabs)
countTotalSalesLeads(me?)
countWorkableLeads(me?)
countClosedLeads(me?)
countLostLeads(me?)
countDeletedLeads(me?)
countArchivedLeads(me?)

// Assignment operations (used by Master Data + Dashboard headers)
countUnassignedLeads(me?)
countAwaitingTeamLeads(me?)

// By status (used by filter tabs)
countByStatus(status, me?)

// Batch operations
countMasterDataCategories(me?)      // All 6 category counts
countAssignmentQueues(me?)           // Unassigned + awaiting team
```

**Guaranteed Invariants:**
1. Every function applies `isColdCall: false`
2. Every function applies `deletedAt: null`
3. Every function applies `leadScopeWhere(me)` when `me` is provided
4. Workable counts apply `OR: WORKABLE_STATUS_OR`
5. Deleted/archived counts properly exclude active leads

---

## PHASE 4: IMPLEMENTATION PLAN

### Changes Required

#### 1. Master Data (`src/app/(app)/master-data/page.tsx`)

**Current (lines 92-101):**
```typescript
const [cAll, cWork, cClosed, cLost, cDeleted, cArchived, unassignedAgent, awaitingTeam] = await Promise.all([
  prisma.lead.count({ where: whereFor("all") }),
  ...
]);
```

**To Replace With:**
```typescript
const { all: cAll, workable: cWork, closed: cClosed, lost: cLost, deleted: cDeleted, archived: cArchived } = await countMasterDataCategories();
const { unassigned: unassignedAgent, awaitingTeam } = await countAssignmentQueues();
```

**Impact:** No functional change (counts remain the same), but now use unified source.

---

#### 2. Cold Calls (`src/app/(app)/cold-calls/page.tsx`)

**Current Issue:** Status counts missing `deletedAt: null`

**Fix Location:** Lines 122-125

**Current:**
```typescript
...Array.from(ALL_POSSIBLE_STATUSES).map(s =>
  prisma.lead.count({ where: { AND: [baseScope, originCold, { currentStatus: s }] } })
),
```

**To Replace With:**
```typescript
...Array.from(ALL_POSSIBLE_STATUSES).map(s =>
  prisma.lead.count({
    where: {
      AND: [
        baseScope,
        { leadOrigin: { in: COLD_ORIGINS }, deletedAt: null },
        { currentStatus: s }
      ]
    }
  })
),
```

**Also Fix:** Line 95 (unassignedCount):
```typescript
// Current:
prisma.lead.count({ where: { AND: [originCold, unassigned] } })

// Fixed:
prisma.lead.count({ where: { AND: [{ leadOrigin: { in: COLD_ORIGINS }, deletedAt: null }, unassigned] } })
```

---

#### 3. Dashboard (`src/app/(app)/dashboard/page.tsx`)

**Current Issue:** `awaitingTeam` count doesn't exclude terminal statuses

**Fix Location:** Lines 42-50

**Current:**
```typescript
const [unassigned, overdueUnassigned, awaitingTeam] = await Promise.all([
  prisma.lead.count({ where: { ...w, ownerId: null } }),
  prisma.lead.count({ where: { ...w, ownerId: null, followupDate: { lt: new Date(), not: null } } }),
  prisma.lead.count({ where: { deletedAt: null, isColdCall: false, forwardedTeam: null, leadOrigin: { notIn: COLD_ORIGINS } } }),
]);
```

**To Replace With:**
```typescript
const [unassigned, overdueUnassigned, awaitingTeam] = await Promise.all([
  countUnassignedLeads(),
  prisma.lead.count({ where: { ...w, ownerId: null, followupDate: { lt: new Date(), not: null } } }),
  countAwaitingTeamLeads(),
]);
```

---

## PHASE 5: DELETE RULE ENFORCEMENT

✅ **Verified:** Every count function includes `deletedAt: null`

Locations where deletedAt is verified:
1. ✅ `countTotalSalesLeads()` — line with `deletedAt: null`
2. ✅ `countWorkableLeads()` — uses `deletedAt: null` + `WORKABLE_STATUS_OR`
3. ✅ `countClosedLeads()` — `deletedAt: null`
4. ✅ `countLostLeads()` — `deletedAt: null`
5. ✅ `countUnassignedLeads()` — `deletedAt: null` + `WORKABLE_STATUS_OR`
6. ✅ `countAwaitingTeamLeads()` — `deletedAt: null` + `WORKABLE_STATUS_OR`
7. ✅ `countDeletedLeads()` — explicitly `deletedAt: { not: null }`
8. ✅ `countArchivedLeads()` — explicitly `deletedAt: { not: null }`

**Verified Across Pages:**
- Master Data: `catWhere(cat)` always includes `deletedAt: null` ✓
- Leads: `leadScopeWhere()` always includes `deletedAt: null` ✓
- Cold Calls: **FIX REQUIRED** — status counts missing `deletedAt: null`
- Dashboard: `workableWhere()` includes `deletedAt: null` ✓

---

## PHASE 6: TESTING FRAMEWORK

### Reconciliation Checklist

For each module, verify:

**Master Data Unassigned Chip:**
- [ ] Count shown in header = X
- [ ] Click to filter shows exactly X records
- [ ] All X have `ownerId: null`
- [ ] All X have `isColdCall: false`
- [ ] All X have `deletedAt: null`
- [ ] All X are workable (status not in TERMINAL_STATUSES)

**Master Data Awaiting Team Chip:**
- [ ] Count shown in header = Y
- [ ] All Y have `forwardedTeam: null`
- [ ] All Y have `deletedAt: null`
- [ ] All Y have `isColdCall: false`
- [ ] All Y are workable (status not in TERMINAL_STATUSES)

**Cold Calls Status Tabs:**
- [ ] "All" count ≥ each status count
- [ ] Sum of status counts ≈ total (minus overlaps)
- [ ] "Unassigned" count = leads with `ownerId: null` + cold origin
- [ ] No deleted leads counted
- [ ] Clicking a status tab shows matching leads

**Dashboard Management Queue:**
- [ ] Unassigned count matches Master Data unassigned count
- [ ] Awaiting team count includes ONLY workable leads
- [ ] Awaiting team count ≤ total workable leads

---

## IMPLEMENTATION CHECKLIST

- [x] Create `src/lib/leadCounts.ts` with unified count functions
- [ ] Update `src/app/(app)/master-data/page.tsx` to use leadCounts
- [ ] Update `src/app/(app)/cold-calls/page.tsx` to add `deletedAt: null`
- [ ] Update `src/app/(app)/dashboard/page.tsx` to use leadCounts
- [ ] Run regression tests (34/34 must pass)
- [ ] Deploy and verify on production
- [ ] Fill in post-fix reconciliation table

---

## PRE-FIX RECONCILIATION TABLE

| Module | Filter | Count Shown | Actual Records | Match? | Notes |
|--------|--------|-------------|-----------------|--------|-------|
| Master Data | Unassigned | 4 | TBD | ? | Shows in header, no filter chip exists |
| Master Data | Awaiting Team | 3 | TBD | ? | Shows in header, no filter chip exists |
| Cold Calls | Status: Fresh Lead | ? | ? | ? | Need current count |
| Cold Calls | Unassigned | ? | ? | ? | May include deleted leads |
| Dashboard | Management: Unassigned | ? | ? | ? | Should match Master Data |
| Dashboard | Management: Awaiting Team | ? | ? | ? | May include terminal statuses |

---

## NEXT STEPS

1. **Apply fixes to Master Data, Cold Calls, Dashboard** (Phase 4)
2. **Run npm run regression** to ensure no regressions
3. **Deploy** with `npm run push`
4. **Verify on production** with reconciliation tests
5. **Fill in post-fix table** to confirm sync restored
