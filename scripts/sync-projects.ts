// CLI: run a one-shot project sync against the production DB.
// Use: DATABASE_URL="postgresql://..." npx tsx scripts/sync-projects.ts

import { syncProjectsFromMarketingSite } from "../src/lib/syncProjects";

(async () => {
  console.log("🔄 Syncing projects from whitecollarrealty.com…");
  const r = await syncProjectsFromMarketingSite();
  console.log("\nCity results:");
  for (const c of r.cityResults) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.city.padEnd(18)}  ${c.found} projects`);
  }
  console.log(`\n✅ Upserted ${r.upserted} project rows · total in DB: ${r.total}`);
  process.exit(0);
})().catch((e) => { console.error("❌", e); process.exit(1); });
