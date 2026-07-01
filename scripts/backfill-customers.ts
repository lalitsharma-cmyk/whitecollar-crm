// ─────────────────────────────────────────────────────────────────────────────
// backfill-customers.ts — WS-J J3. Create canonical Customers over EXISTING leads
// and link duplicate enquiries, so the returning-client unified view works on
// historical data (data-consistency rule: existing + imported, not just future).
//
// GROUPING: transitive union-find over LIVE leads (deletedAt:null) keyed by
//   • last-10-digit phone (primary + alt)  OR
//   • exact lowercased email (primary + alt)
// — NEVER by name (spec: name alone is not a duplicate). Mirrors src/lib/customer/
// detect.ts normalisation exactly. A cluster of ≥2 leads → ONE Customer; every
// member is linked via an immutable CustomerLinkAudit row (mirrors link.ts).
//
// SAFE: idempotent (a cluster already sharing a customerId reuses it; fully-linked
// clusters are skipped), audited, reversible (every link writes prevCustomerId=null
// so unlink restores standalone). Singletons stay customerId=NULL. Recycle-bin
// excluded. Run backup-first.
//
//   npx tsx scripts/backfill-customers.ts            # dry-run (cluster stats, no writes)
//   npx tsx scripts/backfill-customers.ts --apply    # write to prod
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { computeCustomerConfidence } from "../src/lib/customer/compute";

const APPLY = process.argv.includes("--apply");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(readFileSync(new URL("../.env", import.meta.url), "utf8"))![1];
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const REASON = "backfill-customers-2026-07-01";

const last10 = (s: string | null | undefined): string => { const d = (s ?? "").replace(/\D/g, ""); return d.length >= 7 ? d.slice(-10) : ""; };
const normEmail = (e: string | null | undefined): string => (e ?? "").toLowerCase().trim();

// JUNK guards — placeholder phones/emails are NOT identity and must never cluster
// unrelated people (the dry-run caught "9999999999" merging 5 different people).
const JUNK_PHONE = new Set(["1234567890", "1234567891", "9876543210", "0123456789", "1234567899", "0000000000"]);
const isJunkPhone = (p: string): boolean => !p || /^(\d)\1{6,}$/.test(p) || JUNK_PHONE.has(p); // all-same-digit (000…/999…) or a known placeholder
const JUNK_EMAIL = new Set(["na@na.com", "test@test.com", "no@email.com", "noemail@noemail.com", "a@a.com", "abc@abc.com", "xyz@xyz.com", "email@email.com"]);
const isJunkEmail = (e: string): boolean => !e || !e.includes("@") || JUNK_EMAIL.has(e);

// Union-find.
class UF {
  p = new Map<string, string>();
  find(x: string): string { if (!this.p.has(x)) this.p.set(x, x); let r = x; while (this.p.get(r) !== r) r = this.p.get(r)!; while (this.p.get(x) !== r) { const n = this.p.get(x)!; this.p.set(x, r); x = n; } return r; }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}

async function main() {
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, phone: true, altPhone: true, email: true, altEmail: true, ownerId: true, customerId: true },
  });

  // Build union-find: union each lead with a synthetic node per shared phone/email key.
  const uf = new UF();
  const keysOf = (l: typeof leads[number]) => {
    const ks: string[] = [];
    for (const p of [last10(l.phone), last10(l.altPhone)]) if (p && !isJunkPhone(p)) ks.push("p:" + p);
    for (const e of [normEmail(l.email), normEmail(l.altEmail)]) if (e && !isJunkEmail(e)) ks.push("e:" + e);
    return ks;
  };
  for (const l of leads) { uf.find("L:" + l.id); for (const k of keysOf(l)) uf.union("L:" + l.id, k); }

  // Cluster the leads (only leads that share ≥1 key with another lead form a ≥2 cluster).
  const byRoot = new Map<string, typeof leads>();
  for (const l of leads) { const r = uf.find("L:" + l.id); (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(l); }
  const clusters = [...byRoot.values()].filter((c) => c.length >= 2);

  const sizes = clusters.map((c) => c.length).sort((a, b) => b - a);
  const totalToLink = sizes.reduce((a, b) => a + b, 0);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Live leads: ${leads.length}`);
  console.log(`Duplicate clusters (≥2): ${clusters.length}  ·  leads in clusters: ${totalToLink}  ·  singletons: ${leads.length - totalToLink}`);
  console.log(`Cluster size distribution (top 12): ${sizes.slice(0, 12).join(", ")}${sizes.length > 12 ? " …" : ""}`);
  console.log(`Largest cluster: ${sizes[0] ?? 0} leads`);
  // Show a few sample clusters so the grouping can be eyeballed.
  for (const c of clusters.slice(0, 5)) {
    console.log(`  · ${c.length}× ${c.map((l) => `${(l.name ?? "?").slice(0, 18)}[${last10(l.phone) || normEmail(l.email) || "—"}]`).join("  ")}`);
  }

  if (!APPLY) { console.log("\n(dry-run — no writes. Review cluster sizes above, then re-run with --apply.)"); return; }

  let customersCreated = 0, leadsLinked = 0, skipped = 0;
  for (const cluster of clusters) {
    // per-cluster shared keys → to flag each member's join factor.
    const phoneKeys = new Set<string>(), emailKeys = new Set<string>();
    for (const l of cluster) { for (const p of [last10(l.phone), last10(l.altPhone)]) if (p) phoneKeys.add(p); for (const e of [normEmail(l.email), normEmail(l.altEmail)]) if (e) emailKeys.add(e); }

    await prisma.$transaction(async (tx) => {
      // Idempotent: reuse an existing customerId already on a member, else create one.
      const existing = cluster.find((l) => l.customerId)?.customerId ?? null;
      let customerId = existing;
      if (!customerId) {
        const c = await tx.customer.create({ data: {}, select: { id: true } });
        customerId = c.id; customersCreated++;
      }
      for (const l of cluster) {
        if (l.customerId === customerId) { skipped++; continue; } // already linked to this customer
        const sameMobile = [last10(l.phone), last10(l.altPhone)].some((p) => p && [...phoneKeys].filter((k) => k === p).length >= 1 && cluster.some((o) => o.id !== l.id && [last10(o.phone), last10(o.altPhone)].includes(p)));
        const sameEmail = [normEmail(l.email), normEmail(l.altEmail)].some((e) => e && cluster.some((o) => o.id !== l.id && [normEmail(o.email), normEmail(o.altEmail)].includes(e)));
        const conf = computeCustomerConfidence({ sameMobile, sameEmail });
        const before = l.customerId ?? null;
        await tx.lead.update({ where: { id: l.id }, data: { customerId } });
        await tx.customerLinkAudit.create({ data: {
          customerId, leadId: l.id, action: "LINK", performedById: null,
          reason: REASON, confidenceSnapshot: conf.score,
          matchFactors: { sameMobile, sameEmail } as Prisma.InputJsonValue,
          previousOwnerId: l.ownerId ?? null, currentOwnerId: l.ownerId ?? null,
          prevCustomerId: before, newCustomerId: customerId, rollbackAvailable: true,
        } });
        leadsLinked++;
      }
    });
  }
  const customersTotal = await prisma.customer.count();
  const linkedTotal = await prisma.lead.count({ where: { customerId: { not: null } } });
  console.log(`\n✅ APPLIED · customers created: ${customersCreated}, leads linked: ${leadsLinked}, already-linked skipped: ${skipped}`);
  console.log(`   Prod now: Customer rows=${customersTotal}, leads with customerId=${linkedTotal}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
