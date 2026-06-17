# WCR CRM — Manual QA Checklist (for the team)

> Hand-off doc. The **logic / data / access-control** layer is already covered by an
> automated suite (`npm run regression` + the detailed QA pass — **44/44 green** as of
> commit `de1e02d`). This checklist is the **browser click-through** layer: things a
> human must confirm while logged in, because they can't be automated from outside the
> login. Tick each box; note the build commit you tested (`/api/health` shows it).
>
> **How to use:** log in as each role, walk its section, record PASS/FAIL + a note.
> Anything that fails → screenshot the page + the `Ref:` code on the error screen and
> send it back.

Build under test: `__________`  ·  Tester: `__________`  ·  Date: `__________`

---

## 0. Pre-flight
- [ ] `/api/health` returns `{"ok":true}` and the expected commit.
- [ ] Hard-refresh once (`Ctrl+Shift+R`) so you're not on a stale cached bundle.
- [ ] Note: **Testing Mode is ON** in prod — WhatsApp / auto-assignment / escalations /
      notifications / scheduled actions are intentionally **suppressed**. Manual calls/WA
      still work. Don't file "automation didn't fire" as a bug while this banner shows.

---

## 1. Access by role (the most important section)
Log in as each role and confirm the **left menu** and **page access** match:

| Item | ADMIN / Super | MANAGER | AGENT |
|---|---|---|---|
| Master Data (menu, above Leads) | ✅ visible | ❌ hidden | ❌ hidden |
| `/master-data` typed directly | opens | →redirects to Dashboard | →redirects to Dashboard |
| Reports, Call Logs | ✅ | ✅ | ❌ hidden |
| Lead Intake / Admin section | ✅ | per config | ❌ |
| A lead they don't own (`/leads/<id>`) | opens (all) | own team only | →redirects to /leads |

- [ ] ADMIN: Master Data appears **above** Leads in the left menu.
- [ ] MANAGER: no Master Data link; typing `/master-data` bounces to Dashboard.
- [ ] AGENT: no Master Data, no Reports; sees only their own leads.
- [ ] AGENT opening a peer's lead by URL → redirected to `/leads` (not shown).

## 2. Master Data (ADMIN)
- [ ] Page loads at `/master-data` (NOT `/master-data/page.tsx`).
- [ ] Category tabs show counts: All / Workable / Closed / Lost / Deleted / Archived.
- [ ] Clicking a category filters the table and the counts make sense.
- [ ] **Filters** button opens the same panel as the Leads page (status, source, owner,
      budget range, timeline, client type, city, category, dates, sort, tags).
- [ ] Apply a filter → table updates, an active **chip** appears, chip ✕ removes it.
- [ ] Filter + category compose (e.g. Source=WhatsApp + Lost tab shows only those).
- [ ] **Lead type** pills (Sales / +Cold / Cold only) switch the dataset.
- [ ] Select rows → bulk bar appears: Move to Leads / Revival / Assign / Set Status / Export.
- [ ] **Delete** (soft) button shows **only** for Super Admin; restores from Deleted tab.
- [ ] Export CSV downloads the current view.
- [ ] Click a row → opens that lead; Back returns to the **same filtered** Master Data view.

## 3. Leads list + detail
- [ ] Default Leads view shows Today + Overdue follow-ups.
- [ ] Filters panel behaves identically to Master Data (same engine).
- [ ] Open a lead: name, contact, budget, status, BANT, conversation history render.
- [ ] Inline-edit a field as ADMIN (name/phone/email/budget/source) → saves.
- [ ] As AGENT, name/phone/email are **not** editable (admin-only message).
- [ ] **Reject lead** button appears in **two** places: the always-visible header **and**
      the Admin tab. Rejecting requires a reason + remark.

## 4. Budget correctness (recent fix)
- [ ] No lead shows a **non-numeric** budget (e.g. a person's name like "Lalit Sir").
- [ ] Leads whose budget was never clearly stated show **blank**, not a guessed range.
- [ ] ADMIN can clear/correct a budget; agents edit the numeric value.
- [ ] Spot-check 5 random leads: budget either matches the imported text or is blank.

## 5. Deleted / recycle-bin leads (must stay hidden)
A deleted lead must **NOT** appear in any of these. Delete a test lead, then check:
- [ ] Leads list, Quick Search, Reports, Dashboard counts.
- [ ] "Previous History Found" / duplicate banner on another lead with same phone/email.
- [ ] Re-importing the same person creates a **fresh** lead (deleted copy is ignored).
- [ ] Master Data → **Deleted** tab shows it; **Restore** brings it back.
- [ ] Its pending reminders/notifications are gone after delete.

## 6. Import (ADMIN only)
- [ ] CSV / Google-Sheet import is reachable only by ADMIN.
- [ ] Source column is preserved verbatim (Townscript / Eventbrite / WhatsApp / etc.),
      never flattened to "CSV".
- [ ] Garbage in a budget/email/phone cell is dropped, not written into the wrong field.
- [ ] Remarks import in full (no truncation); conversation history shows newest-first.

## 7. Notifications & sound
- [ ] In-app bell plays a sound on a new notification (mute toggle in the bell works).
- [ ] *(Outside testing mode)* lead assignment → browser/PWA push, opens the lead on click.

## 8. Mobile / responsive
- [ ] On a phone, bottom nav + hamburger drawer work; Master Data is in the drawer (admin).
- [ ] Lead detail, filters, and tables are usable on a narrow screen.

---

## Known limitations / not-bugs
- **Testing Mode ON** suppresses automation (see §0) — by design until go-live.
- **AI engines** are intentionally OFF pending a provider decision (Claude/GPT/Gemini).
- **6 import leads** have unrecoverable garbage phone numbers — flagged, awaiting the
  original `.xlsx` to fix. (Anita Handa, Mohammed irfan Rahman, "Unknown", Megha Sharma,
  Meharban Singh, Hasan Esat Şimşek.)
- Custom in-app notification sound only plays when the CRM tab is open; when closed, the
  OS default sound is used (browser limitation, not a bug).

## How to report a failure
For each FAIL: page URL · role you were logged in as · what you expected · what happened ·
screenshot · the `Ref:` code if an error screen appeared.
