// Deterministic speech-to-text cleanup for voice notes. Offline, no AI, no cost.
//
// SCOPE (Lalit's rule): only fix spelling, capitalization, and punctuation. NEVER
// rewrite meaning, add/remove words, or summarize. NEVER change proper nouns —
// client / project / tower / community / developer names stay EXACTLY as spoken
// (e.g. "DAMAC Riverside", "Sobha Solis", "Central Park Belgravia"). We achieve
// that by only correcting ALL-LOWERCASE words against a curated common-error list
// (real names are normally capitalized, so they're left untouched), plus sentence
// casing and a terminal full-stop.

// High-confidence, unambiguous speech-to-text misspellings (lowercase key → fix).
// Kept conservative on purpose; anything that could be a name is excluded.
const MISSPELLINGS: Record<string, string> = {
  intrested: "interested", intrasted: "interested", intersted: "interested",
  intrest: "interest", recieve: "receive", recieved: "received",
  tomorow: "tomorrow", tommorow: "tomorrow", tommorrow: "tomorrow",
  wil: "will", wll: "will", cal: "call", calld: "called",
  definately: "definitely", seperate: "separate",
  adress: "address", appartment: "apartment", apartmnt: "apartment",
  alot: "a lot", occured: "occurred", untill: "until", availabe: "available",
  availble: "available", confirmd: "confirmed", discus: "discuss",
  discussd: "discussed", folow: "follow", folowup: "follow-up",
  bugdet: "budget", buget: "budget", pls: "please", plz: "please",
  thru: "through", coz: "because", bcoz: "because", wanna: "want to",
  gonna: "going to", cant: "can't", dont: "don't", doesnt: "doesn't",
  wont: "won't", isnt: "isn't", didnt: "didn't", couldnt: "couldn't",
  shouldnt: "shouldn't", wouldnt: "wouldn't", im: "I'm", ive: "I've",
};

export function correctTranscript(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return "";

  // 1. Word-level fixes — only for ALL-LOWERCASE words (protects capitalized
  //    proper nouns like project/developer/client names). Preserve trailing punctuation.
  s = s.replace(/[A-Za-z][A-Za-z'-]*/g, (w) => {
    if (w !== w.toLowerCase()) return w;        // has a capital → likely a name; leave it
    const fix = MISSPELLINGS[w];
    return fix ?? w;
  });

  // 2. Standalone "i" → "I".
  s = s.replace(/\bi\b/g, "I");

  // 3. Capitalize the first letter of each sentence (start, and after . ! ?).
  s = s.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_m, pre, ch) => pre + ch.toUpperCase());

  // 4. Tidy spacing before punctuation + ensure a terminal full-stop.
  s = s.replace(/\s+([,.!?;:])/g, "$1").trim();
  if (s && !/[.!?]$/.test(s)) s += ".";

  return s;
}
