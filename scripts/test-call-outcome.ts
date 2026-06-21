// scripts/test-call-outcome.ts   (npx tsx scripts/test-call-outcome.ts)
// Unit tests for the shared call/WhatsApp outcome classifier.
import { effectiveOutcome, isWaInbound, isWaNote, isUnsuccessfulText } from "../src/lib/callOutcome";

let pass = 0, fail = 0;
function ok(n: string, c: boolean): void { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}`); }

ok("CONNECTED stays connected", effectiveOutcome("CONNECTED", "great call") === "CONNECTED");
ok("CONNECTED + 'dropped wa' → NOT_PICKED", effectiveOutcome("CONNECTED", "💬 WA out — dropped wa") === "NOT_PICKED");
ok("WA in → inbound", isWaInbound("💬 WA in — client replied"));
ok("WA out → not inbound", !isWaInbound("💬 WA out — sent brochure"));
ok("WA note detects in & out", isWaNote("💬 WA out — x") && isWaNote("💬 WA in — y"));
ok("plain note is not WA", !isWaNote("called the client"));
ok("'no answer' → unsuccessful", isUnsuccessfulText("No answer"));
ok("'did not pick' → unsuccessful", isUnsuccessfulText("client did not pick"));
ok("'not piced' typo → unsuccessful", isUnsuccessfulText("not piced up"));
ok("'forwarded to voicemail' → unsuccessful", isUnsuccessfulText("forwarded to voicemail"));
ok("'will call back' → unsuccessful", isUnsuccessfulText("will call back"));
ok("'call later' → unsuccessful", isUnsuccessfulText("asked to call later"));
ok("'not recieved' typo → unsuccessful", isUnsuccessfulText("call not recieved"));
ok("'picked up' → NOT unsuccessful", !isUnsuccessfulText("client picked up, interested"));
ok("'great call' → NOT unsuccessful", !isUnsuccessfulText("great call booked visit"));

console.log(`\nCALL-OUTCOME: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
