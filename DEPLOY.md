# Deploying White Collar CRM to crm.whitecollarrealty.com

Total time: ~30 minutes of clicking. Cost: ₹0 to start (free tier).

## Step 1 · Push code to GitHub (5 min)

1. Go to https://github.com and sign in (create a free account if needed).
2. Click **+ → New repository**, name it `whitecollar-crm`, set **Private**, **Create repository**.
3. In Git Bash on your laptop:
   ```bash
   cd /c/Users/Lenovo/whitecollar-crm
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/whitecollar-crm.git
   git push -u origin main
   ```
   When prompted, paste your GitHub username + a Personal Access Token (Settings → Developer settings → Tokens).

## Step 2 · Create a free Postgres database on Neon (5 min)

1. Open https://neon.tech → **Sign up with GitHub** (use the same account).
2. Create a new project called `whitecollar-crm`. Region: closest to your customers (Mumbai/Singapore).
3. After it's created, copy the **Connection string** (looks like `postgresql://...neon.tech/...?sslmode=require`).

## Step 3 · Deploy on Vercel (5 min)

1. Open https://vercel.com → **Sign up with GitHub**.
2. Click **Add New → Project**, pick the `whitecollar-crm` repo, click **Import**.
3. In the import screen, **Environment Variables** section — add ALL of these:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | (the Neon connection string) |
   | `NEXTAUTH_URL` | `https://crm.whitecollarrealty.com` |
   | `NEXTAUTH_SECRET` | generate one: `openssl rand -base64 32` in Git Bash |
   | `WHATSAPP_VERIFY_TOKEN` | any secret string you choose |
   | `ANTHROPIC_API_KEY` | (your Anthropic key — optional, leave blank if not yet) |
   | `AI_MODEL` | `claude-haiku-4-5` |

4. Before clicking Deploy: edit `prisma/schema.prisma` and change:
   ```diff
   - provider = "sqlite"
   + provider = "postgresql"
   ```
   Commit & push: `git add . && git commit -m "Switch to Postgres" && git push`. Vercel auto-redeploys.

5. Click **Deploy**. Wait ~2 minutes.

## Step 4 · Run database migration on Neon (3 min)

In Git Bash on your laptop, set the DATABASE_URL to the Neon URL temporarily and run:
```bash
export DATABASE_URL="postgresql://...neon.tech/...?sslmode=require"
npx prisma migrate deploy
npx prisma db seed   # seeds demo users — change passwords after!
```

## Step 5 · Point crm.whitecollarrealty.com at Vercel (5 min)

### In Vercel:
1. Project → **Settings → Domains** → Add `crm.whitecollarrealty.com`. Vercel will show a CNAME target like `cname.vercel-dns.com`.

### In Hostmycode cPanel:
1. Log in to your Hostmycode cPanel.
2. Find **Zone Editor** (or **DNS** / **DNS Manager**).
3. Click **+ CNAME Record**:
   - **Name**: `crm`
   - **Record / Target**: `cname.vercel-dns.com`
   - TTL: leave default
4. Save. Wait 5-30 minutes for DNS to propagate (usually faster).

Vercel auto-provisions a free SSL certificate. Done.

## Step 6 · Update your demo user passwords (CRITICAL)

The seed creates demo users with password `demo1234`. **Change them immediately.**

For now, the easiest way: in Git Bash with the production DATABASE_URL exported:
```bash
node -e "const{PrismaClient}=require('@prisma/client');const b=require('bcryptjs');(async()=>{const p=new PrismaClient();await p.user.update({where:{email:'lalit@whitecollarrealty.com'},data:{passwordHash:await b.hash('YOUR_NEW_PASSWORD',10)}});console.log('updated');await p.\$disconnect();})()"
```

A proper Admin → Users → Edit Password UI is coming in v2.

## Step 7 · Drop the lead form on whitecollarrealty.com

Paste this anywhere on your existing site (works in WordPress as Custom HTML, in any HTML page, in Wix, in Squarespace, etc.):

```html
<script src="https://crm.whitecollarrealty.com/embed.js"
        data-key="wcr_live_website_demo_abcd1234"></script>
<div id="wcr-lead-form" data-project="marina-bay"></div>
```

Replace the `data-key` with the value shown on your CRM **Lead Intake** page after deploy.

Every form submission → instantly creates a lead, dedupes, assigns to next agent, lands on the dashboard.

## Step 8 · Wire up WhatsApp (when ready)

Pick a provider:
- **Meta Cloud API** (cheapest, harder setup) — https://developers.facebook.com/docs/whatsapp/cloud-api
- **Gupshup** (easy, India-friendly) — https://www.gupshup.io
- **Interakt** (simplest) — https://www.interakt.shop

All you need to configure in their dashboard:
- Webhook URL: `https://crm.whitecollarrealty.com/api/intake/whatsapp`
- Verify token: (the `WHATSAPP_VERIFY_TOKEN` you set)
- Headers: `X-WCR-Key: <your whatsapp intake key from /intake page>`

First inbound message → CRM creates the lead automatically.

---

## You're live 🎉

Open `https://crm.whitecollarrealty.com` and log in.
