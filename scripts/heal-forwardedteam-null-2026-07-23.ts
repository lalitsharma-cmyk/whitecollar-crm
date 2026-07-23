import { prisma } from "../src/lib/prisma";
import { writeFileSync, mkdirSync } from "node:fs";

// ════════════════════════════════════════════════════════════════════════════
// HEAL — owned leads missing a team (forwardedTeam = null). Audit 2026-07-23.
//
// A null forwardedTeam makes a lead invisible to MANAGERS (canTouchLead returns
// false) and suppresses team automation. For an OWNED lead the team is unambiguous:
// it is the owner's team. Backfill forwardedTeam from the owner's team (fallback to
// market: UAE→Dubai / India→India). Scope = owned, non-deleted only — unowned pool
// leads are left for triage (no authoritative team to infer). Reversible.
// ════════════════════════════════════════════════════════════════════════════
const APPLY = process.argv.includes("--apply");
const STAMP = "2026-07-23";

function inferTeam(ownerTeam: string | null | undefined, market: string | null | undefined): "Dubai" | "India" | null {
  const t = (ownerTeam ?? "").trim();
  if (/dubai|uae/i.test(t)) return "Dubai";
  if (/india/i.test(t)) return "India";
  if (market === "UAE") return "Dubai";
  if (market === "India") return "India";
  return null;
}

(async () => {
  const rows = await prisma.lead.findMany({
    where: { ownerId: { not: null }, deletedAt: null, forwardedTeam: null },
    select: { id: true, forwardedTeam: true, market: true, currentStatus: true,
              owner: { select: { id: true, name: true, team: true } } },
  });
  console.log(`Owned, non-deleted leads with forwardedTeam=null: ${rows.length}`);

  const plan = rows.map((l) => ({ id: l.id, market: l.market, ownerName: l.owner?.name, ownerTeam: l.owner?.team, infer: inferTeam(l.owner?.team, l.market) }));
  const byOwner: Record<string, { team: string | null; n: number }> = {};
  for (const p of plan) { const k = p.ownerName ?? "(none)"; byOwner[k] = byOwner[k] || { team: p.infer, n: 0 }; byOwner[k].n++; }
  console.log("by owner → inferred team:", Object.fromEntries(Object.entries(byOwner).map(([k, v]) => [k, `${v.n} → ${v.team}`])));
  const unresolved = plan.filter((p) => p.infer == null);
  console.log(`resolvable: ${plan.length - unresolved.length} · UNRESOLVABLE (skip): ${unresolved.length}`);
  if (unresolved.length) console.log("  unresolved sample:", unresolved.slice(0, 5));

  // Backup + reversal (only the resolvable set is mutated).
  const resolvable = rows.filter((l) => inferTeam(l.owner?.team, l.market) != null);
  mkdirSync("backups/forwardedteam-heal", { recursive: true });
  writeFileSync(`backups/forwardedteam-heal/before-${STAMP}.json`, JSON.stringify(resolvable.map((l) => ({ id: l.id, forwardedTeam: l.forwardedTeam })), null, 2));
  writeFileSync(`backups/forwardedteam-heal/REVERSAL-${STAMP}.sql`,
    [`-- Reverse forwardedTeam backfill ${STAMP} (restore NULL)`,
     ...resolvable.map((l) => `UPDATE "Lead" SET "forwardedTeam"=NULL WHERE id='${l.id}';`)].join("\n") + "\n");
  console.log(`snapshot + reversal → backups/forwardedteam-heal/  (${resolvable.length} rows)`);

  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply."); await prisma.$disconnect(); return; }

  const now = new Date();
  const actorId = "cmplo0t6v0000vpxslasvbwuq"; // Lalit
  let moved = 0;
  const perTeam: Record<string, number> = {};
  for (const l of resolvable) {
    const team = inferTeam(l.owner?.team, l.market)!;
    await prisma.lead.update({ where: { id: l.id }, data: { forwardedTeam: team } });
    perTeam[team] = (perTeam[team] || 0) + 1;
    moved++;
  }
  console.log(`SET forwardedTeam on ${moved} leads:`, perTeam);

  await prisma.operationLog.create({ data: {
    operation: "lead.edit", entityType: "Lead", module: "Leads", field: "forwardedTeam",
    summary: `Backfill forwardedTeam (owner-team inference) on ${moved} owned leads — restore manager visibility`,
    status: "EXECUTED", affectedCount: moved, affectedIds: resolvable.map((l) => l.id),
    beforeState: resolvable.map((l) => ({ id: l.id, forwardedTeam: null })),
    afterState: { source: "owner.team|market", perTeam }, createdById: actorId,
  } }).catch((e) => console.error("OperationLog failed:", e.message));
  try {
    const { audit } = await import("../src/lib/audit");
    await audit({ userId: actorId, action: "lead.forwardedteam.backfill", entity: "Lead", entityId: "batch",
      meta: { count: moved, perTeam, source: "owner-team-inference" } });
  } catch (e) { console.error("audit failed:", (e as Error).message); }

  const remaining = await prisma.lead.count({ where: { ownerId: { not: null }, deletedAt: null, forwardedTeam: null } });
  console.log(`\nVERIFY: owned leads still missing a team = ${remaining} (expect only the unresolvable ${unresolved.length})`);
  await prisma.$disconnect();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
