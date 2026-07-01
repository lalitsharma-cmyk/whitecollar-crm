// ────────────────────────────────────────────────────────────────────────────
// src/lib/buyerImportMap.ts — SHARED buyer-import mapping toolkit (#249)
//
// SINGLE SOURCE OF TRUTH for the column→BuyerRecord-field mapping used by the
// buyer import wizard (BuyerImportClient) AND the canonical downloadable template.
// Mirrors the proven shape of src/lib/importMapping.ts (the lead importer) so the
// two importers behave identically and scripts/regression.ts can assert the real
// implementation.
//
// PURE module — no "server-only", no prisma, no Next — importable from the
// regression harness and the client wizard alike.
// ────────────────────────────────────────────────────────────────────────────

export type Confidence = "high" | "medium" | "unknown";

/** Sentinels (match the wizard's existing ColTarget vocabulary). */
export const KEEP = "__keep"; // → preserve in extraFields verbatim (unmapped)
export const SKIP = "__skip"; // → drop from typed columns (still kept in rawImport)

/** Normalize a header: lowercase, strip every non-alphanumeric.
 *  "Price / sq.ft" → "pricesqft", "Passport No." → "passportno". Identical to
 *  importMapping.norm so both importers match the same way. */
export function normHeader(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// ── Canonical BuyerRecord field → header-alias map ──────────────────────────
// The FIRST alias in each list is the canonical header used by the downloadable
// template (so a file made from the template re-imports at 100% confidence).
// IMPORTANT: every conversation/status/history alias stays under `remarks` ONLY —
// the import route rescues conversation/status columns out of extraFields into
// remarks (pickConversation/composeFromExtra); binding them to a typed field
// would strand dated conversations and break the Smart Timeline.
export const BUYER_FIELD_ALIASES: Record<string, string[]> = {
  clientName:       ["Client Name", "buyer name", "name", "customer", "customer name", "name of buyer", "purchaser", "applicant", "primary buyer", "full name", "client"],
  coBuyerNames:     ["Co-Buyers", "co buyer", "cobuyer", "joint buyer", "co applicant", "co-applicant", "second buyer", "secondary buyer", "co owner", "joint owner"],
  phones:           ["Phone", "phones", "mobile", "mobile number", "mobile no", "primary mobile number", "primary mobile", "primary phone", "primary contact number", "primary contact", "primary number", "contact", "contact number", "contact no", "phone number", "phone no", "cell", "cell number", "whatsapp", "whatsapp number", "whatsapp no", "tel", "telephone", "alternate mobile", "alternate number", "alternate phone", "secondary mobile", "other mobile", "mob", "mob no"],
  emails:           ["Email", "emails", "email id", "e-mail", "mail", "email address", "e mail", "primary email", "e-mail id", "e-mail address", "email address id"],
  passport:         ["Passport No", "passport", "passport number", "passportno"],
  passportExpiry:   ["Passport Expiry", "passport expiry date", "passport exp", "passport valid till", "passport validity"],
  nationality:      ["Nationality", "citizenship", "nationality country", "passport country"],
  ownerName:        ["Registered Owner", "owner of record", "title owner", "property owner", "registered owner name"],
  country:          ["Country", "property country", "buyer country", "residence country", "country of residence"],
  projectName:      ["Project", "project name", "development", "property name", "scheme", "master project"],
  tower:            ["Tower", "building", "block", "wing", "building name", "tower name"],
  unitNumber:       ["Unit", "unit no", "unit number", "apartment", "apartment no", "flat", "flat no", "villa no", "villa number", "apt"],
  propertyType:     ["Property Type", "asset type", "unit category", "prop type"],
  configuration:    ["Configuration", "config", "bhk", "bedrooms", "beds", "layout", "unit type", "no of bedrooms"],
  size:             ["Size", "area sqft", "built up area", "builtup area", "bua", "saleable area", "size sqft", "unit size", "sqft", "plot size"],
  actualSize:       ["Actual Size", "carpet area", "net area", "usable area", "actual area", "carpet"],
  area:             ["Area", "location", "locality", "community", "district", "sector", "neighbourhood", "neighborhood", "sub community", "sub-community"],
  transactionValue: ["Transaction Value", "deal value", "sale price", "price", "amount", "value", "consideration", "total value", "sale value", "purchase price", "deal price", "transaction amount", "contract value", "price aed"],
  pricePerSqFt:     ["Price Per SqFt", "price per sq ft", "psf", "rate", "per sqft", "rate per sqft", "price psf", "aed sqft", "rate psf"],
  transactionDate:  ["Transaction Date", "deal date", "booking date", "date of sale", "sale date", "agreement date", "date", "purchase date", "spa date", "registration date"],
  transactionId:    ["Transaction ID", "deal id", "booking id", "reference", "ref no", "transaction ref", "deal reference", "reference no", "contract no", "spa no", "registration no"],
  transactionType:  ["Transaction Type", "deal type", "sale type", "primary resale", "market type", "type of sale", "resale primary"],
  role:             ["Role", "buyer role", "party role", "client role", "role in deal", "capacity"],
  agentName:        ["Agent", "agent name", "sales agent", "broker", "rm", "relationship manager", "sold by", "consultant", "sales person", "salesperson"],
  remarks:          ["Remarks", "remark", "notes", "note", "comments", "comment", "follow-up notes", "followup notes", "activity history", "activity", "conversation", "conversation history", "history", "status", "follow-up", "followup", "follow up"],
};

/** Field → human label for the dropdown + template header text. */
export const BUYER_FIELD_LABELS: Record<string, string> = {
  clientName: "Client Name", coBuyerNames: "Co-Buyers", phones: "Phone", emails: "Email",
  passport: "Passport No", passportExpiry: "Passport Expiry", nationality: "Nationality",
  ownerName: "Registered Owner", country: "Country", projectName: "Project", tower: "Tower",
  unitNumber: "Unit", propertyType: "Property Type", configuration: "Configuration",
  size: "Size", actualSize: "Actual Size", area: "Area", transactionValue: "Transaction Value",
  pricePerSqFt: "Price Per SqFt", transactionDate: "Transaction Date", transactionId: "Transaction ID",
  transactionType: "Transaction Type", role: "Role", agentName: "Agent", remarks: "Remarks",
};

/** Ordered [field, label] catalog for the wizard dropdown + template column order. */
export const BUYER_FIELDS: [string, string][] = Object.keys(BUYER_FIELD_ALIASES).map(
  (f) => [f, BUYER_FIELD_LABELS[f] ?? f],
);

/** Exact normalized match → "high"; prefix either direction → "medium"; else null.
 *  Same semantics as importMapping.matchField (prefix, NOT loose substring). */
export function matchBuyerField(header: string, aliases: string[]): Confidence | null {
  const nk = normHeader(header);
  if (!nk) return null;
  for (const a of aliases) if (nk === normHeader(a)) return "high";
  for (const a of aliases) {
    const t = normHeader(a);
    if (t && (nk.startsWith(t) || t.startsWith(nk))) return "medium";
  }
  return null;
}

/** header → { target: field|KEEP, confidence }. Greedy one-field-per-column;
 *  declaration order = priority; exact beats prefix; a field already claimed by an
 *  exact match isn't reused. Unknown columns → KEEP (preserved, never lost). */
export function buildBuyerColumnMap(headers: string[]): Record<string, { target: string; confidence: Confidence }> {
  const out: Record<string, { target: string; confidence: Confidence }> = {};
  const claimed = new Set<string>(); // one field ↔ one column (first column wins)
  const fields = Object.entries(BUYER_FIELD_ALIASES);
  for (const h of headers) {
    let best: { target: string; confidence: Confidence } | null = null;
    for (const [field, aliases] of fields) {
      if (claimed.has(field)) continue;
      const conf = matchBuyerField(h, aliases);
      if (!conf) continue;
      if (!best || (conf === "high" && best.confidence !== "high")) {
        best = { target: field, confidence: conf };
        if (conf === "high") break;
      }
    }
    if (best) claimed.add(best.target);
    out[h] = best ?? { target: KEEP, confidence: "unknown" };
  }
  return out;
}

/** Score a row's alias hits — used to auto-detect the header row in a messy sheet. */
export function buyerHeaderScore(cells: string[]): number {
  let score = 0;
  for (const cell of cells) {
    for (const aliases of Object.values(BUYER_FIELD_ALIASES)) {
      if (matchBuyerField(cell, aliases)) { score++; break; }
    }
  }
  return score;
}

/** Canonical template headers, in field-catalog order (first alias of each field). */
export function buyerTemplateHeaders(): string[] {
  return BUYER_FIELDS.map(([field]) => BUYER_FIELD_ALIASES[field][0]);
}
