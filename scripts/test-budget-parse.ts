// Unit-style tests for the budget parser. Run: npx tsx scripts/test-budget-parse.ts
import { parseBudget, formatBudget } from "../src/lib/budgetParse";

interface Case { input: string | number | null | undefined; expected: number | null; label?: string }

const cases: Case[] = [
  // Plain numbers
  { input: "500000",    expected: 500_000 },
  { input: 1_234_567,   expected: 1_234_567 },
  { input: "",          expected: null },
  { input: null,        expected: null },
  // K thousands
  { input: "500K",      expected: 500_000 },
  { input: "500 K",     expected: 500_000 },
  { input: "500k",      expected: 500_000 },
  { input: "2.5K",      expected: 2_500 },
  // M millions
  { input: "2.5M",      expected: 2_500_000,  label: "2.5M (Dubai default)" },
  { input: "2.5 m",     expected: 2_500_000 },
  { input: "10M",       expected: 10_000_000 },
  { input: "1.2Mn",     expected: 1_200_000 },
  // L lakhs (India)
  { input: "30L",       expected: 3_000_000 },
  { input: "30 L",      expected: 3_000_000 },
  { input: "30Lakh",    expected: 3_000_000 },
  { input: "30 Lakhs",  expected: 3_000_000 },
  // Cr crores (India)
  { input: "3Cr",       expected: 30_000_000, label: "3Cr (India default)" },
  { input: "3 Cr",      expected: 30_000_000 },
  { input: "3 crore",   expected: 30_000_000 },
  { input: "1.5Crores", expected: 15_000_000 },
  // Bn billions
  { input: "1.2Bn",     expected: 1_200_000_000 },
  // Currency symbols/spaces stripped
  { input: "AED 2.5M",  expected: 2_500_000 },
  { input: "₹ 3 Cr",    expected: 30_000_000 },
  { input: "$ 500K",    expected: 500_000 },
  { input: "INR 30 Lakh", expected: 3_000_000 },
  // Indian-style comma separators (we strip all commas)
  { input: "30,00,000", expected: 3_000_000 },
  { input: "2,500,000", expected: 2_500_000 },
  // Invalid — should return null
  { input: "abc",       expected: null },
  { input: "5XYZ",      expected: null },
  { input: "-1000",     expected: null },
  { input: "2.5.3",     expected: null },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = parseBudget(c.input);
  const ok = got === c.expected;
  if (ok) pass++; else fail++;
  const label = c.label ?? `parse(${JSON.stringify(c.input)})`;
  console.log(`${ok ? "✓" : "✗"} ${label.padEnd(34)} expected=${c.expected}   got=${got}`);
}

console.log("\n--- formatBudget ---");
const fmtCases: { n: number; cur: "AED" | "INR"; expected: string }[] = [
  { n: 2_500_000,    cur: "AED", expected: "2.5 M" },
  { n: 500_000,      cur: "AED", expected: "500 K" },
  { n: 1_200_000_000,cur: "AED", expected: "1.2 Bn" },
  { n: 30_000_000,   cur: "INR", expected: "3 Cr" },
  { n: 3_000_000,    cur: "INR", expected: "30 L" },
  { n: 500_000,      cur: "INR", expected: "5 L" },
  { n: 50_000,       cur: "INR", expected: "50 K" },
];
for (const f of fmtCases) {
  const got = formatBudget(f.n, f.cur);
  const ok = got === f.expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✓" : "✗"} ${f.cur} ${f.n.toString().padStart(13)} → expected=${f.expected.padEnd(8)} got=${got}`);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
