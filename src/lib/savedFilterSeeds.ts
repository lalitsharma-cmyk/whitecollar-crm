// Starter Smart Lists (saved filters) pre-seeded for the whole team.
//
// These are inserted as `createdById = null` system-seed rows — visible to
// every user but only an admin can re-run the seed (idempotent: skips by name).
// The /api/admin/saved-filters/seed POST endpoint loops this list and inserts
// any name not already present in the system-seed namespace.
//
// Each entry's `queryString` matches the URL-param shape consumed by
// src/app/(app)/leads/page.tsx (followup=, status=, smart=, team=, ai=, etc.).
// Keep names short — they render as chips in SavedFiltersBar.

export interface SavedFilterSeed {
  name: string;
  icon: string;
  queryString: string;
  sortOrder: number;
}

export const SAVED_FILTER_SEEDS: SavedFilterSeed[] = [
  { name: "Hot today",             icon: "🔥", queryString: "ai=HOT&when=24h",                  sortOrder: 1 },
  { name: "Overdue follow-ups",    icon: "⏰", queryString: "followup=overdue",                 sortOrder: 2 },
  { name: "High budget Dubai",     icon: "💎", queryString: "team=Dubai&smart=high_budget",     sortOrder: 3 },
  { name: "High budget India",     icon: "💎", queryString: "team=India&smart=high_budget",     sortOrder: 4 },
  { name: "Site visits this week", icon: "🏢", queryString: "followup=week&status=SITE_VISIT",  sortOrder: 5 },
  { name: "Negotiations",          icon: "🤝", queryString: "status=NEGOTIATION",               sortOrder: 6 },
  { name: "Ghosting",              icon: "👻", queryString: "smart=ghosting",                   sortOrder: 7 },
  { name: "New unassigned",        icon: "🆕", queryString: "status=NEW&owner=unassigned",      sortOrder: 8 },
  { name: "Cold revival 30d+",     icon: "🧊", queryString: "showCold=true&followup=overdue",   sortOrder: 9 },
];
