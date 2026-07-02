# Import Wizard & Templates

> How bulk data (leads, buyers) is imported into the CRM: the wizard, the
> duplicate-handling modes, "safe mode", and the exact downloadable templates.
> **Only admins can import.**

## 1. The two import engines

There are two separate import engines:

| Engine | Feeds | Wizard | Template |
|---|---|---|---|
| **Lead-family** | Leads, Master Data, Revival/Cold | `LeadImportWizard` | one shared Lead template |
| **Buyer** | Dubai Buyer, India Buyer | `BuyerImportClient` | one shared Buyer template |

Within each engine the modules share the *same* code and template — they differ
only by a couple of settings (which duplicate mode is preselected, and, for buyers,
a `market="India"` flag that stamps every row as India/INR).

**Where imported leads land:** all lead-family bulk imports arrive in **Master
Data** (`leadOrigin=MASTER_DATA`, the untriaged repository) and are then manually
moved into Leads or Revival — *except* cold imports, which go straight to the
Revival Engine (`leadOrigin=REVIVAL`, `isColdCall=true`, unassigned). Buyer imports
land in the Buyer bank for their market.

## 2. Who can import — ADMIN only

Every import path is gated to **ADMIN** at both the page and the API. Non-admins are
redirected from the pages and get `403` from the APIs.

| Route | Gate |
|---|---|
| `POST /api/intake/csv` (lead-family CSV/Excel) | `requireRole("ADMIN")` |
| `POST /api/intake/google-sheet` (lead-family Google Sheet) | ADMIN |
| `POST /api/buyer-data/import` (Dubai + India buyers) | ADMIN — 403 "Admin only — buyer data is restricted" (passport + financial data) |
| `POST /api/master-data/bulk` | ADMIN — 403 "Master Data actions are admin only" |
| Buyer & Master Data pages | redirect non-admins to `/dashboard` |

`soft_delete` on the Master Data bulk route is stricter still — **Super-Admin only**.

## 3. Safe mode & dry-run (lead-family)

The lead importer is intentionally two-step so nothing is written by accident:

- **Safe Mode (always on during import):** while importing, *no* WhatsApp, emails,
  round-robin auto-assignment, or SLA alerts fire. Importing 1,000 old leads never
  triggers 1,000 welcome messages. This is enforced server-side (the preview
  response confirms it via `automationNote`).
- **Dry-run / preview:** the first upload is a preview only (`?preview=1`) — it
  parses the file, checks for duplicates, and reports counts (rows, duplicates,
  rows missing required fields), sample duplicates, and the proposed
  column-to-field mapping, plus the first 10 rows. **Nothing is written.**
- **Confirmation gate:** the admin must tick **"I confirm this column mapping is
  correct"** before the real import runs. The server refuses to write without it.

The **buyer** importer has no server dry-run; instead it detects headers and maps
columns in the browser first, then imports in chunks of 200 rows.

## 4. Duplicate-handling modes

### Lead-family (6 modes)

A row matches an existing **active** lead by phone (normalised) or email
(lower-cased). Soft-deleted/recycled leads are never matched (re-importing them
re-creates them).

| Mode | Wizard label | What it does |
|---|---|---|
| `merge` | Merge / enrich | **Legacy default.** Fill in blank fields on the existing lead from the sheet; never overwrites a set value with a blank |
| `skip` | Skip duplicate | Leave the existing lead 100% untouched (counts as a duplicate) |
| `update` | Update existing | Sheet values win onto the existing lead (blanks still ignored) |
| `create` | Create new anyway | Import as a brand-new lead even if a match exists (no dedup) |
| `conversation` | Add as conversation | Append only the row's remark to the existing lead's history; touch no fields |
| `revival` | Revive existing | Non-destructive re-engage: fill-if-empty + append remarks + timeline note + move the lead into the Revival Engine, with per-field history audit |

The default preselected mode is set per module: Master Data → `skip`, Revival →
`revival`.

### Buyer (4 modes, default `skip`)

A row matches a live buyer **within the same market** (an India import never matches
a Dubai buyer) by name+phone, phone tail, or email.

| Mode | Label | What it does |
|---|---|---|
| `skip` | Skip duplicate | **Default.** Leave the existing buyer untouched |
| `update` | Update existing | Fill the existing buyer's blank fields only + append the new remark |
| `history` | Add to conversation history | Append only the imported remark to the buyer's timeline; touch no fields |
| `create` | Create new anyway | Import as a brand-new buyer even if one matches |

Re-importing the same buyer sheet is idempotent for the timeline — previously
imported timeline rows are rebuilt, not duplicated.

## 5. Downloadable templates (exact headers)

Each module offers a **"Download template"** button that produces a blank CSV. The
column order matches the import mapper, so a file built from the template imports at
full auto-map confidence.

### Shared Lead template (Leads = Master Data = Revival)

Filename varies by module (`leads-import-template.csv` /
`master-data-import-template.csv` / `revival-import-template.csv`) but the
**contents are identical**. Headers, in order:

```
Name / Customer, Phone (mobile), Alt phone, Email, Alt email,
Assigned User / Agent, City / Location, Configuration / BHK, Budget, Budget (max),
Currency, Country, Source, Property Enquired / Project, Company, Address,
Who is client, Categorization, Tags, Message / Requirement, Remarks, Stage,
Status / Call status, Potential, Fund readiness, Mood, When can invest,
Follow-up date, Meeting date, Site-visit date, Lead date (historic),
Last contact date, Detail shared, To-do / Next action, Team, Already bought,
Already bought via
```

Only Name and Phone are meaningfully required; everything else is optional. Defined
in [`src/lib/importMapping.ts`](../src/lib/importMapping.ts).

### Buyer template (Dubai = India)

Filename differs (`dubai-buyer-import-template.csv` vs
`india-buyer-import-template.csv`) but the **contents are identical** — India is
distinguished only by the page it's uploaded from (which stamps `market="India"`,
INR/Cr). Headers, in order:

```
Client Name, Co-Buyers, Phone, Email, Passport No, Passport Expiry, Nationality,
Registered Owner, Country, Developer, Project, Tower, Unit, Property Type,
Configuration, Size, Actual Size, Area, Transaction Value, Price Per SqFt,
Transaction Date, Transaction ID, Transaction Type, Role, Agent, Remarks
```

Only Client Name is required. All conversation/status/history text goes in the
single **Remarks** column, so dated conversations feed the Smart Timeline. Defined
in [`src/lib/buyerImportMap.ts`](../src/lib/buyerImportMap.ts).

## 6. The Source column (canonical values)

The manual **Source** picker allows exactly these 10 values (see
[`src/lib/lead-sources.ts`](../src/lib/lead-sources.ts)):

`Website · WCR Event · Landing Page · Referral · Facebook Ads · Google Ads ·
Portal 99acres · Portal MagicBricks · Portal Housing · Other`

Deliberately **not** in the picker:

- `CSV Import` — set automatically by imports, never a manual choice.
- **WhatsApp / Inbound Call / Email / Event** — these are **channels**, and now live
  in the separate **Medium** field, not Source. (Historical data that used them
  still displays; they just can't be re-selected.)

When importing, if a sheet's "Source" column contains a channel like WhatsApp/Call/
Email, the importer records `Website` as the Source, sets the **Medium**
accordingly, and keeps the verbatim original in `sourceRaw`. Unrecognised values
become `Other` (never silently relabelled).

## 7. Engineer appendix — key files

| Purpose | Path |
|---|---|
| Lead wizard UI | `src/components/LeadImportWizard.tsx` |
| Lead mapping + template headers | `src/lib/importMapping.ts` |
| Lead CSV/Excel API | `src/app/api/intake/csv/route.ts` |
| Lead Google-Sheet API | `src/app/api/intake/google-sheet/route.ts` |
| Revival merge helper | `src/lib/revivalImport.ts` |
| Buyer wizard UI | `src/components/BuyerImportClient.tsx` |
| Buyer mapping + template headers | `src/lib/buyerImportMap.ts` |
| Buyer import API | `src/app/api/buyer-data/import/route.ts` |
| Buyer import pages | `src/app/(app)/buyer-data/import/page.tsx`, `.../india-buyer-data/import/page.tsx` |
| Master Data bulk API | `src/app/api/master-data/bulk/route.ts` |
| Source allow-list | `src/lib/lead-sources.ts` |
