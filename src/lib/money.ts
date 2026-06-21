// Currency formatting that respects each lead's team.
//   Dubai team → AED   (display as "2M AED", "850K AED")
//   India team → INR   (display as "21 Cr", "50 L" — no ₹)
//
// House format (Lalit's 2026-06-21 standardisation): both fmtAED/fmtINR now
// delegate to the ONE canonical formatter in budgetParse.ts so EVERY money
// surface (reports, PDFs, team pages, lead detail, properties, templates,
// QuickSearch, etc.) renders identically to the Leads table / Master Data.
// Display-only — stored values, sums, filters, and reports math are unchanged.
import { formatBudgetAmount } from "./budgetParse";

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

// Canonical house format: Dubai "2M AED" / "850K AED", India "21 Cr" / "50 L".
function fmtAED(v: number): string {
  return formatBudgetAmount(v, "DUBAI");
}

function fmtINR(v: number): string {
  return formatBudgetAmount(v, "INDIA");
}

// Aggregate sum showing both totals separately (for dashboards with mixed leads)
export function fmtMoneyDual(amounts: { aed: number; inr: number }): string {
  const parts: string[] = [];
  if (amounts.aed > 0) parts.push(fmtAED(amounts.aed));
  if (amounts.inr > 0) parts.push(fmtINR(amounts.inr));
  if (parts.length === 0) return "—";
  return parts.join(" + ");
}
