# Auto Lead Entry — Integrations Setup

Every external source drops leads straight into the CRM Leads inbox (dedupe +
team-routing + round-robin happen automatically). The CRM side is **built**; the
remaining work is configuring each external platform to point at us — that needs
**your** account logins, so it's listed here for you/the team to action.

## The universal endpoint
```
POST https://crm.whitecollarrealty.com/api/intake/lead
Header:  X-WCR-Key: <the key for that source>
Body (JSON, all optional except one of name/phone/email):
  { "name", "phone", "email", "city", "country", "configuration",
    "budgetMin", "budgetMax", "message", "sourceDetail", "sourceRaw", "project" }
```
The **source is set by the key** — a Townscript key tags the lead EVENT, a Meta
key tags FACEBOOK_ADS, etc. Find each key in **CRM → Lead Intake → API keys**
(admin only). Keys are minted by `scripts/seed-intake-keys.ts`.

---

## Per-source setup

### ✅ Website (live)
Embed `embed.js` (snippet on the Intake page) or POST to `/api/intake/website`
with the Website key. Already used by whitecollarrealty.com.

### ✅ Google Forms (live, free)
Form → ⋮ → Apps Script → paste the snippet from the Intake page → add an
`onFormSubmit` trigger. Every submission becomes a lead.

### ✅ Email / Portals — 99acres · MagicBricks · Housing.com (free)
Forward those portals' lead emails to a Cloudflare Email Routing address that
posts to `/api/intake/email`. Steps in `EMAIL_TO_LEAD_SETUP.md`. (Each portal
also has its own key now if you prefer a Zapier "Email Parser" → `/api/intake/lead`.)

### Meta Lead Ads — Facebook + Instagram
**Native webhook (free, real-time, recommended):**
1. developers.facebook.com → your App → **Webhooks** → **Page** → Subscribe.
2. Callback URL: `https://crm.whitecollarrealty.com/api/intake/meta`
   Verify token: any string — set the SAME string as env `META_VERIFY_TOKEN`.
3. Subscribe the Page to the **`leadgen`** field.
4. Set these env vars in Vercel (Project → Settings → Environment Variables):
   - `META_VERIFY_TOKEN` — the string from step 2
   - `META_APP_SECRET` — App → Settings → Basic → App Secret
   - `META_PAGE_TOKEN` — a long-lived **Page** access token (Graph API Explorer →
     Page token → extend; needs `leads_retrieval`, `pages_show_list`).
   Until these are set the webhook safely ignores events.

**Or via Zapier (no env/app review):** Zap trigger "Facebook Lead Ads → New Lead"
→ action "Webhooks by Zapier → POST" to `/api/intake/lead` with header
`X-WCR-Key: <Meta key>` and map name/phone/email/city.

### Google Ads — Lead Form extensions
Google Ads → Lead Form asset → **Webhook integration**:
- Webhook URL: `https://crm.whitecollarrealty.com/api/intake/lead`
- Key: paste the Google Ads key as the `X-WCR-Key` header via a Zapier/Make step,
  **or** wrap with a Zapier "Google Ads" zap (Google's native webhook can't add
  custom headers, so the key goes in the URL as `?key=<Google Ads key>`).

### Townscript / Eventbrite — event registrations
Add a webhook in the event platform (Townscript: Event → Integrations → Webhook;
Eventbrite: via Zapier "Eventbrite → New Attendee") → POST to `/api/intake/lead`
with `X-WCR-Key: <Event key>`. Set `sourceRaw` to `"Townscript"` / `"Eventbrite"`
to keep the verbatim source.

### WhatsApp Business
Provider (Meta Cloud API / Gupshup / Twilio) webhook → `/api/intake/whatsapp`
with the WhatsApp key. Meta verify token env: `WHATSAPP_VERIFY_TOKEN`.

### Anything else
Use the **Generic / Zapier / Make** key against `/api/intake/lead`.

---

## Quick test (any source)
```bash
curl -X POST https://crm.whitecollarrealty.com/api/intake/lead \
  -H "X-WCR-Key: <key>" -H "Content-Type: application/json" \
  -d '{"name":"Test Lead","phone":"+919876500000","city":"Dubai","sourceRaw":"Townscript"}'
```
A `200 {ok:true, leadId, deduped}` means it worked — the lead appears in Leads /
Master Data. Re-POSTing the same phone returns `deduped:true` (no duplicate).

## Notes
- Keys can be rotated/deactivated anytime in **Lead Intake → API keys**.
- **Testing Mode** (Settings) suppresses auto-WhatsApp/email on new leads — turn
  it off for go-live so speed-to-lead fires.
- A leaked key only lets someone create leads (key-gated, deduped, validated) —
  rotate it if needed.
