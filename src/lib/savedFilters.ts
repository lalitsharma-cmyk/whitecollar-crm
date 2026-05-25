// Helpers for the Smart-Lists (saved filters) feature on /leads.
//
// A saved filter is just a URL query string — the existing LeadFilters component
// already speaks that language. The only smart bit is matching the current page
// state against saved filters so we can show "this one is active right now".

/** Canonicalise a query-string so order-of-keys doesn't matter for matching. */
export function canonicalizeQuery(qs: string): string {
  const params = new URLSearchParams(qs);
  const entries: [string, string][] = [];
  params.forEach((v, k) => { if (v) entries.push([k, v]); });
  entries.sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(entries).toString();
}

/** True if two query strings represent the same filter set. */
export function queriesMatch(a: string, b: string): boolean {
  return canonicalizeQuery(a) === canonicalizeQuery(b);
}

/** System-seed filters that ship with every install. createdById = null marks them. */
export const SEED_FILTERS: { name: string; icon: string; queryString: string; sortOrder: number }[] = [
  { name: "All HOT leads",         icon: "🔥", queryString: "ai=HOT",                 sortOrder: 1 },
  { name: "Due today",             icon: "📞", queryString: "when=24h",              sortOrder: 2 },
  { name: "Stale 30 days+",        icon: "🧊", queryString: "when=overdue",          sortOrder: 3 },
  { name: "Negotiation stage",     icon: "🤝", queryString: "status=NEGOTIATION",    sortOrder: 4 },
  { name: "Unassigned (waiting)",  icon: "⚠",  queryString: "owner=unassigned",      sortOrder: 5 },
  { name: "Dubai team",            icon: "🇦🇪", queryString: "team=Dubai",            sortOrder: 6 },
  { name: "India team",            icon: "🇮🇳", queryString: "team=India",            sortOrder: 7 },
];
