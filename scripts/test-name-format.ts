// Unit tests for the name-format util. Run: npx tsx scripts/test-name-format.ts
//
// Covers the spec examples + edge cases: honorifics, hyphen, apostrophe, email
// passthrough, URL passthrough, numeric-code passthrough, mixed-case preserved,
// empty/null, idempotency, and multi-name lists.
import { toProperCase, shouldNormalizeName, normalizeName, normalizeNameList } from "../src/lib/nameFormat";

let pass = 0, fail = 0;
function check(label: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✓" : "✗"} ${label.padEnd(56)} expected=${JSON.stringify(expected)}  got=${JSON.stringify(got)}`);
}

console.log("--- toProperCase ---");
// Spec examples
check("ABHISHEK ARORA", toProperCase("ABHISHEK ARORA"), "Abhishek Arora");
check("RAFIQ ALY HARRY MAHMOOD", toProperCase("RAFIQ ALY HARRY MAHMOOD"), "Rafiq Aly Harry Mahmood");
check("MR. RISHI RAI CHANDHARY", toProperCase("MR. RISHI RAI CHANDHARY"), "Mr. Rishi Rai Chandhary");
// Honorifics (with + without dot, various)
check("honorific MRS.", toProperCase("MRS. KAVITA SINGH"), "Mrs. Kavita Singh");
check("honorific MS (no dot)", toProperCase("MS PRIYA"), "Ms Priya");
check("honorific DR.", toProperCase("DR. AHMED"), "Dr. Ahmed");
// Hyphenated + apostrophe
check("hyphen AL-RASHID", toProperCase("AL-RASHID"), "Al-Rashid");
check("apostrophe O'BRIEN", toProperCase("O'BRIEN"), "O'Brien");
check("hyphen+space JEAN-PAUL SARTRE", toProperCase("JEAN-PAUL SARTRE"), "Jean-Paul Sartre");
check("apostrophe lower d'souza", toProperCase("d'souza"), "D'Souza");
// Weird spacing collapses
check("collapse spaces", toProperCase("MR.   RISHI    RAI"), "Mr. Rishi Rai");
check("leading/trailing trim", toProperCase("  ANIL RAJ  "), "Anil Raj");
// Passthroughs — email / URL / numeric code
check("email passthrough", toProperCase("john.doe@example.com"), "john.doe@example.com");
check("url passthrough", toProperCase("https://x.com/profile"), "https://x.com/profile");
check("numeric code passthrough", toProperCase("30100"), "30100");
check("unit code passthrough", toProperCase("A-1203"), "A-1203");
check("txn id passthrough", toProperCase("TXN90021"), "TXN90021");
// Turkish dotted-İ artifact must NOT leak a combining dot (U+0307) into the name.
check("Turkish İ no combining-dot artifact", toProperCase("MEHMET CEMİL ŞİMŞEK"), "Mehmet Cemil Şimşek");
check("Turkish İ result has no U+0307", /̇/.test(toProperCase("ŞİMŞEK")), false);
// Idempotency
check("idempotent (already proper)", toProperCase("Abhishek Arora"), "Abhishek Arora");
check("idempotent double-apply", toProperCase(toProperCase("ABHISHEK ARORA")), toProperCase("ABHISHEK ARORA"));
// Empty
check("empty string", toProperCase(""), "");

console.log("\n--- shouldNormalizeName ---");
check("all-upper → true", shouldNormalizeName("ABHISHEK ARORA"), true);
check("all-lower → true", shouldNormalizeName("abhishek arora"), true);
check("already proper → false", shouldNormalizeName("Abhishek Arora"), false);
check("mixed McDonald → false", shouldNormalizeName("McDonald"), false);
check("mixed DeSouza → false", shouldNormalizeName("DeSouza"), false);
check("mixed JPMorgan → false", shouldNormalizeName("JPMorgan"), false);
check("mixed O'Brien (cased) → false", shouldNormalizeName("O'Brien"), false);
check("email → false", shouldNormalizeName("a@b.com"), false);
check("ALLCAPS email → false", shouldNormalizeName("LALIT@WCR.COM"), false);
check("url → false", shouldNormalizeName("HTTPS://X.COM"), false);
check("numeric code → false", shouldNormalizeName("30100"), false);
check("unit 1203B (digit-dominant) → false", shouldNormalizeName("1203B"), false);
check("empty → false", shouldNormalizeName(""), false);
check("blank → false", shouldNormalizeName("   "), false);
check("null → false", shouldNormalizeName(null), false);
check("undefined → false", shouldNormalizeName(undefined), false);
// An all-upper honorific name IS a target
check("MR. RISHI RAI → true", shouldNormalizeName("MR. RISHI RAI CHANDHARY"), true);

console.log("\n--- normalizeName (guarded) ---");
check("normalize all-upper", normalizeName("ABHISHEK ARORA"), "Abhishek Arora");
check("normalize all-lower", normalizeName("abhishek arora"), "Abhishek Arora");
check("preserve McDonald", normalizeName("McDonald"), "McDonald");
check("preserve DeSouza", normalizeName("DeSouza"), "DeSouza");
check("preserve mixed full", normalizeName("Rafiq Aly Harry Mahmood"), "Rafiq Aly Harry Mahmood");
check("preserve email", normalizeName("LALIT@WCR.COM"), "LALIT@WCR.COM");
check("preserve numeric", normalizeName("30100"), "30100");
check("null passthrough", normalizeName(null), null);
check("undefined passthrough", normalizeName(undefined), undefined);
check("empty passthrough", normalizeName(""), "");
check("honorific all-upper", normalizeName("MR. RISHI RAI CHANDHARY"), "Mr. Rishi Rai Chandhary");

console.log("\n--- normalizeNameList (multi-name) ---");
check("comma list", normalizeNameList("ANIL RAJ, AVANTIKA NAIR"), "Anil Raj, Avantika Nair");
check("amp list", normalizeNameList("ANIL RAJ & AVANTIKA NAIR"), "Anil Raj & Avantika Nair");
check("slash list", normalizeNameList("SOUMYA/AYUSH GUPTA"), "Soumya/Ayush Gupta");
check("mixed part preserved in list", normalizeNameList("McDonald, RAHUL VERMA"), "McDonald, Rahul Verma");
check("single name list", normalizeNameList("ABHISHEK ARORA"), "Abhishek Arora");
check("null list passthrough", normalizeNameList(null), null);

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
