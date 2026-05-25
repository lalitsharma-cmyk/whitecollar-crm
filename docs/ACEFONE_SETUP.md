# 📞 Acefone Setup — step-by-step

This activates real click-to-call + call recording + auto-call-logging across the CRM. Once done, every agent's call gets logged automatically with duration and recording link on the lead timeline.

**Total time: 30–60 min one-time + waiting on KYC approval (~1 business day).**

---

## Phase 1 — Sign up (10 min)

1. Open **[acefone.com](https://acefone.com)** in Chrome on your laptop
2. Click **Sign Up** (top right)
3. Pick the **India** account region (you can add UAE numbers to it later — they support both)
4. Use email: `lalit@whitecollarrealty.com` (or whichever you control)
5. Verify your email (click the link they send)
6. Verify your phone (OTP)

---

## Phase 2 — Pick a plan + buy your virtual number (15 min + KYC wait)

1. From the Acefone dashboard, click **Plans** in the left sidebar
2. For 6 agents + ~500 calls/day, recommend their **Pro plan** (₹2,500/month — has API access + recording)
   - **Don't pick the Lite plan** — it doesn't include API access
3. Click **Buy Number** → pick India → search for a number starting `+91` that's easy to remember (mobile-style numbers like `+91 88102 86629` work best because that's your business WA number style)
4. Submit KYC documents (PAN + GST + address proof of the company). Takes ~1 business day to approve.
5. **What to send me once approved:**
   - The actual DID number Acefone gave you (with `+91` prefix)

---

## Phase 3 — Generate API key (5 min, AFTER KYC approval)

1. Dashboard → **Settings** → **API Tokens** (left sidebar at bottom)
2. Click **Generate Token**
3. Name: `WCR-CRM`
4. Permissions: tick **Click-to-Call** + **Call Logs** + **Recording Access**
5. Copy the generated token (it's a long string starting with `at_live_…`)
6. **Send me both:**
   - `ACEFONE_API_KEY=at_live_xxxxxxxxxxxxxxx`
   - `ACEFONE_DID_NUMBER=+918810286629` (or whatever you bought)

I'll add these to Vercel env vars + redeploy.

---

## Phase 4 — Configure webhook (5 min)

This is what makes the CRM auto-log every call.

1. Dashboard → **Webhooks** (left sidebar)
2. Click **Add Webhook**
3. **URL:** `https://crm.whitecollarrealty.com/api/acefone/webhook?token=YOUR_SECRET`
   - Replace `YOUR_SECRET` with any random 32-character string you generate at [random.org/strings](https://www.random.org/strings/?num=1&len=32&loweralpha=on&unique=on&format=html&rnd=new)
   - Send me that secret too — I'll add `ACEFONE_WEBHOOK_TOKEN=<your-secret>` to Vercel
4. **Method:** POST
5. **Content-Type:** application/json
6. **Triggers:** tick **all** of these:
   - Call received on Server
   - Call answered on IVR
   - Call answered by Agent
   - Call answered by Customer (Click to Call)
   - Call hangup (Missed or Answered)
   - Dialed on Agent
   - Disposition Status Updated
7. Click **Save**

---

## Phase 5 — Add your agents to Acefone (10 min)

For each of your 6 team members:

1. Dashboard → **Agents** → **Add Agent**
2. Name: their full name
3. Mobile: their personal WhatsApp/call number (this is where Acefone will ring them)
4. Extension: pick a 4-digit number you'll remember (e.g. 1001, 1002, …)
5. Save

**Send me the mapping of agent → extension. Example:**
```
Sameer  → 1001
Lalit   → 1002
Mehak   → 1003
Dinesh  → 1004
Yasir   → 1005
Tanuj   → 1006
```

I'll set each agent's `acefoneAgentId` in the CRM via the /team admin page (or you can do it yourself once it's live — there's a dropdown).

---

## After all 5 phases — what works

✅ Every lead detail page shows **📞 Call via Acefone** button
   → Click → your phone rings → answer → Acefone dials the client → call connects
   → Client never sees your real number (only the DID)
✅ Call auto-logs: duration, outcome (connected/missed), recording URL
✅ Recording shows as inline audio player on the lead timeline
✅ Inbound calls from clients route to the right agent, auto-create CallLog entry
✅ Dashboard "calls today" counter is now accurate

---

## Costs

| Item | Cost |
|---|---|
| Pro plan (monthly) | ₹2,500 |
| Per outbound call (within India) | ₹0.30/min |
| Per inbound call | ₹0.30/min |
| Recording storage | Included in plan, 90 days retention |
| DID number rental | Included in plan |

**Estimated monthly bill for 6 agents × 50 calls/day × avg 3 min = ₹13,500/month all-in.**

---

## What to send me when you're done

Just paste these 4 things into our chat:

```
ACEFONE_API_KEY=at_live_xxxxxxxxxxxxxxx
ACEFONE_DID_NUMBER=+918810286629
ACEFONE_WEBHOOK_TOKEN=<your-32-char-random-string>
AGENT_EXTENSIONS:
  Sameer  → 1001
  Lalit   → 1002
  ...
```

I'll wire it up + verify a test call from the CRM works end-to-end. ~10 minutes of my time.

---

## Troubleshooting

- **"Click-to-call returns 503"** → ACEFONE_API_KEY not set in Vercel env yet
- **"Acefone rings me but never the client"** → your `acefoneAgentId` in /team doesn't match the extension you set in Acefone
- **"Webhooks not arriving"** → check Acefone webhook log for retry count; verify the `?token=…` matches what Vercel has set
- **"Recording link is broken"** → some Acefone plans expire recordings after 30 days; verify Pro plan is active
