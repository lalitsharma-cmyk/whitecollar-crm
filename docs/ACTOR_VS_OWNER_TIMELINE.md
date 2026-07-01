# Activity Actor vs Lead Owner — audit-correct timeline

**Rule (Lalit, 2026-07-01):** the Conversation History / Activity Timeline always
shows **who PERFORMED the action** (the Activity Actor = the logged-in user at the
time), **never who OWNS the lead**. Ownership changes over time; history must not.

| Concept | Field(s) | Used for |
|---|---|---|
| **Activity Actor** | `Activity.userId`, `Note.userId`, `CallLog.userId`, `WhatsAppMessage.actorUserId` | Timeline, audit, compliance, history |
| **Lead Owner** | `Lead.ownerId` | Assignment, permissions, reporting, KPIs |

These are separate and must never overwrite each other. The actor is **never**
derived from the current owner.

## Attribution matrix

| Action | Actor stored | Renders as |
|---|---|---|
| Human logs call / note / meeting / visit / WA / email / EOI / stage / reject / reactivate / bulk | session user (`me.id`) | that person |
| Revival / Excel import | the user who ran the import (`changedById`) | that person |
| Duplicate-intake detection | none (system) → `null` | "System" |
| Workflow-engine task | none (automation) → `null` | "System" |
| Speed-to-lead / after-hours WhatsApp | none (automation) → `null` | "Outbound" |
| Lead re-scorer / revival engine / cron | none → `null` | "System" |
| Inbound call, extension matched | matched CRM user | that agent |
| Inbound call, extension **unmatched** | `null` + `attributedAgentName = "Unknown Agent (ext …)"` | "Unknown Agent" — **Unassigned** |
| Inbound WhatsApp | n/a (client) | "Client" |

**Never**: lead owner, first admin, or a fabricated "Agent" as a fallback actor.

## What changed (branch `ws-actor-vs-owner-timeline`)

**Render** — `ConversationStreamCard.tsx`: the null-actor fallback is now "System",
never the owner; outbound WhatsApp shows `m.actor` (its sender), else neutral
"Outbound"; unmatched calls show "Unknown Agent".

**Write paths** — 4 owner-as-actor bugs fixed: `leadIngest.ts` (dup-intake → null),
`workflowEngine.ts` (task → null), `revivalImport.ts` (→ importer), `acefone/webhook`
(unmatched → unassigned, no owner/admin fallback).

**Schema (additive)** — `WhatsAppMessage.actorUserId` (nullable) records who sent an
outbound message; `CallLog.userId` made nullable so an unmatched inbound call is
left unassigned instead of falsely stamped.

**Regression** — new `actor-never-owner` invariant locks the write paths, render
fallback, and schema.

**Historical** — `scripts/reconcile-actor-owner.ts` resets the 130 legacy
duplicate-intake rows (owner-stamped → System). Dry-run by default; `--apply`
writes a JSON backup first and runs in a transaction. **Awaiting approval.**

## Future enhancement — Unmatched Calls Queue (designed, not yet built)

When an inbound telephony call can't be matched to an agent extension, it is stored
**unassigned** (`CallLog.userId = null`, label "Unknown Agent (ext N)"). An admin
screen surfaces these for manual reconciliation:

- **List**: phone number · call time · duration · recording · caller ID · raw
  extension · (future) match-confidence.
- **Action**: admin maps the call to an Agent (and optionally a Lead / Buyer / Cold
  record).
- **Audit-safe**: the manual mapping writes a **separate** audit event
  ("X manually linked this inbound call to Agent Y") and sets `CallLog.userId`. The
  original record's *fact* (it arrived unattributed) is preserved — history is
  never rewritten, only appended to.

Suggested implementation: reuse the existing `AuditLog` for the reconciliation
event; a `/admin/unmatched-calls` page querying
`CallLog where userId = null and direction = INBOUND`.

## Future audit model (design note)

Every timeline row should be answerable for: **Actor · Owner-at-time · Timestamp ·
Source · Activity Type**. Actor, Timestamp, and Type are stored directly.
**Owner-at-time** is *derivable* from the `Assignment` history table (ownership
changes are already recorded there), so it need not be denormalized onto every row
— a join reconstructs "who owned this lead when the action happened" for any
historical entry. If per-row owner snapshots are later desired for performance,
add a nullable `ownerAtActionId` to `Activity` and backfill from `Assignment`.
