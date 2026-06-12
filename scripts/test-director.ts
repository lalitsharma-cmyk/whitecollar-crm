import { prisma } from "../src/lib/prisma";
import { buildLeadSnapshot } from "../src/lib/ai/leadSnapshot";
import { directorEngine } from "../src/lib/ai/engines/director";
import { qualificationEngine } from "../src/lib/ai/engines/qualification";
import { coachingEngine } from "../src/lib/ai/engines/coaching";
import { followupEngine } from "../src/lib/ai/engines/followup";
import { inventoryEngine } from "../src/lib/ai/engines/inventory";
import { escalationEngine } from "../src/lib/ai/engines/escalation";
import { revivalEngine } from "../src/lib/ai/engines/revival";
import { priorityEngine } from "../src/lib/ai/engines/priority";

// Mirrors computeSalesDirectorPanel's mock path (pure engines, no server-only).
const LEADS = [
  "cmqalgami00rpl104eq6nasx3", // Mehak's imported lead (agent-owned)
  "cmq7qspja0003l204ao82nedk", // Lalit's lead
];

async function main() {
  for (const id of LEADS) {
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: { owner: true, activities: { orderBy: { createdAt: "desc" }, take: 25 }, callLogs: { orderBy: { startedAt: "desc" }, take: 50 } },
    });
    if (!lead) { console.log(`\n### ${id} — NOT FOUND`); continue; }

    const ctx = { lead: buildLeadSnapshot(lead, Date.now()), memory: null };
    const d = directorEngine.mock(ctx);
    const q = qualificationEngine.mock(ctx);
    const c = coachingEngine.mock(ctx);
    const f = followupEngine.mock(ctx);
    const inv = inventoryEngine.mock(ctx);

    console.log(`\n${"=".repeat(74)}\n### ${lead.name}  (owner: ${lead.owner?.name ?? "—"} / ${lead.owner?.role ?? "—"})\n${"=".repeat(74)}`);
    console.log(`\n🎯 DIRECTOR: ${d.verdict} (${d.urgency}) — ${d.verdictReason}`);
    console.log(`   ⚠ Missing:  ${d.whatsMissing.join(" | ")}`);
    console.log(`   ❓ Ask:      ${d.whatToAskNext.join(" | ")}`);
    console.log(`   ▶ Action:   ${d.nextAction}`);
    console.log(`   📡 Channel:  ${d.channel} — ${d.channelReason}`);
    console.log(`   🚨 Escalate: ${d.escalate.should ? `YES → ${d.escalate.to}` : "no"}`);
    console.log(`   ✍ Opener:   "${d.openingLine}"`);
    console.log(`\n📊 QUALIFICATION: ${q.totalScore}/100 (${q.overall}) — gap: ${q.biggestGap}`);
    console.log(`🎓 COACHING: ${c.grade} — ${c.headline}`);
    console.log(`   Missed: ${c.whatAgentMissed.join(" | ")}`);
    console.log(`⏱ FOLLOW-UP: ${f.lastFollowupQuality}${f.overdue ? " (overdue)" : ""} via ${f.recommendedChannel}`);
    console.log(`   Draft: "${f.draftMessage}"`);
    console.log(`🏢 INVENTORY: ${inv.matchStatus} — ${inv.suggestedProjects.map((x) => x.name).join(", ") || inv.sourcingGaps[0]}`);

    const esc = escalationEngine.mock(ctx);
    const rev = revivalEngine.mock(ctx);
    const prio = priorityEngine.mock(ctx);
    console.log(`🚨 ESCALATION: ${esc.shouldEscalate ? `→ ${esc.escalateTo} (${esc.urgency})` : "not needed"} — ${esc.triggers[0]}`);
    console.log(`🔄 REVIVAL: ${rev.isWorthReviving ? `worth it · ${rev.angle}` : "low value"} — "${rev.draftMessage.slice(0, 70)}..."`);
    console.log(`⚡ PRIORITY: ${prio.priorityScore}/100 (${prio.tier}) — ${prio.rankHint}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
