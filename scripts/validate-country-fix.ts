// READ-ONLY validation of the Country display fallback. Exercises the SHIPPED
// inferCountryFromCityFuzzy against every blank-country lead to show how many
// now render a country.
import { prisma } from "../src/lib/prisma";
import { inferCountryFromCityFuzzy } from "../src/lib/cityCountry";

async function main() {
  const blanks = await prisma.lead.findMany({
    where: { deletedAt: null, AND: [{ city: { not: null } }, { city: { not: "" } }], OR: [{ country: null }, { country: "" }] },
    select: { name: true, city: true },
  });
  let resolved = 0;
  const byCountry: Record<string, number> = {};
  const stillBlank: string[] = [];
  for (const l of blanks) {
    const c = inferCountryFromCityFuzzy(l.city);
    if (c) { resolved++; byCountry[c] = (byCountry[c] ?? 0) + 1; }
    else if (stillBlank.length < 8) stillBlank.push(`${l.name} — "${l.city}"`);
  }
  console.log(`Blank-country leads (city set): ${blanks.length}`);
  console.log(`Now resolve via fallback:       ${resolved}   (${Object.entries(byCountry).map(([k, v]) => `${k}:${v}`).join(", ")})`);
  console.log(`Still blank (city not a known metro): ${blanks.length - resolved}`);
  console.log(`  sample still-blank cities: ${stillBlank.join(" | ")}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
