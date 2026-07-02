// AI Sales OS — M4 apply-safety local validation (pure). Run via tsx.
import { planApply, describeApply, AI_APPLY_WHITELIST } from "./apply";
import type { AiMutation } from "./types";

const mkt = (over: Partial<AiMutation> = {}): AiMutation => ({
  entity: "Lead", entityId: "L1", field: "market", from: null, to: "UAE", reversible: true, ...over,
});

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}`); };

ok("whitelisted reversible market fix → ok", planApply(mkt()).ok === true);
ok("non-whitelisted field (status) → rejected", planApply(mkt({ field: "currentStatus", to: "Won" })).ok === false);
ok("non-whitelisted field (name) → rejected", planApply(mkt({ field: "name", to: "X" })).ok === false);
ok("unknown entity → rejected", planApply(mkt({ entity: "BuyerRecord", field: "market" })).ok === false);
ok("empty target → rejected", planApply(mkt({ to: "" })).ok === false);
ok("null target → rejected", planApply(mkt({ to: null })).ok === false);
ok("no-op (from === to) → rejected", planApply(mkt({ from: "UAE", to: "UAE" })).ok === false);

// Whitelist is intentionally tiny — no name/phone/remark/status is EVER appliable.
const leadFields = AI_APPLY_WHITELIST.Lead;
ok("whitelist excludes name/phone/remark/currentStatus", ["name", "phone", "remarks", "currentStatus"].every((f) => !leadFields.has(f)));
ok("whitelist contains only 'market'", leadFields.size === 1 && leadFields.has("market"));

ok("describeApply is human-readable", /market.*null.*UAE/.test(describeApply(mkt())));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
