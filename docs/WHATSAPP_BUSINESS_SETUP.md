# 💬 Meta WhatsApp Business Cloud API Setup — step-by-step

This unlocks **real outbound WhatsApp messages** sent from your company number `8810286629` directly through the CRM. Currently the system runs in **stub mode** — it logs what would be sent but doesn't actually message clients. After this, it sends for real.

**Total time: ~1 hour of your active work + 1–3 days for Meta to verify your business.**

---

## Why this is needed

WhatsApp Web links (`wa.me/<phone>`) only open WhatsApp on YOUR device — you still have to manually tap send. The **Cloud API** lets the CRM send programmatically:

- 🚀 Speed-to-lead auto-respond actually delivers (currently stub)
- 🤖 Workflow actions like "after BANT qualified, send a WA template" actually fire
- 🌙 10pm–10am auto-WA welcome actually goes out
- 📊 Every outbound WA is tracked in the lead timeline (read receipts, delivery status)

**Cost:** Meta's first 1,000 conversations/month are FREE. After that ~₹0.50–1.20 per conversation. For 6 agents = essentially free unless you hit serious scale.

---

## Phase 1 — Meta Business Manager account (15 min)

You probably already have one if you run Facebook ads for White Collar Realty. If not:

1. Go to **[business.facebook.com](https://business.facebook.com)** in Chrome on laptop
2. Create a Business Manager → name: **White Collar Realty**
3. Add your business details (GST, address, website `whitecollarrealty.com`)
4. Verify your domain (Meta will give you a meta tag to add to your website's `<head>` — your web developer can do this in 5 min)

**Note:** if you already use Meta Business Suite for Facebook/Instagram, skip — use that existing account.

---

## Phase 2 — Add WhatsApp Business Account (10 min)

1. Inside Business Manager → **Settings** (gear icon, bottom left) → **WhatsApp Accounts** → **Add**
2. Name: **WCR CRM** (this is just a label, clients never see it)
3. Currency: **INR**
4. Time zone: **Asia/Kolkata**
5. Click **Create**

---

## Phase 3 — Add your phone number (15 min)

This is where you register `+91 88102 86629` (or whatever number you want clients to message):

1. WhatsApp Business Account → **Phone numbers** → **Add phone number**
2. Display name: **White Collar Realty** (this shows in the WhatsApp chat header for clients)
3. Category: **Real Estate**
4. Description: "Premium property advisory across Dubai & India"
5. Phone number: `+91 8810286629` (must be a number that does NOT currently have personal WhatsApp installed — Meta will ask you to deactivate WA on the SIM if it does)
6. Verify via SMS (Meta sends OTP)
7. Once verified, copy the **Phone Number ID** (a long number like `123456789012345`) — you'll send this to me

⚠ **Important:** This number can no longer be used as personal WhatsApp on a phone. It's now API-only. If you want personal WA on the same number, get a separate SIM for personal use.

---

## Phase 4 — Generate access token (5 min)

1. Inside WhatsApp Business Account → **System Users**
2. Click **Add** → name: `WCR-CRM-Bot` → role: **Admin**
3. Click on the new user → **Generate New Token**
4. App: pick the one auto-created for your WA Business Account
5. Token expiration: **Never** (or 60 days if you prefer rotation)
6. Permissions: tick **whatsapp_business_messaging** + **whatsapp_business_management**
7. **Copy the token** (a very long string starting with `EAA…`) — Meta only shows it ONCE
8. Send me this token

---

## Phase 5 — Submit message template for approval (15 min + Meta wait)

Meta requires PRE-APPROVED templates for the first message you send to anyone who hasn't messaged you in 24 hours. Without this, the speed-to-lead and after-hours WA features won't work for real.

1. Business Manager → WhatsApp Account → **Message templates** → **Create Template**

### Template 1: `afterhours_welcome` (CRITICAL — used by overnight auto-WA)

- **Category:** Utility
- **Language:** English
- **Name:** `afterhours_welcome`
- **Body:**
  ```
  Hi {{1}}, this is White Collar Realty. Thank you for reaching out — our team will respond at 10am IST. For urgent help reply YES and we'll call first thing.
  ```
- **Variable example:** `{{1}}` = "Priya"

### Template 2: `first_query_welcome` (used by speed-to-lead)

- **Category:** Utility
- **Language:** English
- **Name:** `first_query_welcome`
- **Body:**
  ```
  Hi {{1}}, this is {{2}} from White Collar Realty. Thank you for your enquiry. I'll be your dedicated property advisor — may I know a convenient time to call you today?
  ```
- **Variable example:** `{{1}}`="Priya", `{{2}}`="Mehak"

### Template 3: `site_visit_reminder` (used by workflow action)

- **Category:** Utility
- **Language:** English
- **Name:** `site_visit_reminder`
- **Body:**
  ```
  Hi {{1}}, reminder: your site visit at {{2}} is scheduled for {{3}}. We'll arrange cab pickup. Reply STOP to cancel.
  ```

After submission Meta typically approves within 1–4 hours during business hours, up to 24 hours otherwise.

---

## Phase 6 — Send these 3 things to me

```
WA_BUSINESS_TOKEN=EAAxxxxxxxxxxxxxxxxxx
WA_BUSINESS_PHONE_NUMBER_ID=123456789012345
WA_AFTERHOURS_TEMPLATE=afterhours_welcome   (just confirm the template name)
```

I'll add to Vercel env vars + redeploy. Then I'll send a real test message to your own number from the CRM to confirm it works.

---

## After all phases — what flips from STUB to REAL

| Feature | Before | After |
|---|---|---|
| 10pm–10am auto-WA welcome | Logs intent only | Sends real `afterhours_welcome` template |
| Speed-to-lead WhatsApp | Logs intent only | Sends real `first_query_welcome` template |
| Workflow Rules SEND_WA action | Logs intent only | Sends real WA template (any approved template) |
| 2FA via WhatsApp OTP | Not built | I can build it in ~4 hours once tokens are live |

Email speed-to-lead + workflow emails already work via Resend (Meta WA is the only stub right now).

---

## Costs (Meta's pricing, as of 2026)

| Conversation type | First 1,000/mo | After |
|---|---|---|
| Service (you reply to user) | Free | Free |
| Marketing (template, e.g. promotions) | Free | ₹0.85/conversation |
| Utility (template, e.g. order updates, reminders) | Free | ₹0.40/conversation |
| Authentication (OTP templates) | Free | ₹0.30/conversation |

For 6 agents × 30 outbound WA/day = 5,400/month = ~₹2,200/month worst case.

---

## Troubleshooting

- **Template stuck in "Pending"** — Meta business hours review; if >48h, contact Meta support
- **"Send returns 401"** — token expired or wrong; regenerate in System Users
- **"Number can't be registered"** — has personal WA installed; uninstall + factory-reset SIM
- **"Recipient hasn't opted in"** — first message to that number must use an approved template; free-form only works in 24h reply window
