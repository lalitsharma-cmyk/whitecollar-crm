# Smart CMA + Voice Record — Spec proposal

For: Lalit Sharma (non-technical). Plain English; no code.

---

## Part 1 · Smart CMA

### What it is

CMA stands for **Comparable Market Analysis**. In real estate, it is the one-page answer to the client's most common question: "Is this price fair?" A CMA picks 3–5 similar properties — same city/area, similar size, similar configuration (e.g. 2BHK, ~1200 sqft, sea view) — and shows their prices side-by-side with the unit the client is considering. It tells the client whether they are looking at a deal, a market-rate offer, or an overpriced unit.

### Why a CRM should have it

Today, when a Dubai or India agent gets a serious lead interested in, say, Emaar Beachfront Tower B, Unit 1804, the agent opens 3 browser tabs: 99acres / PropertyFinder / Bayut, manually filters for "2BHK in Marina under AED 3M", screenshots three listings, drops them into WhatsApp with a typed "Sir, this one is well-priced." It takes 10–15 minutes per lead and the comparables are inconsistent. Smart CMA replaces that with one button on the lead page that produces a clean, branded CMA card the agent can send. Outcome: faster reply (clients drop off after 30 mins of silence), more consistent pitch, and the manager can audit which comparables were shown.

### 3 options

#### (a) Lookalike from our inventory

- **What the agent sees:** On a lead's detail page, next to each interested unit (`LeadProperty`), a "Show CMA" button. Click it → a card opens with the lead's primary unit on the left and 3 lookalike units from our own `Project`/`Unit` catalog on the right, ranked by similarity. Each shows price, sqft, configuration, project, view. One click to "Send as WhatsApp message" using existing WA templates.
- **What we'd build:**
  - Similarity-ranking helper that scores units by configuration match, ±20% price band, same city, same area, similar carpet area
  - Excludes `SOLD` / `BOOKED` units, includes `AVAILABLE` and `HOLD`
  - Renders an HTML card (also a print-friendly PDF later)
  - New WhatsApp template: "CMA report for [project]"
  - Saves the chosen comparables to a new `CmaReport` table for audit
- **Data we already have:** `Project.{name, area, city, status}`, `Unit.{configuration, carpetArea, priceBase, view, status}`, `LeadProperty` (which units the lead is interested in). **Data we'd need to add:** a tiny `CmaReport` table to log which comparables were shown to which lead (for audit + reuse).
- **Effort:** S (1–2 days)
- **AI dependency:** Works without Claude. Pure SQL ranking.

#### (b) Market-data import

- **What the agent sees:** Same CMA card as (a), but the 3 comparables now include "External market listings" — recent sale or listing prices pulled from 99acres / MagicBricks / PropertyFinder for the same area + configuration. The card clearly labels which row is "Our inventory" vs "Market listing."
- **What we'd build:**
  - A scheduled importer (daily cron, lives in `.github/workflows/cron.yml`) that scrapes or pulls via paid API a market-price feed for top 20 areas (Dubai Marina, Downtown, Gurgaon Sec 65, etc.)
  - New `MarketListing` table: area, configuration, sqft, listedPrice, source URL, fetchedAt
  - CMA ranker now blends our `Unit` rows with `MarketListing` rows
  - Legal: store source URL + screenshot for compliance
  - Stale data warning: hide listings older than 30 days
- **Data we already have:** Same as (a). **Data we'd need to add:** `MarketListing` table + a scraping/API integration. 99acres has no public API; PropertyFinder Dubai does (paid). MagicBricks needs scraping or a partnership.
- **Effort:** L (2–3 weeks; legal review needed)
- **AI dependency:** Works without Claude.

#### (c) AI-generated CMA narrative

- **What the agent sees:** Below the CMA card from (a), a 5-line paragraph written by Claude: "This 2BHK at AED 2.8M is priced ~6% below the area median for Dubai Marina sea-view units. Comparable units at [Project X] are 8% higher with similar specs. Strong investor pick for rental yield given current rates. Recommend pushing for an early site visit." The agent can edit before sending.
- **What we'd build:**
  - Claude prompt that takes: lead's interested unit, 3 comparables (from option a), lead's `aiSummary`/`whoIsClient` for tone, recent activity context
  - Caches result on the new `CmaReport` row to avoid re-prompting
  - Cost guardrail: only generate on explicit "Generate narrative" click, not auto
  - Falls back gracefully if Anthropic key missing
- **Data we already have:** Everything from (a) plus `Lead.aiSummary`, `Lead.whoIsClient`, recent `Activity`. **Data we'd need to add:** Nothing new — `CmaReport.narrative` column on the same table from (a).
- **Effort:** S on top of (a) (+1 day)
- **AI dependency:** Requires Claude.

### Recommendation

**Ship (a) first, then layer (c) on top within the same release.** Option (a) delivers value on day one using data we already own — zero external dependencies, zero legal risk, and it works even when Claude is rate-limited. Adding (c) as an opt-in "Generate narrative" button on the same card gives Lalit the impressive AI-feeling demo for clients without making CMA depend on Claude uptime. Skip (b) for now: market-data licensing/scraping is a 3-week side-quest that distracts from the 80% win.

---

## Part 2 · Voice Record

### What it could mean

The phrase "voice record" in Lalit's feedback is ambiguous — three very different features hide under the same two words, and they don't share much code. Picking one wrong wastes a sprint:

1. **Call recordings** — the audio of phone calls between agent and lead, captured server-side by the telephony provider (Acefone, in our case). The agent doesn't do anything; the recording just appears on the call log for the manager to spot-check.
2. **Voice notes by agent** — short audio memos the agent records on their phone (in the parking lot after a site visit, etc.) and attaches to the lead, like a sticky note but spoken.
3. **Voice-to-text for hands-free logging** — the agent, while driving between meetings, speaks "log call with Rahul, didn't pick up, will call tomorrow morning," and the CRM converts that into a proper `CallLog` row + follow-up `Activity`.

### 3 options

#### (a) Acefone call recording integration

- **What the agent sees:** Every completed call in the call log gets a small "▶ Play" button. Click it → the recording streams inline (no download). On the lead detail page, the call log card now shows a waveform + duration + play button. The manager's `/admin/calls` page gets a "filter by has-recording" toggle for QC spot-checks.
- **What we'd build:**
  - Extend `/api/acefone/webhook` to read the recording URL Acefone sends in its call-end payload and persist to `CallLog.recordingUrl` (column already exists, currently always null)
  - Tiny audio-player React component for the lead detail page
  - Permission check: agents can play their own calls + their team's; managers see all
  - Recording storage stays on Acefone's CDN (signed URLs); we just store the URL — no S3 bill
  - Retention setting in `Setting` table (default 90 days)
- **Data we already have:** `CallLog.recordingUrl` column exists. Acefone webhook handler exists. Click-to-call already routes through `src/lib/acefone.ts`. **Data we'd need to add:** Nothing in the schema. Just wire the webhook → column → UI.
- **Effort:** S (2–3 days)
- **AI dependency:** Works without Claude.

#### (b) Voice notes on lead

- **What the agent sees:** On the lead detail page, next to the "Add note" button, a new "🎤 Voice note" button. Tap → records on the phone's mic (browser MediaRecorder API). Stop → upload. Within ~10 seconds, a transcript appears as a regular `Note` on the lead, with the original audio still playable inline. Works on iPhone Safari + Android Chrome.
- **What we'd build:**
  - Upload endpoint that accepts the audio blob (mp3/m4a/webm)
  - Audio stored either as base64 in DB (small clips, like we do for user photos) or on a cheap S3 bucket if longer
  - Transcription via Claude's audio-input capability or a Whisper-style service (Deepgram/AssemblyAI — pennies per minute)
  - Saves transcribed text as a `Note` row + a new `attachmentUrl` column on `Note` pointing to the audio
  - Multilingual: detects Hindi/English mix automatically (common for India team)
- **Data we already have:** `Note` table exists. **Data we'd need to add:** `Note.attachmentUrl` + `Note.attachmentKind` columns. Plus a small storage decision (DB vs S3).
- **Effort:** M (1 week)
- **AI dependency:** Depends on a transcription service (Claude audio or Whisper-style).

#### (c) Voice command logging

- **What the agent sees:** A floating "🎤 Quick log" button on every page. Tap → speak: "Called Rahul Sharma, didn't pick up, try again tomorrow at 11." Stop → CRM finds the lead by name (or asks to disambiguate), creates a `CallLog` with outcome=NOT_PICKED, and a planned `Activity` for tomorrow 11am. Agent confirms with one tap.
- **What we'd build:**
  - Same audio capture as (b)
  - Transcription → Claude prompt that parses transcript into structured `{leadName, outcome, followupAt, note}`
  - Fuzzy lead lookup (`name` + `phone` similarity)
  - Confirmation screen (agent must tap "Save" before anything writes — prevents bad parse from corrupting data)
  - Same audio storage decision as (b)
- **Data we already have:** `CallLog`, `Activity`, `Lead` all exist with the right fields. **Data we'd need to add:** Same as (b).
- **Effort:** L (2 weeks; lots of edge cases — wrong lead match, multi-lead names, partial transcripts)
- **AI dependency:** Requires Claude.

### Recommendation

**Ship (a) first.** It uses a column that already exists in `CallLog`, leverages the Acefone integration we already pay for, and immediately unlocks manager QC — Lalit's recurring pain point. It is also the option most likely to be what Lalit actually meant by "voice record" — when sales managers say "voice record" in casual conversation, 8 times out of 10 they mean call recordings. Option (b) is a strong second sprint once (a) is live. Option (c) is a year-2 wish: high effort, high error rate, and most agents end up just typing on their phone anyway.

---

## Decision needed from Lalit

- **CMA:** Should the first version use only our own inventory (`Project`/`Unit`), or do you want me to budget 2–3 weeks to also pull in 99acres / PropertyFinder listings?
- **CMA:** Who sees a CMA card — only the agent, or do you want the manager to see every CMA that went out (for coaching)?
- **Voice:** When you wrote "voice record" — did you mean (1) playback of phone calls in the CRM, (2) agent voice notes attached to leads, or (3) hands-free logging while driving? Pick one for v1.
- **Voice:** Is your Acefone plan currently saving call recordings on their side? If not, we need to enable that in the Acefone dashboard before (a) can work.
- **Both:** Are these features India-only, Dubai-only, or both teams from day one? (Affects regulatory review — UAE has stricter call-recording consent rules than India.)
