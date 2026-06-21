// scripts/test-voice-correct.ts   (npx tsx scripts/test-voice-correct.ts)
// Unit tests for the deterministic voice-note corrector. Confirms it fixes common
// speech-to-text spelling + casing + punctuation WITHOUT touching proper nouns.
import { correctTranscript } from "../src/lib/voiceCorrect";

let pass = 0, fail = 0;
function eq(name: string, got: string, want: string): void {
  if (got === want) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}\n    got:  "${got}"\n    want: "${want}"`); }
}

eq("the spec example (conservative — names kept as spoken)",
  correctTranscript("client is intrested in dubai hills but he wil discuss with family and cal back tomorow"),
  "Client is interested in dubai hills but he will discuss with family and call back tomorrow.");
eq("standalone i → I", correctTranscript("i called the client"), "I called the client.");
eq("preserves CAPITALISED project/developer names",
  correctTranscript("interested in DAMAC Riverside and Sobha Solis"),
  "Interested in DAMAC Riverside and Sobha Solis.");
eq("preserves a tower name verbatim",
  correctTranscript("met at Central Park Belgravia today"),
  "Met at Central Park Belgravia today.");
eq("already-clean text unchanged", correctTranscript("Met the client today."), "Met the client today.");
eq("adds terminal period", correctTranscript("client will visit office"), "Client will visit office.");
eq("recieved → received", correctTranscript("recieved the documents"), "Received the documents.");
eq("does NOT rewrite/summarise (same words, just fixed)",
  correctTranscript("he wll confirm the buget by tomorow"),
  "He will confirm the budget by tomorrow.");
eq("empty stays empty", correctTranscript(""), "");
eq("keeps a real word that resembles a fix (Cal as a name)",
  correctTranscript("Cal is the client name"),
  "Cal is the client name.");

console.log(`\nVOICE-CORRECT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
