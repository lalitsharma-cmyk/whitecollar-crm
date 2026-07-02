# Telephony (AS Phone)

> How cloud calling is wired into the CRM: incoming/outgoing calls and recordings
> auto-link to the right Lead, Revival lead, or Buyer, and appear in that record's
> timeline. **The whole integration is built and inert — going live is just pasting
> credentials.** Step-by-step paste-and-go instructions live in
> [`AS_PHONE_SETUP.md`](./AS_PHONE_SETUP.md).

## What it does (for Lalit)

Once the AS Phone credentials are pasted into Vercel:

- Every call — incoming, outgoing, and click-to-call from inside the CRM — is
  **automatically matched by phone number** to the right record: a **Lead**, a
  **Revival/cold lead**, or a **Buyer** (Dubai *or* India).
- The call's **recording appears in that record's timeline**, with an in-app player
  and a download button.
- Calls that don't match any record are still **stored** (nothing is ever lost) and
  can be reconciled later.
- Nothing is ever fabricated — an unrecognised agent extension shows as "Unknown
  Agent" rather than guessing.

Until the credentials are entered, everything self-skips and costs nothing.

## Turning it on (summary)

Full instructions: [`AS_PHONE_SETUP.md`](./AS_PHONE_SETUP.md). In short:

1. **Paste ~5 credentials** into Vercel env (Production) and redeploy:
   `AS_PHONE_ACCOUNT_ID`, `AS_PHONE_API_KEY`, `AS_PHONE_DID` (required),
   `AS_PHONE_SECRET` and/or `AS_PHONE_WEBHOOK_TOKEN` (recommended, for webhook auth).
   `TELEPHONY_PROVIDER` defaults to `asphone`.
2. **Point the provider's call-event webhook** at
   `https://crm.whitecollarrealty.com/api/telephony/webhook?token=<AS_PHONE_WEBHOOK_TOKEN>`
   (the exact URL is shown copy-ready in **Admin → AS Phone**).
3. **Map each agent to their extension** in **Team & Roles** (the field labelled
   "Acefone agent id" — it's the generic telephony extension).
4. **Verify** in **Admin → AS Phone**: when the three required creds are set it shows
   **READY**; place a test call and watch the event feed + the CallLog + the timeline
   entry appear.

## The admin console

**Admin → AS Phone** (`/admin/telephony`, ADMIN-only) shows:

- which of the credential placeholders are set (and the **READY** state),
- the exact webhook URL to paste into the provider,
- the agent → extension mapping table,
- the raw inbound event feed (verbatim audit of what the provider sent),
- retry-queue health,
- manual **Sync**, **Drain-queue**, and **Replay** controls.

Everything on the console is inert (self-skips) until credentials are pasted — no
code change or redeploy from an engineer is needed to go live.

## How a call reaches a timeline (engineer view)

```
provider webhook ─▶ /api/telephony/webhook
                     ├─ verify (HMAC secret and/or ?token)
                     ├─ log verbatim  (CallEvent — audit/replay)
                     ├─ normalize     (providerSpec.parseWebhook)
                     └─ recordCallEvent
                          ├─ resolveCallLink  → Lead | Revival | Buyer (by phone)
                          ├─ agent match       → user.acefoneAgentId
                          ├─ upsert CallLog    (idempotent on providerCallId)
                          ├─ timeline drop     → Activity (lead) | BuyerActivity (buyer)
                          └─ AuditLog
        on failure ─▶ CallSyncTask (retry queue, exp-backoff, drained by cron)

click-to-call ─▶ /api/telephony/click-to-call { leadId | buyerId }  (scope-checked)
recordings    ─▶ /api/telephony/recording/<callId>  (scope-proxied stream, ?download=1)
```

Two background jobs keep it consistent (both self-skip when telephony is
unconfigured or the queue is empty — see [CRON_JOBS.md](./CRON_JOBS.md)):

- `/api/cron/telephony-retry` (~5 min) — drains failed webhooks/dials.
- `/api/cron/telephony-sync` (~30 min) — pulls recent provider calls and reconciles
  any missed webhooks.

## Provider-agnostic by design

Everything provider-specific is isolated in
[`src/lib/telephony/providers.ts`](../src/lib/telephony/providers.ts). If AS Phone's
real webhook field names differ from the tolerant aliases there, edit the alias lists
in `parseWebhook` — that's the single place. The routes, linking, timeline, retry
queue, sync engine, and admin console are all provider-agnostic.

**Back-compat:** the older Acefone integration (`/api/acefone/*`) is untouched and
still works. Setting `TELEPHONY_PROVIDER=acefone` routes the generic layer through
Acefone instead of AS Phone.

**Schema (already applied to prod, additive):** `CallLog.buyerId`,
`CallLog.ivrAccountId`, and the tables `CallEvent` (raw audit) + `CallSyncTask`
(retry queue).

See also: [`ACEFONE_SETUP.md`](./ACEFONE_SETUP.md) for the legacy provider.
