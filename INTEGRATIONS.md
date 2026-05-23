# Paid integrations roadmap

Concrete next-steps + costs for things that can't be free. Plug them in only when you actually need them.

## 1. Real number masking — Exotel (recommended for India + UAE)

Without this: when an agent taps "Call", their phone's dialer shows the real client number.
With this: agent dials → Exotel's number → Exotel bridges to the client. Both sides see Exotel's number.

| | Detail |
|---|---|
| **Cost** | ₹3,500/mo base + ₹0.50–1.00 per minute |
| **Setup time** | ~1 day on Exotel side (KYC, number provisioning) + ~2 hours on my side |
| **Provider URL** | https://exotel.com → Sign up for India number, choose "Click-to-call" |
| **What you'll get** | A masking number (e.g. +91 99XXX XXXXX) that all calls route through |
| **What I'll do** | Hook `/api/leads/[id]/exotel-call` to Exotel API + replace tel: link in LeadActionsClient |
| **Alternative for UAE-only** | Cisco / 3CX / RingOver — pricier (~$25/user/mo) but international |

## 2. Send WhatsApp from CRM — Gupshup or Interakt (cheapest in India)

Without this: WhatsApp button opens client's chat — agent types manually.
With this: CRM sends "Hello {{name}}, I'm your assigned agent…" automatically on assignment.

| | Detail |
|---|---|
| **Cost** | ₹0.30 per outgoing conversation (Meta charges); Gupshup ₹2,500/mo platform fee |
| **Setup** | 1) Verify business with Meta (BVS) — takes 3–7 days · 2) Get template messages approved by Meta · 3) Add API key to CRM |
| **Recommended** | https://www.gupshup.io (India focus, easiest BVS) or https://www.interakt.shop |
| **What I'll do** | Add `WHATSAPP_PROVIDER_API_KEY` env var + `/api/wa/send` endpoint + auto-fire on `assignLeadTo()` |
| **Webhook for inbound** | Already built at `/api/intake/whatsapp` (Meta Cloud API shape, also handles Gupshup) |

## 3. Send transactional email — Resend (best free tier)

Without this: Email button opens client's email — agent types manually.
With this: CRM sends "Your lead is here" emails on assignment + SLA reminders.

| | Detail |
|---|---|
| **Cost** | **FREE for 100 emails/day, 3,000/mo** then $20/mo for 50K/mo |
| **Setup time** | 10 minutes |
| **Provider URL** | https://resend.com → Sign up with GitHub → Create API key |
| **Domain** | Add `crm.whitecollarrealty.com` DNS records they give you → emails come from `noreply@crm.whitecollarrealty.com` |
| **What I'll do** | Add `RESEND_API_KEY` env var + `/lib/email.ts` helper + auto-fire on `assignLeadTo()` and SLA breaches |
| **Alternative** | Postmark ($15/mo), SendGrid (free 100/day, painful setup) |

## 4. Web Push notifications — direct to phone home screen

Already partly there via the PWA. Needs VAPID keys for "real" push (works when CRM is closed).

| | Detail |
|---|---|
| **Cost** | **FREE** (uses Apple/Google push servers, no provider needed) |
| **Setup** | Generate VAPID key pair (`npx web-push generate-vapid-keys`) → add to Vercel env |
| **What I'll do** | Extend `public/sw.js` with push handler + add subscription endpoint + auto-fire on every Notification.create |
| **Caveats** | iOS Safari supports it only since iOS 16.4 (Mar 2023) AND only for PWAs added to home screen |

## 5. Real-time inbox (no polling)

Currently the notification bell polls every 30s. Real-time would use SSE or websockets.

| | Detail |
|---|---|
| **Cost** | FREE on Vercel (SSE works on free tier; websockets need Vercel Pro or Pusher) |
| **What I'll do** | Add `/api/notifications/stream` (Server-Sent Events) + replace polling in NotifBell |
| **Effort** | ~3 hours |

---

## My recommended order

1. **Resend (email)** — FREE, gives you "lead assigned" email + SLA escalation email · 30 min
2. **Web Push** — FREE, gives you home-screen push when CRM is closed · 2 hours
3. **Exotel** — once you have a few agents calling daily and number privacy actually matters · ~₹3.5k/mo + 1 day setup
4. **Gupshup WhatsApp** — once you want auto-greetings ("Hi {{name}}, I'm Mehak from White Collar Realty") · ~₹2.5k/mo + 1 week setup (Meta BVS)
5. **Real-time inbox** — once team size > 20 and 30s polling feels laggy
