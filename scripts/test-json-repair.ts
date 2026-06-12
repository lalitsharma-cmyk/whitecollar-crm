// Standalone check of the truncated-JSON repair logic mirrored from ai-claude.ts.
function repairTruncatedJson(s: string): string | null {
  const floor = Math.max(0, s.length - 4000);
  for (let end = s.length; end > floor; end--) {
    const c = s[end - 1];
    if (c !== "}" && c !== "]" && c !== '"' && !/[0-9eltursfn]/.test(c)) continue;
    const candidate = closeOpenBrackets(s.slice(0, end));
    if (candidate) { try { JSON.parse(candidate); return candidate; } catch { /* earlier */ } }
  }
  return null;
}
function closeOpenBrackets(prefix: string): string | null {
  let inStr = false, esc = false;
  const close: string[] = [];
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") close.push("}");
    else if (c === "[") close.push("]");
    else if (c === "}" || c === "]") close.pop();
  }
  if (close.length === 0 && !inStr) return null;
  let out = prefix.replace(/[\s,]+$/, "");
  if (inStr) out += '"';
  for (let i = close.length - 1; i >= 0; i--) out += close[i];
  return out;
}

const full = JSON.stringify({
  summary: { whoIsClient: "NRI investor", whatTheyWant: "2BR Marina" },
  closingProbability: { percentage: 60, classification: "High", positiveSignals: ["budget set", "visited"] },
  bantIntelligence: { budget: { score: "Strong", confidence: 80 }, authority: { score: "Unknown", confidence: 20 } },
  nextBestAction: { action: "BookSiteVisit", urgency: "Today", openingLine: "Shall we lock your visit this week?" },
});

const cases = [
  full.slice(0, full.indexOf('"nextBestAction"') + 30),      // truncated mid nextBestAction (dangling key+partial)
  full.slice(0, full.indexOf('"positiveSignals"')),          // truncated right before a key
  full.slice(0, full.indexOf('"visited"]') + 5),             // truncated inside an array
  full.slice(0, 40),                                         // truncated very early, mid-string
];

let pass = 0;
cases.forEach((c, i) => {
  const repaired = repairTruncatedJson(c);
  let ok = false, sections = 0;
  if (repaired) { try { const o = JSON.parse(repaired); ok = true; sections = Object.keys(o).length; } catch { /* */ } }
  console.log(`case ${i + 1}: len=${c.length} -> ${ok ? `VALID (${sections} sections kept)` : "could not repair"}`);
  if (ok) pass++;
});
console.log(`\n${pass}/${cases.length} truncations salvaged into valid JSON`);
process.exit(0);
