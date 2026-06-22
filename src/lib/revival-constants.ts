// Revival Engine — shared constants.
//
// NO "use client" here — this file is imported by both the server component
// (cold-calls/page.tsx) and the client component (RevivalEngineListClient.tsx).
// Putting REVIVAL_STATUSES inside a "use client" module caused the server to
// receive `undefined` for the export (Next.js replaces non-component exports
// with client references at the module boundary), leading to the "Something
// hiccuped" crash on /cold-calls.

// Revival Engine now uses the same status system as Leads module.
// Statuses come from INDIA_STATUSES and DUBAI_STATUSES in lead-statuses.ts
// No separate stage enum — this constant is kept for backward compat but is unused.
// TODO: Remove this constant after front-end refs are updated to use statusColor() directly.
export const REVIVAL_STATUSES: Array<{ v: string; label: string; chip: string }> = [];
