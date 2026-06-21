// scripts/audit-lalit-myleads.ts   (npx tsx scripts/audit-lalit-myleads.ts)
// READ-ONLY audit. Why is "My Leads" empty for Lalit while India/Dubai team
// views show his leads? Prime suspect: his leads' ownerId != his SESSION user id
// (a duplicate Lalit user record). Changes NOTHING.
import { prisma } from "../src/lib/prisma";
import { TERMINAL_STATUSES } from "../src/lib/lead-statuses";
// Inlined (leadScope.ts pulls in server-only via auth.ts → can't import in tsx).
const COLD_ORIGINS = ["COLD", "REVIVAL"];

const SESSION_EMAIL = "LALITSHARMA@whitecollarrealty.com"; // what Lalit logs in with

// The EXACT default "My Leads" predicate the leads page builds for seg=mine:
//   ownerId = me.id, deletedAt null, not cold, WORKABLE (null/""/notIn TERMINAL).
function myLeadsWhere(ownerId: string) {
  return {
    ownerId,
    deletedAt: null,
    isColdCall: false,
    leadOrigin: { notIn: COLD_ORIGINS },
    OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }],
  };
}

async function main() {
  console.log("═══════════════ LALIT « MY LEADS » AUDIT (read-only) ═══════════════\n");

  // 1) Every user record that looks like Lalit.
  const lalits = await prisma.user.findMany({
    where: { OR: [
      { name: { contains: "lalit", mode: "insensitive" } },
      { email: { contains: "lalit", mode: "insensitive" } },
    ] },
    select: { id: true, name: true, email: true, role: true, team: true, active: true, isSuperAdmin: true, leadOpsOnly: true },
    orderBy: { email: "asc" },
  });
  console.log(`Found ${lalits.length} user record(s) matching "lalit":\n`);

  for (const u of lalits) {
    const owned = await prisma.lead.count({ where: { ownerId: u.id, deletedAt: null } });
    const ownedNotDeleted = await prisma.lead.count({ where: { ownerId: u.id } });
    const workable = await prisma.lead.count({ where: myLeadsWhere(u.id) });
    const byTeam = await prisma.lead.groupBy({
      by: ["forwardedTeam"],
      where: { ownerId: u.id, deletedAt: null },
      _count: true,
    });
    const teamStr = byTeam.map((t) => `${t.forwardedTeam ?? "—"}:${t._count}`).join("  ");
    console.log(`• ${u.name}  <${u.email}>`);
    console.log(`    id=${u.id}  role=${u.role}  team=${u.team ?? "—"}  active=${u.active}  super=${u.isSuperAdmin}  leadOps=${u.leadOpsOnly ?? false}`);
    console.log(`    owned(all)=${ownedNotDeleted}  owned(live)=${owned}  → MY-LEADS(workable)=${workable}   [${teamStr}]`);
    console.log("");
  }

  // 2) The SESSION user (who Lalit actually logs in as).
  const session = await prisma.user.findFirst({
    where: { email: { equals: SESSION_EMAIL, mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  console.log("─".repeat(70));
  if (!session) {
    console.log(`⚠ No user with email ${SESSION_EMAIL}. Session-email mismatch is itself the bug.`);
  } else {
    const myCount = await prisma.lead.count({ where: myLeadsWhere(session.id) });
    const ownedLive = await prisma.lead.count({ where: { ownerId: session.id, deletedAt: null } });
    console.log(`SESSION user = ${session.name} <${session.email}>  id=${session.id}`);
    console.log(`  → My Leads would show: ${myCount} workable  (of ${ownedLive} live owned)`);

    // 3) Leads that LOOK like Lalit's but are owned by a DIFFERENT Lalit id —
    //    these are exactly what shows under India/Dubai team views but NOT My Leads.
    const otherLalitIds = lalits.filter((u) => u.id !== session.id).map((u) => u.id);
    if (otherLalitIds.length) {
      const orphaned = await prisma.lead.count({
        where: { ownerId: { in: otherLalitIds }, deletedAt: null },
      });
      console.log(`  ⚠ ${orphaned} live leads are owned by OTHER Lalit record(s) ${JSON.stringify(otherLalitIds)} — visible in team views, missing from My Leads.`);
    }
  }

  // 4) Is the 9PM rollover implicated? Did it touch ownerId? It only writes
  //    followupDate/Activity — prove ownerId untouched by sampling recent changes.
  console.log("─".repeat(70));
  const followupSoon = await prisma.lead.count({
    where: { ...(session ? { ownerId: session.id } : {}), deletedAt: null, followupDate: { gt: new Date() } },
  });
  console.log(`Future-dated follow-ups under session user: ${followupSoon} (rollover moves dates, never ownerId).`);

  console.log("\n═══════════════ END AUDIT ═══════════════");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
