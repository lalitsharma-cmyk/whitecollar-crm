import { prisma } from "../src/lib/prisma";
import { fmtIST12, fmtIST12Paren, fmtISTDate } from "../src/lib/datetime";
import { formatBudget } from "../src/lib/budgetParse";

const LEAD_ID = process.argv[2] ?? "cmplqtatz01nkla04jw9mq996";

async function main() {
  const lead = await prisma.lead.findUnique({
    where: { id: LEAD_ID },
    include: {
      callLogs: { orderBy: { startedAt: "desc" }, include: { user: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 25, include: { user: true } },
      assignments: { orderBy: { assignedAt: "desc" }, take: 5, include: { user: true } },
    },
  });
  if (!lead) { console.log("not found"); return; }

  console.log("=== formatBudget tests ===");
  try {
    const r = formatBudget(lead.budgetMin, lead.budgetCurrency === "INR" ? "INR" : "AED");
    console.log("formatBudget(lead.budgetMin):", r);
  } catch (e) { console.log("THREW:", e instanceof Error ? e.stack?.split("\n").slice(0, 3).join("\n") : e); }

  console.log("\n=== callLogs render ===");
  for (const c of lead.callLogs) {
    try {
      const stamp = fmtIST12Paren(c.startedAt);
      const displayName = c.attributedAgentName ?? c.user?.name ?? "Unknown Agent";
      console.log("  " + displayName.padEnd(20) + " " + stamp + " " + c.outcome);
    } catch (e) { console.log("  THREW on " + c.id + ": " + (e instanceof Error ? e.message : e)); }
  }

  console.log("\n=== firstCallAt + lastCallAt ===");
  const lastCallAt = lead.callLogs[0]?.startedAt ?? null;
  const firstCallAt = lead.callLogs[lead.callLogs.length - 1]?.startedAt ?? null;
  console.log("first:", firstCallAt?.toISOString(), "→ display:", firstCallAt ? fmtISTDate(firstCallAt) : "null");
  console.log("last: ", lastCallAt?.toISOString(), "→ display:", lastCallAt ? fmtISTDate(lastCallAt) : "null");

  console.log("\n=== activities timeline render ===");
  for (const a of lead.activities) {
    try {
      const stamp = fmtIST12(a.createdAt);
      const userName = a.user?.name ?? "System";
      console.log("  " + a.type.padEnd(15) + " " + userName.padEnd(20) + " " + stamp);
    } catch (e) { console.log("  THREW on " + a.id + ": " + (e instanceof Error ? e.message : e)); }
  }

  console.log("\n=== assignments render ===");
  for (const a of lead.assignments) {
    try {
      const stamp = fmtIST12(a.assignedAt);
      console.log("  " + a.user.name.padEnd(20) + " " + stamp + " reason=" + a.reason);
    } catch (e) { console.log("  THREW on " + a.id + ": " + (e instanceof Error ? e.message : e)); }
  }

  // ── reproduce the lead.callLogs.length === 5 case, render groupCalls ──
  console.log("\n=== groupCalls reproduction ===");
  type C = (typeof lead.callLogs)[number];
  const NO_ANSWER = new Set(["NOT_PICKED", "SWITCHED_OFF", "BUSY"]);
  type Group = { kind: "single"; call: C } | { kind: "no-answer-streak"; attempts: C[]; firstAt: Date; lastAt: Date; displayName: string };
  function groupCalls(callLogs: C[]): Group[] {
    const out: Group[] = [];
    let i = 0;
    while (i < callLogs.length) {
      const c = callLogs[i];
      const isNoAnswer = NO_ANSWER.has(c.outcome);
      if (!isNoAnswer) { out.push({ kind: "single", call: c }); i++; continue; }
      const displayName = c.attributedAgentName ?? c.user?.name ?? "Unknown Agent";
      const streak: C[] = [c];
      let j = i + 1;
      while (j < callLogs.length) {
        const n = callLogs[j];
        const nName = n.attributedAgentName ?? n.user?.name ?? "Unknown Agent";
        if (NO_ANSWER.has(n.outcome) && nName === displayName) { streak.push(n); j++; } else break;
      }
      if (streak.length >= 2) {
        const firstAt = streak[streak.length - 1].startedAt;
        const lastAt = streak[0].startedAt;
        out.push({ kind: "no-answer-streak", attempts: streak, firstAt, lastAt, displayName });
        i = j;
      } else { out.push({ kind: "single", call: c }); i++; }
    }
    return out;
  }
  const groups = groupCalls(lead.callLogs);
  console.log("groups:", groups.length);
  for (const g of groups) {
    if (g.kind === "single") {
      const displayName = g.call.attributedAgentName ?? g.call.user?.name ?? "Unknown Agent";
      // Reproduce the NOTES-CLEAN regex
      try {
        const notesClean = g.call.notes
          ? g.call.notes.replace(/^[A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2}\s*:\s*/, "")
          : null;
        console.log("  single " + displayName.padEnd(20) + " notesClean=" + (notesClean ?? "(null)").slice(0, 40));
      } catch (e) { console.log("  THREW: " + e); }
    } else {
      console.log("  streak " + g.displayName + " × " + g.attempts.length);
      for (const c of g.attempts) {
        try {
          const escaped = g.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          console.log("    regex escaped name: " + escaped);
          const notesClean = c.notes
            ? c.notes.replace(new RegExp("^" + escaped + "\\s*:\\s*", "i"), "")
            : null;
          console.log("    notesClean=" + (notesClean ?? "(null)").slice(0, 40));
        } catch (e) { console.log("    THREW: " + e); }
      }
    }
  }
}

main().catch((e) => { console.error("MAIN THREW:", e); process.exit(1); }).finally(() => prisma.$disconnect());
