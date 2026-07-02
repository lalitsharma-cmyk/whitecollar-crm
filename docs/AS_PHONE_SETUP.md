# AS Phone — Telephony Setup (paste-and-go)

The entire telephony integration is **built and inert**. When you buy AS Phone
numbers you only paste credentials — no code change, no deploy from us.

Cross-module by design: every call (incoming, outgoing, click-to-call) is
auto-linked by phone to the right **Lead**, **Revival/cold lead**, or **Buyer**
(Dubai *or* India), and its **recording appears in that record's timeline** with an
in-app player + download. Unmatched calls are still stored (nothing is ever lost).

---

## 1. Paste 5 credentials into Vercel

Vercel → Project → **Settings → Environment Variables** (Production), then redeploy.

| Env var | What it is | Required |
|---|---|---|
| `TELEPHONY_PROVIDER` | `asphone` (default) | no |
| `AS_PHONE_ACCOUNT_ID` | Account ID from the AS Phone dashboard | **yes** |
| `AS_PHONE_API_KEY` | API key (Bearer token) | **yes** |
| `AS_PHONE_DID` | Your DID / caller-ID number the client sees | **yes** |
| `AS_PHONE_SECRET` | Webhook signing secret (HMAC-SHA256) | recommended |
| `AS_PHONE_BASE_URL` | API base URL (only if not the default) | no |
| `AS_PHONE_WEBHOOK_TOKEN` | Random string; also appended to the webhook URL | recommended |

Set at least one of `AS_PHONE_SECRET` / `AS_PHONE_WEBHOOK_TOKEN` so inbound webhooks
are authenticated. Redeploy after saving (env changes need a fresh build).

## 2. Point the webhook at the CRM

In the AS Phone dashboard, set the call-event webhook (answered / missed /
recording-ready — all of them) to:

```
https://crm.whitecollarrealty.com/api/telephony/webhook?token=<AS_PHONE_WEBHOOK_TOKEN>
```

Method **POST**, JSON or form-urlencoded (both handled). GET is also accepted.
The exact URL is shown, copy-ready, in **Admin → AS Phone**.

## 3. Map agents to extensions

Each agent's telephony extension/id goes in **Team & Roles** (the field currently
labelled Acefone agent id — it's the generic telephony ext). A call is attributed to
the CRM user whose extension matches; unmatched extensions render "Unknown Agent" and
can be reconciled later (we never fabricate authorship). The mapping table is visible
in **Admin → AS Phone**.

## 4. Verify

Open **Admin → AS Phone**. When the three required creds are set it shows
**READY**. Place a test call; within a few seconds you'll see:
- a row in the **Recent inbound events** feed (verbatim audit),
- a **CallLog** on the matched Lead/Buyer with the recording player,
- the outcome in that record's timeline.

---

## How it works (for engineers)

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

click-to-call ─▶ /api/telephony/click-to-call { leadId | buyerId }
                  (scope-checked) → providerSpec.buildClickToCall → provider API
                  transient fail → CallSyncTask (retried)

sync engine   ─▶ /api/cron/telephony-sync  (heartbeat ~30m)
                  pulls recent provider calls → recordCallEvent (reconciles drops)
retry drain   ─▶ /api/cron/telephony-retry  (heartbeat ~5m)
recording     ─▶ /api/telephony/recording/<callId>  (scope-proxied stream + ?download=1)
```

**Adding/adjusting a provider:** everything provider-specific lives in
`src/lib/telephony/providers.ts`. If AS Phone's real webhook field names differ from
the tolerant aliases there, edit the alias lists in `parseWebhook` — the one place.
The routes, linking, timeline, retry queue, sync engine and admin console are all
provider-agnostic and need no change.

**Schema (already applied to prod, additive):** `CallLog.buyerId`,
`CallLog.ivrAccountId`, tables `CallEvent` (raw audit) + `CallSyncTask` (retry queue).

**Back-compat:** the existing Acefone integration (`/api/acefone/*`) is untouched and
still works. Set `TELEPHONY_PROVIDER=acefone` to route the new generic layer through
Acefone instead of AS Phone.
