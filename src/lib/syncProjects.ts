// NOTE: usable both from a Next.js server context AND from a CLI script (tsx scripts/sync-projects.ts).
// Intentionally NO `import "server-only"` so the CLI works.
import { prisma } from "@/lib/prisma";
import { ProjectStatus } from "@prisma/client";

// Scrapes whitecollarrealty.com city-projects pages, parses each project card,
// upserts into the Project table. Idempotent — safe to run repeatedly.

const BASE = "https://whitecollarrealty.com";
const UA = "Mozilla/5.0 (compatible; WhiteCollarCRMSync/1.0)";

// Cities to scrape — order determines which page wins if a project appears in multiple
const CITY_PAGES = [
  { slug: "dubai-projects",        city: "Dubai",        country: "UAE",   team: "Dubai" },
  { slug: "abu-dhabi-projects",    city: "Abu Dhabi",    country: "UAE",   team: "Dubai" },
  { slug: "ras-al-khaimah-projects", city: "Ras Al Khaimah", country: "UAE", team: "Dubai" },
  { slug: "gurgaon-projects",      city: "Gurgaon",      country: "India", team: "India" },
  { slug: "delhi-projects",        city: "Delhi",        country: "India", team: "India" },
  { slug: "noida-projects",        city: "Noida",        country: "India", team: "India" },
  { slug: "bangalore-projects",    city: "Bangalore",    country: "India", team: "India" },
  { slug: "pune-projects",         city: "Pune",         country: "India", team: "India" },
  { slug: "goa-projects",          city: "Goa",          country: "India", team: "India" },
];

interface ScrapedProject {
  slug: string;             // e.g. "azizi-venice"
  name: string;             // e.g. "Azizi Venice"
  category: "residential" | "commercial";
  city: string;
  country: string;
  area?: string;            // "JVC", "Al Jaddaf"
  imageUrl?: string;
  detailUrl: string;
  configurations?: string;  // "1,2,3"
}

// Title-case a slug: "azizi-jaddaf-beach-oasis" → "Azizi Jaddaf Beach Oasis"
function titleCase(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bBy\b/g, "by")
    .replace(/\bIn\b/g, "in")
    .replace(/\bOf\b/g, "of")
    .replace(/\bAl\b/g, "Al")
    .replace(/\bDe\b/g, "de");
}

// Extract project slugs + meta from one city page's HTML.
// The pages contain images like: admin/assets/residential_property/<slug>/<file>.jpg
// plus data-loc="al barsha south, dubai" and data-beds="1,2".
function parseCityHtml(html: string, city: string, country: string): ScrapedProject[] {
  const projects: Record<string, ScrapedProject> = {};

  // Find every property card by image path
  const imgRe = /admin\/assets\/(residential_property|commercial_property)\/([a-z0-9-]+)\/([^"]+\.(?:jpg|jpeg|png|webp))/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const [, kind, slug, file] = m;
    const category = kind === "commercial_property" ? "commercial" : "residential";
    if (projects[slug]) continue; // first image wins
    projects[slug] = {
      slug,
      name: titleCase(slug),
      category,
      city,
      country,
      imageUrl: `${BASE}/admin/assets/${kind}/${slug}/${file}`,
      detailUrl: `${BASE}/${kind}/${slug}`,
    };
  }

  // Augment with location info (data-loc="al barsha south, dubai")
  // We can only do this if the project slug appears near the data-loc attribute.
  const cardRe = /data-loc="([^"]+)"[\s\S]{0,3000}?(residential_property|commercial_property)\/([a-z0-9-]+)/gi;
  while ((m = cardRe.exec(html)) !== null) {
    const [, loc, , slug] = m;
    if (projects[slug]) {
      // The loc looks like "al jaddaf, dubai" — area is before the comma
      const area = loc.split(",")[0]?.trim();
      if (area) projects[slug].area = area.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  // Augment with bed configs
  const bedsRe = /data-beds="([^"]+)"[\s\S]{0,3000}?(residential_property|commercial_property)\/([a-z0-9-]+)/gi;
  while ((m = bedsRe.exec(html)) !== null) {
    const [, beds, , slug] = m;
    if (projects[slug]) projects[slug].configurations = beds;
  }

  return Object.values(projects);
}

async function fetchCity(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/${slug}`, { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

const HERO_PALETTES: Record<string, string> = {
  Dubai: "from-[#0b1a33] to-[#c9a24b]",
  "Abu Dhabi": "from-[#1e3a8a] to-[#0ea5e9]",
  "Ras Al Khaimah": "from-[#0891b2] to-[#67e8f9]",
  Gurgaon: "from-[#7e22ce] to-[#c084fc]",
  Delhi: "from-[#dc2626] to-[#f59e0b]",
  Noida: "from-[#16a34a] to-[#84cc16]",
  Bangalore: "from-[#0d9488] to-[#5eead4]",
  Pune: "from-[#a16207] to-[#facc15]",
  Goa: "from-[#db2777] to-[#fb7185]",
};

export interface SyncResult {
  cityResults: Array<{ city: string; ok: boolean; found: number }>;
  upserted: number;
  total: number;
  finishedAt: string;
}

export async function syncProjectsFromMarketingSite(): Promise<SyncResult> {
  const cityResults: SyncResult["cityResults"] = [];
  let upserted = 0;

  for (const cp of CITY_PAGES) {
    const html = await fetchCity(cp.slug);
    if (!html) { cityResults.push({ city: cp.city, ok: false, found: 0 }); continue; }
    const projects = parseCityHtml(html, cp.city, cp.country);

    for (const p of projects) {
      try {
        const common = {
          name: p.name,
          city: p.city,
          country: p.country,
          area: p.area,
          imageUrl: p.imageUrl,
          brochureUrl: p.detailUrl,
          heroColor: HERO_PALETTES[p.city] ?? "from-slate-700 to-slate-400",
          category: p.category,
          source: "wcr-website",
          syncedAt: new Date(),
        };
        await prisma.project.upsert({
          where: { slug: p.slug },
          create: {
            ...common,
            slug: p.slug,
            description: `Auto-synced from whitecollarrealty.com (${p.category}). ${p.configurations ? `Configurations: ${p.configurations} BHK.` : ""}`,
            status: p.category === "commercial" ? ProjectStatus.READY : ProjectStatus.OFF_PLAN,
          },
          update: common,
        });
        upserted++;
      } catch {
        // Conflict or transient — skip
      }
    }
    cityResults.push({ city: cp.city, ok: true, found: projects.length });
  }

  const total = await prisma.project.count();
  return { cityResults, upserted, total, finishedAt: new Date().toISOString() };
}
