import "server-only";
import { prisma } from "@/lib/prisma";
import { inferCountryFromCityFuzzy, canonicalCountry } from "@/lib/cityCountry";

// City → Country resolver with a two-tier strategy (owner choice: no paid Google):
//   1. Curated CRM table (cityCountry.ts) — instant, covers our markets.
//   2. Free OpenStreetMap / Nominatim, cached in LocationCache so we never re-hit
//      the API for the same city. Country is normalized to the CRM's canonical
//      short form (UAE / UK / Turkey…) so curated + API leads never diverge.
// Returns null when nothing resolves (caller leaves Country blank — never guessed).

export function cityKey(city: string): string {
  return city.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z ]/g, "");
}

export interface LocResult { country: string; state: string | null; source: "curated" | "cache" | "nominatim"; }

export async function lookupLocation(city: string | null | undefined): Promise<LocResult | null> {
  if (!city || !city.trim()) return null;

  // 1. Curated map (fast, authoritative for our markets).
  const curated = inferCountryFromCityFuzzy(city);
  if (curated) return { country: curated, state: null, source: "curated" };

  const key = cityKey(city);
  if (!key) return null;

  // 2a. Cache.
  const cached = await prisma.locationCache.findUnique({ where: { cityKey: key } }).catch(() => null);
  if (cached?.country) return { country: cached.country, state: cached.state ?? null, source: "cache" };

  // 2b. Nominatim (best-effort; failures return null + are not cached).
  try {
    // accept-language=en → English country names ("United Arab Emirates"), which
    // canonicalCountry() maps to our short form — never localized ("الإمارات…").
    const url = `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(city.trim())}&format=json&addressdetails=1&limit=1&accept-language=en`;
    const res = await fetch(url, {
      headers: { "User-Agent": "WhiteCollarCRM/1.0 (crm@whitecollarrealty.com)" },
      // Nominatim can be slow; cap the wait so an enrich never hangs a request.
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ address?: { country?: string; state?: string } }>;
    const rawCountry = data?.[0]?.address?.country ?? null;
    const country = canonicalCountry(rawCountry);
    const state = data?.[0]?.address?.state ?? null;
    if (country) {
      await prisma.locationCache.create({
        data: { cityKey: key, city: city.trim().slice(0, 120), country, state, source: "nominatim" },
      }).catch(() => {}); // ignore unique-race / write errors — return the value either way
      return { country, state, source: "nominatim" };
    }
  } catch { /* network / parse / timeout → unresolved */ }
  return null;
}

/** Convenience: just the country (curated + cached Nominatim). */
export async function lookupCountry(city: string | null | undefined): Promise<string | null> {
  return (await lookupLocation(city))?.country ?? null;
}
