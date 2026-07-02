// ────────────────────────────────────────────────────────────────────────────
// src/lib/importMapping.ts — SHARED lead-import mapping toolkit
//
// SINGLE SOURCE OF TRUTH for the column→CRM-field mapping used by BOTH lead
// import engines:
//   • /api/intake/csv          (CSV / Excel upload)
//   • /api/intake/google-sheet (public Google Sheet URL)
//
// Previously every route duplicated FIELD_CANDIDATES / matchField / buildMapping
// / makeMappedPick inline, with subtle drift between them. Extracting them here
// makes the Import-Mapping-Approval wizard behave identically across all three UI
// importers (Main CSV, Pre-assigned MIS, Cold-data) AND the Google-Sheet importer,
// and lets the preview "suggested mapping" exactly match what an unconfirmed
// auto-import would do.
//
// PURE module — no "server-only", no prisma, no Next — so scripts/regression.ts
// can import and assert the real implementation.
// ────────────────────────────────────────────────────────────────────────────

export type Confidence = "high" | "medium" | "unknown";

export type Row = Record<string, string>;

/** A single proposed column→CRM-field row in the preview mapping table. */
export interface MappingRow {
  column: string;
  crmField: string; // a CRM field key (a key of FIELD_CANDIDATES) or IGNORE
  confidence: Confidence;
}

/** One assignable CRM target field, for the per-column dropdown. */
export interface CrmFieldOption {
  field: string;
  label: string;
}

/** Sentinel mapping value: send this sheet column to customFields verbatim
 *  (no CRM field), exactly as an unmapped column is preserved today. */
export const IGNORE = "__ignore";

/** Normalize a header/candidate: lowercase, strip every non-alphanumeric.
 *  "Project Name" → "projectname", "Mobile No." → "mobileno". */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// Property-Enquired (→ Lead.sourceDetail) header candidates. Exported so the
// fuzzy pick() fallback in both routes maps every project/property column variant
// even WITHOUT an explicit admin mapping. Mirrors FIELD_CANDIDATES.project.
export const PROJECT_PICK = [
  "project", "projectname", "property", "propertyname", "enquiredproperty",
  "interestedproject", "requirementproject", "towerproject", "tower",
];

// ── Canonical CRM field → header-candidate map ──────────────────────────────
// The FIRST candidate in each list is the canonical/normalized header. Keep in
// sync with every pick(row, …) call in the import routes — the importer reads
// from here.
export const FIELD_CANDIDATES: Record<string, string[]> = {
  name:            ["customer", "name", "fullname", "leadname", "customername", "clientname"],
  phone:           ["mobile", "phone", "contact", "phonenumber", "whatsapp"],
  altPhone:        ["altnumber", "altphone", "alternatephone", "alternatenumber", "alternatemobile", "altmobile", "phone2", "secondarynumber", "secondaryphone"],
  email:           ["email", "emailid", "mail"],
  altEmail:        ["altemail", "alternateemail", "alternativeemail", "email2", "secondaryemail"],
  owner:           ["assigneduser", "assignedto", "assigned", "owner", "agent", "agentname", "salesperson", "assignedagent", "leadowner", "rm"],
  city:            ["city", "location"],
  configuration:   ["configuration", "config", "bhk", "type"],
  budget:          ["budgetaed", "budget", "budgetmin", "minbudget"],
  budgetMax:       ["budgetmax", "maxbudget"],
  currency:        ["currency"],
  country:         ["country"],
  source:          ["source"],
  project:         ["project", "projectname", "property", "propertyname", "enquiredproperty", "interestedproject", "requirementproject", "towerproject", "tower"],
  company:         ["company"],
  address:         ["address"],
  whoIsClient:     ["whoisclient", "client", "clientinfo", "about"],
  categorization:  ["categorization", "category"],
  tags:            ["tags", "tag"],
  message:         ["message", "requirement"],
  // Remarks / conversation column — future-proofed with common header variants so a
  // sheet's remarks aren't dropped (2026-07: many old cold sheets simply had NO
  // remarks column, hence empty timelines; this ensures future sheets that DO carry
  // one are captured). "message" stays a separate field (matched before remarks).
  remarks:         ["remarks", "remark", "conversation", "notes", "comments", "discussion", "lastdiscussion", "clientremarks", "propertydetails"],
  stage:           ["stage"],
  status:          ["status", "callstatus"],
  potential:       ["potential"],
  fundReadiness:   ["fundreadiness", "fund", "funds"],
  moodStatus:      ["moodstatus", "mood"],
  whenCanInvest:   ["whencaninvest", "timeline", "invest"],
  followupDate:    ["followupdate", "followup", "nextfollowup"],
  meeting:         ["meeting", "meetingdate"],
  siteVisit:       ["sitevisit", "sitevisitdate"],
  date:            ["date", "leaddate", "createdon", "createddate", "entrydate"],
  lastContact:     ["lastcontact", "lastcontactdate", "lastcalldate", "lastcall", "calleddate", "lastcontacted"],
  detailShared:    ["detailshared", "shared"],
  todoNext:        ["todo", "todonext", "nextaction"],
  team:            ["forwardedteam", "team"],
  alreadyBought:   ["alreadybought", "alreadyowns", "owns", "purchased"],
  alreadyBoughtBy: ["alreadyboughtby", "boughtvia", "via", "broker", "boughtfrom"],
};

// Human-readable labels surfaced in the per-column dropdown.
export const FIELD_LABELS: Record<string, string> = {
  name: "Name / Customer", phone: "Phone (mobile)", altPhone: "Alt phone",
  email: "Email", altEmail: "Alt email", owner: "Assigned User / Agent",
  city: "City / Location", configuration: "Configuration / BHK",
  budget: "Budget", budgetMax: "Budget (max)", currency: "Currency", country: "Country",
  source: "Source", project: "Property Enquired / Project", company: "Company", address: "Address",
  whoIsClient: "Who is client", categorization: "Categorization", tags: "Tags",
  message: "Message / Requirement", remarks: "Remarks", stage: "Stage", status: "Status / Call status",
  potential: "Potential", fundReadiness: "Fund readiness", moodStatus: "Mood",
  whenCanInvest: "When can invest", followupDate: "Follow-up date", meeting: "Meeting date",
  siteVisit: "Site-visit date", date: "Lead date (historic)", lastContact: "Last contact date",
  detailShared: "Detail shared", todoNext: "To-do / Next action", team: "Team",
  alreadyBought: "Already bought", alreadyBoughtBy: "Already bought via",
};

/** Canonical lead-import template headers, in field-catalog order. Human-readable
 *  labels (FIELD_LABELS) so a non-technical user knows what each column is; the
 *  import wizard auto-maps every one of them back to its CRM field on re-import.
 *  Shared by Leads, Master Data and Revival (they all import via the same wizard). */
export function leadTemplateHeaders(): string[] {
  return Object.keys(FIELD_CANDIDATES).map((f) => FIELD_LABELS[f] ?? f);
}

/** The full catalog of assignable CRM fields, for the per-column dropdown. */
export function crmFieldOptions(): CrmFieldOption[] {
  return Object.keys(FIELD_CANDIDATES).map((field) => ({
    field,
    label: FIELD_LABELS[field] ?? field,
  }));
}

// Score how well a sheet header matches a CRM field's candidate list, using the
// SAME normalized-prefix logic pick() relies on. Exact normalized equality →
// high. A prefix relation in EITHER direction (header ⊂ candidate, e.g.
// "mob"→"mobile", or header ⊃ candidate, e.g. "sourcecampaign"⊃"source") → med.
export function matchField(header: string, candidates: string[]): Confidence | null {
  const nk = norm(header);
  if (!nk) return null;
  for (const c of candidates) {
    const t = norm(c);
    if (nk === t) return "high";
  }
  for (const c of candidates) {
    const t = norm(c);
    if (nk.startsWith(t) || t.startsWith(nk)) return "medium";
  }
  return null;
}

// Build the preview mapping: for each detected column, the best CRM field +
// confidence. A column wins a field on the strongest match; ties resolve to the
// FIRST field declared in FIELD_CANDIDATES (declaration order = priority, same
// as pick() which tries name→phone→… top-down). Columns matching nothing are
// reported as { crmField: IGNORE, confidence: "unknown" } and highlighted.
export function buildMapping(columns: string[]): MappingRow[] {
  const fields = Object.entries(FIELD_CANDIDATES);
  return columns.map((column) => {
    let best: { crmField: string; confidence: Confidence } | null = null;
    for (const [field, candidates] of fields) {
      const conf = matchField(column, candidates);
      if (!conf) continue;
      // Prefer high over medium; on equal strength keep the earlier-declared field.
      if (!best || (conf === "high" && best.confidence !== "high")) {
        best = { crmField: field, confidence: conf };
        if (conf === "high") break; // can't beat an exact match
      }
    }
    return best
      ? { column, crmField: best.crmField, confidence: best.confidence }
      : { column, crmField: IGNORE, confidence: "unknown" as Confidence };
  });
}

/**
 * Fuzzy field reader (the historical auto-detect path). For a CRM field's
 * candidate list, return the first non-empty cell whose header matches. Marks
 * the consumed header in `consumed` so every OTHER column is preserved verbatim
 * in customFields. Pass a fresh Set per row.
 */
export function pick(row: Row, consumed: Set<string>, ...candidates: string[]): string | undefined {
  const wanted = candidates.map(norm).filter(Boolean);
  for (const k of Object.keys(row)) {
    const nk = norm(k);
    // A blank / symbol-only header normalizes to "" and would WILDCARD-match every
    // field — `t.startsWith("")` is always true — so the first such column (e.g. a
    // leading index/serial column) would leak its value into city/budget/remarks/…
    // for EVERY row. Skip it: a column with no real header can't map to a CRM field.
    // (It is still preserved verbatim in rawImport for audit.)
    if (!nk) continue;
    for (const t of wanted) {
      if (nk === t || nk.startsWith(t) || t.startsWith(nk)) {
        // Count as "mapped" (hidden from customFields) ONLY on an exact match or
        // when the header is a PREFIX of the candidate ("mob"→"mobile"). When the
        // header EXTENDS a candidate ("sourcecampaign" ⊃ "source", "investmenttype"
        // ⊃ "invest", "clientcategory" ⊃ "client") it's almost always a DIFFERENT
        // column that only prefix-collides — keep it as a preserved custom field so
        // no sheet data (and no original value) is ever lost.
        if (nk === t || t.startsWith(nk)) consumed.add(k);
        const v = row[k]?.toString().trim();
        if (v) return v;
      }
    }
  }
}

/**
 * Explicit-mapping accessor factory. When the admin confirms a mapping in the
 * approval gate, the importer reads CRM fields THROUGH this instead of pick():
 * resolve a field → the admin-chosen sheet column → that cell's value, marking
 * the column consumed (in `consumed`) so it isn't duplicated into customFields.
 * IGNORE columns resolve to nothing (and stay in customFields verbatim).
 */
export function makeMappedPick(row: Row, mapping: Record<string, string>, consumed: Set<string>) {
  // Normalize the admin map once: normalized-sheet-column → crmField.
  const byNormCol = new Map<string, string>();
  for (const [col, field] of Object.entries(mapping)) {
    if (field && field !== IGNORE) byNormCol.set(norm(col), field);
  }
  // Reverse index: crmField → actual row key(s) the admin assigned to it.
  const fieldToKeys = new Map<string, string[]>();
  for (const k of Object.keys(row)) {
    const field = byNormCol.get(norm(k));
    if (!field) continue;
    const arr = fieldToKeys.get(field) ?? [];
    arr.push(k);
    fieldToKeys.set(field, arr);
  }
  return (field: string): string | undefined => {
    const keys = fieldToKeys.get(field);
    if (!keys) return undefined;
    for (const k of keys) {
      consumed.add(k);
      const v = row[k]?.toString().trim();
      if (v) return v;
    }
    return undefined;
  };
}

/** Parse the client-sent `mapping` JSON (form field or JSON body) into a clean
 *  `{ "<sheet header>": "<crmField | IGNORE>" }` map, or null when absent/invalid
 *  (→ caller falls back to fuzzy auto-detect, fully backward compatible). */
export function parseClientMapping(raw: unknown): Record<string, string> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" && v) clean[k] = v;
      }
      if (Object.keys(clean).length > 0) return clean;
    }
  } catch {
    /* malformed mapping → ignore, fall back to auto-pick */
  }
  return null;
}

// ── Duplicate handling mode ─────────────────────────────────────────────────
// The wizard lets the admin choose what happens to a row that matches an
// existing ACTIVE lead (by phone+email fingerprint):
//   merge        → (DEFAULT, legacy behaviour) enrich the existing lead with any
//                  new non-blank values; never overwrites a set field with blank.
//   skip         → leave the existing lead 100% untouched (no enrich, no remark).
//   update       → overwrite the existing lead's mapped fields with the sheet's
//                  values (sheet wins) — same write path as merge but blanks are
//                  still ignored; the difference is conceptual/intent + UI label.
//   create       → import as a brand-new lead anyway (do NOT dedupe).
//   conversation → append the row's remark to the existing lead's history only;
//                  touch no structured field.
//   revival      → RE-ENGAGE an existing lead (the Revival Engine's import mode).
//                  Strictly NON-DESTRUCTIVE: fill-if-empty merge (never overwrites
//                  a non-blank field), APPEND imported remarks (mergeRawRemark),
//                  write a NOTE Smart-Timeline entry, move the lead into the
//                  Revival bucket (leadOrigin=REVIVAL + isColdCall=true), stamp a
//                  revival source, union tags, and write a per-field
//                  LeadFieldHistory audit. A brand-new row still CREATES the lead.
//                  Unlike "skip", an existing match is PROCESSED, never discarded —
//                  Revival exists to re-engage leads that already exist. See
//                  applyRevivalMerge() in src/lib/revivalImport.ts.
export type DupMode = "merge" | "skip" | "update" | "create" | "conversation" | "revival";

export function parseDupMode(raw: unknown): DupMode {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "skip" || v === "update" || v === "create" || v === "conversation" || v === "revival"
    ? (v as DupMode)
    : "merge";
}

// ── Preview duplicate-detection keys ─────────────────────────────────────────
// The import PREVIEW counts a row as a duplicate if ANY of its contact points
// already exists as an active lead. Historically the preview only matched the
// primary phone (the fingerprint startsWith check). This widens the preview to
// the SAME contact points the user maps: primary phone, alternate phone, primary
// email, alternate email. Returns the normalized keys for one row:
//   • phones → last-10 digits (matches Lead.phone / Lead.altPhone endsWith key)
//   • emails → trimmed lowercase (matches Lead.email / Lead.altEmail equals key)
// Pure + dependency-free so the CSV/Sheet routes and the regression suite share it.
export interface DupKeyInput {
  phone?: string;
  altPhone?: string;
  email?: string;
  altEmail?: string;
}
export interface DupKeys {
  phoneTails: string[];   // last-10-digit phone keys (primary + alt)
  emails: string[];       // lowercased email keys (primary + alt)
}
export function dupKeysForRow(input: DupKeyInput): DupKeys {
  const tail = (s?: string): string => (s ?? "").replace(/\D/g, "").slice(-10);
  const lc = (s?: string): string => (s ?? "").trim().toLowerCase();
  const phoneTails = [tail(input.phone), tail(input.altPhone)].filter((d) => d.length >= 7);
  const emails = [lc(input.email), lc(input.altEmail)].filter((e) => e.includes("@") && e.length >= 5);
  // De-dup so a row that repeats the same contact in two columns isn't double-counted.
  return { phoneTails: [...new Set(phoneTails)], emails: [...new Set(emails)] };
}
