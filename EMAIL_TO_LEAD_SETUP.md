# Email-to-Lead — auto-create leads from inbound emails

Forward 99acres / MagicBricks / Housing.com / website-contact emails to a dedicated address → CRM parses + creates a lead.

**Cost: ₹0 forever** (via Cloudflare Email Routing — free).

---

## Easiest setup — Cloudflare Email Routing + Worker (FREE)

Your DNS for `whitecollarrealty.com` is already on Cloudflare (we used it to add the `crm.` CNAME). Re-use it for email routing.

### Step 1 · Enable Email Routing for your domain

1. Cloudflare dashboard → `whitecollarrealty.com` → **Email → Email Routing**
2. Click **Get started** → follow the wizard. It adds 3 MX records + 1 TXT to your DNS automatically.
3. Once verified, you can route mail for any `*@whitecollarrealty.com` address.

### Step 2 · Create a dedicated lead-intake address

In Email Routing → **Routes** → **Custom address**:
- Custom address: `leads@whitecollarrealty.com`
- Action: **Send to a Worker**

### Step 3 · Create the Worker

In Cloudflare → **Workers & Pages** → **Create Application** → **Create Worker**:

Name: `wcr-email-to-lead`. Paste:

```javascript
export default {
  async email(message, env) {
    const from = message.headers.get("from") || "";
    const subject = message.headers.get("subject") || "";
    const text = await new Response(message.raw).text();

    await fetch("https://crm.whitecollarrealty.com/api/intake/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WCR-Key": env.WCR_INTAKE_KEY,
      },
      body: JSON.stringify({ from, subject, text }),
    });
  }
}
```

Save & Deploy. Then go to **Settings → Variables** and add a Secret:
- `WCR_INTAKE_KEY` = a secret string you choose (paste the same string into Vercel env as `EMAIL_INTAKE_KEY`)

### Step 4 · Set up forwarding rules in your inbox

Now, for each portal you receive leads from, set up an auto-forward rule **in your email client**:

#### Gmail
1. Open a sample 99acres email → click ⋮ → **Filter messages like these**
2. Set "From contains: `noreply@99acres.com`" (adjust to actual sender)
3. Next → **Forward it to** → add `leads@whitecollarrealty.com`
4. Click **Create filter** → repeat for MagicBricks, Housing.com, Facebook Lead Ads emails

#### Google Workspace / Outlook
Same pattern — create a forwarding rule from the portal's email sender to `leads@whitecollarrealty.com`.

### Step 5 · Test

Send yourself any email at `leads@whitecollarrealty.com` and check `/leads` in the CRM — within 30 seconds the lead appears.

---

## Alternative — Postmark Inbound (also FREE up to 100/mo)

If Cloudflare Email Routing is too much, **Postmark** offers a free inbound parsing tier:

1. Sign up at https://postmarkapp.com (free)
2. Create a Server → Inbound Stream → get a `xxx@inbound.postmarkapp.com` address
3. Set inbound webhook URL: `https://crm.whitecollarrealty.com/api/intake/email`
4. Add `X-WCR-Key` header in Postmark's webhook settings = same as `EMAIL_INTAKE_KEY`
5. Forward portal emails to your Postmark inbound address

---

## Production hardening (recommended)

In Vercel env, add:
```
EMAIL_INTAKE_KEY=<paste a random string — same as in Cloudflare Worker secret>
```

This prevents random POSTs to `/api/intake/email` from creating leads. Without it, the endpoint accepts anyone.
