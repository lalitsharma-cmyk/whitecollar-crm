// ────────────────────────────────────────────────────────────────────────────
// scripts/test-budget-display.ts   (npx tsx scripts/test-budget-display.ts)
//
// Unit tests for the uniform budget display: Dubai "2M AED" / India "21 Cr".
// Pure formatter tests, no DB.
// ────────────────────────────────────────────────────────────────────────────
import { formatBudgetAmount, displayBudget } from "../src/lib/budgetParse";
import { fmtMoney, fmtMoneyDual } from "../src/lib/money";

let pass = 0, fail = 0;
function eq(name: string, got: string, want: string): void {
  if (got === want) { pass++; console.log(`✓ ${name} = "${got}"`); }
  else { fail++; console.log(`✗ ${name}: got "${got}" want "${want}"`); }
}

// ── formatBudgetAmount(n, market) ──
eq("dubai 1M", formatBudgetAmount(1_000_000, "DUBAI"), "1M AED");
eq("dubai 600K", formatBudgetAmount(600_000, "DUBAI"), "600K AED");
eq("dubai 2M", formatBudgetAmount(2_000_000, "DUBAI"), "2M AED");
eq("dubai 12M", formatBudgetAmount(12_000_000, "DUBAI"), "12M AED");
eq("dubai 25M", formatBudgetAmount(25_000_000, "DUBAI"), "25M AED");
eq("dubai 2.5M", formatBudgetAmount(2_500_000, "DUBAI"), "2.5M AED");
eq("india 50L", formatBudgetAmount(5_000_000, "INDIA"), "50 L");
eq("india 2Cr", formatBudgetAmount(20_000_000, "INDIA"), "2 Cr");
eq("india 21Cr", formatBudgetAmount(210_000_000, "INDIA"), "21 Cr");
eq("india 100Cr", formatBudgetAmount(1_000_000_000, "INDIA"), "100 Cr");
eq("india 2.5Cr", formatBudgetAmount(25_000_000, "INDIA"), "2.5 Cr");
eq("india no .0 (21 not 21.0)", formatBudgetAmount(210_000_000, "INDIA"), "21 Cr");

// ── displayBudget(lead) integration ──
eq("dubai by ccy", displayBudget({ budgetMin: 2_000_000, budgetCurrency: "AED" }), "2M AED");
eq("india by team", displayBudget({ budgetMin: 210_000_000, forwardedTeam: "India" }), "21 Cr");
eq("INR 3 Cr (was '3 CR')", displayBudget({ budgetMin: 30_000_000, budgetCurrency: "INR" }), "3 Cr");
eq("raw 'AED 2 M' re-parsed (not echoed)", displayBudget({ budgetRaw: "AED 2 M", budgetMin: null }), "2M AED");
eq("raw '₹50 Lakh' India", displayBudget({ budgetRaw: "₹50 Lakh", budgetMin: null, forwardedTeam: "India" }), "50 L");
eq("india range", displayBudget({ budgetMin: 20_000_000, budgetMax: 30_000_000, forwardedTeam: "India" }), "2 Cr – 3 Cr");
eq("dubai range (single AED)", displayBudget({ budgetMin: 1_000_000, budgetMax: 2_000_000, budgetCurrency: "AED" }), "1M – 2M AED");
eq("unparseable raw WITH digit → trimmed raw", displayBudget({ budgetRaw: "80-90 lakh + parking", budgetMin: null }), "80-90 lakh + parking");
eq("no-digit raw → dash", displayBudget({ budgetRaw: "call for price", budgetMin: null }), "—");
eq("empty → dash", displayBudget({ budgetMin: null, budgetRaw: null }), "—");
eq("unknown ccy keeps cue", displayBudget({ budgetMin: 5_000_000, budgetCurrency: "UNKNOWN" }), "5M AED (currency?)");

// ── money.ts fmtMoney/fmtMoneyDual now DELEGATE to the canonical house format ──
// (peripheral surfaces: reports, PDFs, team pages, lead detail, properties,
// templates, QuickSearch). Guards against anyone re-introducing "AED 2.5 M" / "₹3 Cr".
eq("money AED 2M", fmtMoney(2_000_000, "AED"), "2M AED");
eq("money AED 600K", fmtMoney(600_000, "AED"), "600K AED");
eq("money INR 21Cr (no ₹)", fmtMoney(210_000_000, "INR"), "21 Cr");
eq("money INR 50L (no ₹)", fmtMoney(5_000_000, "INR"), "50 L");
eq("money null → dash", fmtMoney(null, "AED"), "—");
eq("moneyDual both", fmtMoneyDual({ aed: 2_000_000, inr: 30_000_000 }), "2M AED + 3 Cr");
eq("moneyDual aed only", fmtMoneyDual({ aed: 1_000_000, inr: 0 }), "1M AED");

console.log(`\nBUDGET-DISPLAY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
