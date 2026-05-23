// Currency formatting that respects each lead's team.
//   Dubai team → AED   (display as "AED 2.5M", "AED 850K")
//   India team → INR   (display as "₹3.2 Cr", "₹85 L")

export type Currency = "AED" | "INR";

export function defaultCurrencyForTeam(team?: string | null): Currency {
  if (!team) return "AED";
  const t = team.toLowerCase();
  if (t.includes("india") || t.includes("mumbai") || t.includes("delhi") || t.includes("bangalore") || t.includes("gurgaon") || t.includes("hyderabad")) return "INR";
  return "AED";
}

export function defaultCurrencyForLocation(city?: string | null, country?: string | null): Currency {
  const c = (city ?? "").toLowerCase();
  const co = (country ?? "").toLowerCase();
  if (co === "india" || ["mumbai","delhi","bangalore","gurgaon","hyderabad","pune","chennai","kolkata","ahmedabad"].some(x => c.includes(x))) return "INR";
  return "AED";
}

export function fmtMoney(amount?: number | null, currency: Currency | string | null = "AED"): string {
  if (amount == null || isNaN(amount)) return "—";
  const cur = (currency ?? "AED").toUpperCase();
  if (cur === "INR") return fmtINR(amount);
  return fmtAED(amount);
}

function fmtAED(v: number): string {
  if (v >= 1e9) return `AED ${(v / 1e9).toFixed(2)} B`;
  if (v >= 1e6) return `AED ${(v / 1e6).toFixed(1)} M`;
  if (v >= 1e3) return `AED ${(v / 1e3).toFixed(0)} K`;
  return `AED ${v.toLocaleString()}`;
}

function fmtINR(v: number): string {
  if (v >= 1e7) return `₹ ${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹ ${(v / 1e5).toFixed(1)} L`;
  if (v >= 1e3) return `₹ ${(v / 1e3).toFixed(0)} K`;
  return `₹ ${v.toLocaleString("en-IN")}`;
}

// Aggregate sum showing both totals separately (for dashboards with mixed leads)
export function fmtMoneyDual(amounts: { aed: number; inr: number }): string {
  const parts: string[] = [];
  if (amounts.aed > 0) parts.push(fmtAED(amounts.aed));
  if (amounts.inr > 0) parts.push(fmtINR(amounts.inr));
  if (parts.length === 0) return "—";
  return parts.join(" + ");
}
