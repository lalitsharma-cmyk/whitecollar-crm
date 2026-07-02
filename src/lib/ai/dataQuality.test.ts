// AI Sales OS — M4 data-quality (market self-heal) local validation (pure). tsx.
import { marketFixSuggestion } from "./dataQuality";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}`); };

// Empty market + team-derived → high-confidence reversible fix.
const s = marketFixSuggestion({ leadId: "L1", currentMarket: null, derived: "UAE", basis: { team: "Dubai" } });
ok("missing market + team → suggestion produced", !!s);
ok("suggestion action is fix.market", s?.action === "fix.market");
ok("carries a reversible mutation", s?.mutation?.reversible === true);
ok("mutation targets Lead.market", s?.mutation?.entity === "Lead" && s?.mutation?.field === "market");
ok("mutation from null → to UAE", s?.mutation?.from === null && s?.mutation?.to === "UAE");
ok("team-derived is high confidence", s?.confidence === "high");
ok("routes to ADMIN for approval", s?.routeToRole === "ADMIN");
ok("rationale cites the team", /team \(Dubai\)/.test(s?.rationale ?? ""));

// Currency-only derivation → medium confidence.
const c = marketFixSuggestion({ leadId: "L2", currentMarket: "", derived: "India", basis: { currency: "INR" } });
ok("currency-only derivation → medium confidence", c?.confidence === "medium");

// Already classified → no suggestion (idempotent; won't re-propose).
ok("market already India → no suggestion", marketFixSuggestion({ leadId: "L3", currentMarket: "India", derived: "India", basis: { team: "India" } }) === null);
ok("market already UAE → no suggestion", marketFixSuggestion({ leadId: "L4", currentMarket: "UAE", derived: "UAE", basis: { team: "Dubai" } }) === null);

// Not derivable → no guess (leave in Awaiting Market).
ok("unclassifiable → no suggestion (never guess)", marketFixSuggestion({ leadId: "L5", currentMarket: null, derived: null, basis: {} }) === null);

// The produced mutation must survive the apply-safety gate.
import("./apply").then(({ planApply }) => {
  ok("produced mutation passes planApply", planApply(s!.mutation!).ok === true);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
});
