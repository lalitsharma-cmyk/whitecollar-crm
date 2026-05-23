# White Collar Realty CRM

Full-featured real-estate CRM built for whitecollarrealty.com. Replaces LeadRat for 70% less complexity, with AI features baked in.

## Features

- 🎯 **Lead capture** from Website, WhatsApp, Bulk CSV — auto-dedupe, auto round-robin to next available agent
- 🏢 **Property inventory** — Projects → Units → Pricing
- 📞 **Manual call logging** (IVR-ready schema for Exotel / Knowlarity later)
- 📊 **Sales pipeline** (kanban) — 6 stages, deal value, drag-ready
- 📈 **Live dashboards + Daily/Monthly reports** with CSV export
- 🤖 **AI** — lead scoring, auto-summary, next-best-action, in-CRM chat assistant ("show hot Dubai leads idle for 48h")
- 👥 **Admin / Manager / Agent** roles with permission matrix
- 🌐 **Embeddable lead form** — drop one `<script>` tag into whitecollarrealty.com
- 🔒 **Custom auth** — Server Actions + signed HttpOnly cookies

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · Prisma 6 · SQLite (dev) / Postgres (prod) · Recharts · Anthropic Claude (optional)

## Run locally

```bash
cd whitecollar-crm
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open http://localhost:3000

**Demo accounts** (password `demo1234`):
- `lalit@whitecollarrealty.com` — Admin
- `neha@whitecollarrealty.com` — Manager
- `rahul@whitecollarrealty.com` — Agent

## Deploy to crm.whitecollarrealty.com

See **DEPLOY.md** for a 30-minute step-by-step guide (free tier on Vercel + Neon).
