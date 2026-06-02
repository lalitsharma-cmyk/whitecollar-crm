// Reproduce what the lead detail page does, line by line, to find the 500.
import { prisma } from "../src/lib/prisma";
import { bestUnitsForLead } from "../src/lib/inventoryMatch";
import { getTravelRatePerKmInr } from "../src/lib/settings";

const LEAD_ID = process.argv[2] ?? "cmplqtatz01nkla04jw9mq996";

async function main() {
  console.log(`Debugging lead: ${LEAD_ID}\n`);

  try {
    console.log("1. prisma.lead.findUnique with all includes…");
    const lead = await prisma.lead.findUnique({
      where: { id: LEAD_ID },
      include: {
        owner: true,
        interestedUnits: { include: { unit: { include: { project: true } } } },
        discussed: { include: { project: true }, orderBy: { discussedAt: "desc" } },
        activities: { orderBy: { createdAt: "desc" }, take: 25, include: { user: true } },
        callLogs: { orderBy: { startedAt: "desc" }, take: 50, include: { user: true } },
        notes: { orderBy: { createdAt: "desc" }, take: 10, include: { user: true } },
        assignments: { orderBy: { assignedAt: "desc" }, take: 5, include: { user: true } },
      },
    });
    console.log(`   lead ${lead ? "found" : "NOT FOUND"}`);
    if (!lead) { console.log("   ↳ would notFound()"); return; }
    console.log(`   name=${lead.name}  status=${lead.status}  aiScore=${lead.aiScore}`);
    console.log(`   callLogs: ${lead.callLogs.length}  activities: ${lead.activities.length}`);
    console.log(`   owner: ${lead.owner?.name ?? "(none)"}`);
    console.log(`   forwardedTeam: ${lead.forwardedTeam}  budgetCurrency: ${lead.budgetCurrency}`);

    console.log("\n2. prisma.activity.findMany meetings…");
    const meetingActs = await prisma.activity.findMany({
      where: { leadId: LEAD_ID, type: { in: ["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT"] } },
      orderBy: { createdAt: "desc" },
    });
    console.log(`   ${meetingActs.length} meeting activities`);

    console.log("\n3. prisma.project.findMany…");
    const allProjects = await prisma.project.findMany({ select: { id: true, name: true, city: true }, orderBy: { name: "asc" } });
    console.log(`   ${allProjects.length} projects`);

    console.log("\n4. bestUnitsForLead…");
    const suggestedUnits = await bestUnitsForLead(LEAD_ID, 3);
    console.log(`   ${suggestedUnits.length} suggested units`);

    console.log("\n5. getTravelRatePerKmInr…");
    const travel = await getTravelRatePerKmInr();
    console.log(`   travelRatePerKmInr = ${travel}`);

    console.log("\n6. Check enum / type integrity on activities (could STATUS_CHANGE break TS render?)…");
    const types = new Set(lead.activities.map((a) => a.type));
    console.log(`   distinct activity types: ${[...types].join(", ")}`);

    console.log("\n7. Sample 3 callLogs (any with weird data?)");
    for (const c of lead.callLogs.slice(0, 3)) {
      console.log(`   ${c.id.slice(0,8)} outcome=${c.outcome} attribName=${c.attributedAgentName ?? "-"} user=${c.user.name}`);
    }

    console.log("\n✅ All data fetches succeeded. The 500 must be in JSX rendering — check Vercel function logs.");
  } catch (e) {
    console.log(`\n❌ THREW: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) console.log(e.stack.split("\n").slice(0, 8).join("\n"));
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
