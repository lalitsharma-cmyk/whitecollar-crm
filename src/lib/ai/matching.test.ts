// AI Sales OS — M2 matching-engine local validation (pure). Run via tsx.
import { matchBuyersToProperty, type PropertySpec, type BuyerSpec } from "./matching";

const prop: PropertySpec = { id: "P1", market: "UAE", city: "Dubai Hills", configuration: "2BR", askingBudget: 2_500_000 };

const buyers: BuyerSpec[] = [
  { id: "B1", name: "Perfect Fit",   market: "UAE",   preferredCity: "Dubai Hills", configuration: "2BR", budgetMin: 2_000_000, budgetMax: 3_000_000 }, // full
  { id: "B2", name: "Budget Only",   market: "UAE",   preferredCity: "Marina",      configuration: "3BR", budgetMin: 2_400_000, budgetMax: 2_600_000 }, // budget only
  { id: "B3", name: "Wrong Market",  market: "India", preferredCity: "Dubai Hills", configuration: "2BR", budgetMin: 2_000_000, budgetMax: 3_000_000 }, // excluded
  { id: "B4", name: "Too Cheap",     market: "UAE",   preferredCity: "JVC",         configuration: "1BR", budgetMin: 500_000,   budgetMax: 900_000 },   // no budget/city/config → excluded
  { id: "B5", name: "Unknown Market",market: null,    preferredCity: "Dubai Hills", configuration: "2BR", budgetMin: 2_000_000, budgetMax: 3_000_000 }, // excluded (null market)
];

const ranked = matchBuyersToProperty(prop, buyers);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}`); };

ok("excludes wrong-market buyer (B3)", !ranked.some((m) => m.buyerId === "B3"));
ok("excludes unknown-market buyer (B5)", !ranked.some((m) => m.buyerId === "B5"));
ok("excludes buyer with no fit beyond market (B4)", !ranked.some((m) => m.buyerId === "B4"));
ok("perfect fit (B1) is ranked #1", ranked[0]?.buyerId === "B1");
ok("perfect fit is high confidence", ranked[0]?.confidence === "high");
ok("perfect fit outranks budget-only", (ranked.find((m) => m.buyerId === "B1")?.score ?? 0) > (ranked.find((m) => m.buyerId === "B2")?.score ?? 0));
ok("budget-only (B2) still matches on budget+market", ranked.some((m) => m.buyerId === "B2"));
ok("every match cites market as a reason", ranked.every((m) => m.reasons.some((r) => r.key === "market")));
ok("B1 reasons include budget + city + config", (() => { const r = ranked.find((m) => m.buyerId === "B1"); return ["budget", "city", "config"].every((k) => r?.reasons.some((x) => x.key === k)); })());

// Property with no market → nothing matches (hard gate both directions).
ok("property with null market → no matches", matchBuyersToProperty({ ...prop, market: null }, buyers).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
