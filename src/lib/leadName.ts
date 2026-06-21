// Display-only formatter for a Lead's name, which can hold MULTIPLE client names
// joined by commas / slashes / "&" / ";" (e.g. "Anil Raj, Avantika Nair"). The
// stored Lead.name is NEVER modified — this only changes what is rendered.
//
//   1 name  → "Anil Raj"
//   2 names → "Anil Raj & Avantika Nair"
//   3 names → "Anil Raj, Avantika Nair & Rohit Sen"
//   4+      → "Anil Raj + 3 others"
//
// A single name with spaces ("Anil Raj") is ONE name — spaces are not separators.
export function splitClientNames(name: string | null | undefined): string[] {
  if (!name) return [];
  return name
    .split(/\s*[,/&;]+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatLeadName(name: string | null | undefined): string {
  const parts = splitClientNames(name);
  if (parts.length === 0) return (name ?? "").trim();
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} & ${parts[1]}`;
  if (parts.length === 3) return `${parts[0]}, ${parts[1]} & ${parts[2]}`;
  return `${parts[0]} + ${parts.length - 1} others`;
}
