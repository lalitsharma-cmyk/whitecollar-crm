// Revival Engine — shared constants.
//
// NO "use client" here — this file is imported by both the server component
// (cold-calls/page.tsx) and the client component (RevivalEngineListClient.tsx).
// Putting REVIVAL_STATUSES inside a "use client" module caused the server to
// receive `undefined` for the export (Next.js replaces non-component exports
// with client references at the module boundary), leading to the "Something
// hiccuped" crash on /cold-calls.

export const REVIVAL_STATUSES: Array<{ v: string; label: string; chip: string }> = [
  { v: "NEW",          label: "New",         chip: "chip-new" },
  { v: "CONTACTED",    label: "Contacted",   chip: "chip-warm" },
  { v: "QUALIFIED",    label: "Qualified",   chip: "chip-warm" },
  { v: "SITE_VISIT",   label: "Site Visit",  chip: "chip-warm" },
  { v: "NEGOTIATION",  label: "Negotiation", chip: "chip-warm" },
  { v: "EOI",          label: "EOI",         chip: "chip-warm" },
  { v: "BOOKING_DONE", label: "Booked",      chip: "chip-won" },
  { v: "WON",          label: "Won",         chip: "chip-won" },
  { v: "LOST",         label: "Lost",        chip: "chip-lost" },
];
