# Auto-push Google Form submissions into the CRM

5-minute setup. Works for any Google Form — contact form, event registration, anything. Every submission becomes a CRM lead within 30 seconds.

**Cost: ₹0 forever** — uses Google's free Apps Script (runs inside your Google account).

---

## Step 1 · Open your Google Form

Open the Form you want to wire up. Click the **three dots ⋮** (top right) → **Script editor**.

A new Apps Script editor opens.

## Step 2 · Paste this code

Delete whatever is there and paste:

```javascript
// White Collar Realty CRM — auto-push form responses on submit
const CRM_URL = "https://crm.whitecollarrealty.com/api/intake/website";
const CRM_KEY = "wcr_live_website_demo_abcd1234"; // change to your real key — see /intake page

function onFormSubmit(e) {
  const items = e.response.getItemResponses();
  const data = { project: e.source.getTitle() };

  // Map each form question → CRM field
  items.forEach(it => {
    const q = it.getItem().getTitle().toLowerCase().trim();
    const v = it.getResponse();
    if (q.includes("name"))             data.name = v;
    else if (q.includes("phone") || q.includes("mobile") || q.includes("whatsapp"))  data.phone = v;
    else if (q.includes("email"))       data.email = v;
    else if (q.includes("city"))        data.city = v;
    else if (q.includes("budget"))      data.budgetMin = parseFloat(String(v).replace(/[^\d.]/g, ""));
    else if (q.includes("bhk") || q.includes("config")) data.configuration = v;
    else if (q.includes("message") || q.includes("comment") || q.includes("requirement"))
      data.message = (data.message ? data.message + " · " : "") + q + ": " + v;
    else
      // Unknown question — append to message so nothing is lost
      data.message = (data.message ? data.message + " · " : "") + q + ": " + v;
  });

  if (!data.name && !data.phone && !data.email) return; // skip empty

  UrlFetchApp.fetch(CRM_URL, {
    method: "post",
    contentType: "application/json",
    headers: { "X-WCR-Key": CRM_KEY },
    payload: JSON.stringify(data),
    muteHttpExceptions: true,
  });
}
```

## Step 3 · Save + add trigger

1. Click **💾 Save** (top toolbar) — name the project "WCR CRM push"
2. Click **🕐 Triggers** (left sidebar — clock icon)
3. Click **+ Add Trigger** (bottom right)
4. Configure:
   - **Function:** `onFormSubmit`
   - **Deployment:** Head
   - **Event source:** **From form**
   - **Event type:** **On form submit**
5. Click **Save**
6. Google asks for permission → click **Allow** (only YOUR account, not shared)

## Step 4 · Update the API key

1. Sign into the CRM → go to **/intake** → copy your real website API key (looks like `wcr_live_website_demo_abcd1234`)
2. Back in Apps Script, change the `CRM_KEY` constant to your real key
3. Save again (no need to re-add the trigger)

## Step 5 · Test it

1. Open the Form in incognito → submit a test response
2. Within 30 seconds, refresh **/leads** in your CRM — the lead is there
3. It's auto-assigned to your team via round-robin
4. Admins get a notification

---

## Wire up multiple Forms?

Just repeat the same 5 steps for each Form. Each Form has its own Apps Script — they all push to the same CRM. The `project` field will be set to that Form's title automatically.

## What if a question doesn't map?

The script keeps anything it doesn't recognise as part of the **message** field on the lead, so nothing is lost. You can extend the `items.forEach(...)` block with more `q.includes(...)` rules for custom fields like RERA number, broker code, etc.

## Common issues

- **"Authorization required"** in the script editor: click "Review permissions" → choose your Google account → "Allow" (you're authorising YOUR account, not us).
- **Trigger fires but lead doesn't appear:** check the API key is correct + the CRM is live at `https://crm.whitecollarrealty.com`.
- **Multiple submissions stop appearing:** Google Apps Script has a daily quota (~20k triggers/day) — way more than any realistic real-estate volume.
