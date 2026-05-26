// End-to-end verification of every fix shipped in this session.
// Read-only — never mutates. Safe to re-run any time.

import { prisma } from "../src/lib/prisma";
import { parseRemarks } from "../src/lib/remarkParser";
import { parseBudget, formatBudget } from "../src/lib/budgetParse";
import { splitPhones } from "../src/lib/phone";
import { fmtIST12, fmtISTTime12 } from "../src/lib/datetime";

let pass = 0, fail = 0;

function ok(label: string, condition: boolean, detail?: string) {
  if (condition) { console.log(`  ✅ ${label}${detail ? `  (${detail})` : ""}`); pass++; }
  else { console.log(`  ❌ ${label}${detail ? `  — ${detail}` : ""}`); fail++; }
}

async function main() {
  console.log("═══ A. parseRemarks IST conversion ═══");
  {
    const cell = "Nitisha: on 3 May 2026 (12:36) forwarded to voicemail";
    const parsed = parseRemarks(cell);
    ok("parses 1 entry", parsed.length === 1, `got ${parsed.length}`);
    if (parsed.length === 1) {
      const ist = fmtIST12(parsed[0].when);
      ok("displays as 12.36 pm IST (not 6.06 pm)", /12\.36\s*pm/i.test(ist), `displayed: ${ist}`);
      ok("attributes to Nitisha", parsed[0].agentName === "Nitisha", `got: ${parsed[0].agentName}`);
    }
  }

  console.log("\n═══ B. parseRemarks multi-word names ═══");
  {
    const cell = "Lalit Sharma: on 5 May 2026 (10:00) called and chatted";
    const parsed = parseRemarks(cell);
    ok("captures 'Lalit Sharma' not just 'Sharma'",
      parsed[0]?.agentName === "Lalit Sharma",
      `got: ${parsed[0]?.agentName}`);
  }

  console.log("\n═══ C. budget parser K/M/L/Cr + word-boundary currency ═══");
  ok('"2.5M" → 2,500,000', parseBudget("2.5M") === 2_500_000);
  ok('"30L" → 3,000,000', parseBudget("30L") === 3_000_000);
  ok('"3Cr" → 30,000,000', parseBudget("3Cr") === 30_000_000);
  ok('"500K" → 500,000', parseBudget("500K") === 500_000);
  ok('"AED 12M" → 12,000,000 (currency strip)', parseBudget("AED 12M") === 12_000_000);
  ok('"30 Lakh" → 3,000,000 (Lakh not eaten to "Lkh")', parseBudget("30 Lakh") === 3_000_000);
  ok('formatBudget(12000000, "AED") → "12 M AED"-ish', /^12\s*M$/.test(formatBudget(12_000_000, "AED")));
  ok('formatBudget(12000000, "INR") → "1.2 Cr"-ish', /^1\.2\s*Cr$/.test(formatBudget(12_000_000, "INR")));
  ok('rejects "-30" (negative)', parseBudget("-30") === null);

  console.log("\n═══ D. phone splitter ═══");
  {
    const r = splitPhones("+919146449146, 7779990838", "+91");
    ok("splits comma-separated", r.length === 2, `got: ${JSON.stringify(r)}`);
    ok("first is E.164", r[0]?.startsWith("+91"));
  }

  console.log("\n═══ E. 12-hour time formatter ═══");
  {
    const noon = new Date("2026-05-26T06:30:00Z"); // 12:00 noon IST
    ok("fmtISTTime12(noon UTC) → '12.00 pm'", fmtISTTime12(noon) === "12.00 pm", `got: ${fmtISTTime12(noon)}`);
    const evening = new Date("2026-05-26T12:00:00Z"); // 17:30 IST
    ok("fmtISTTime12(12:00 UTC) → '5.30 pm'", fmtISTTime12(evening) === "5.30 pm", `got: ${fmtISTTime12(evening)}`);
    const midnightish = new Date("2026-05-26T18:30:00Z"); // 00:00 next day IST
    const r = fmtISTTime12(midnightish);
    ok("fmtISTTime12 midnight → '12.00 am'", r === "12.00 am", `got: ${r}`);
  }

  console.log("\n═══ F. Backfill outcome — CallLog state ═══");
  {
    const total = await prisma.callLog.count();
    const withAttribution = await prisma.callLog.count({ where: { attributedAgentName: { not: null } } });
    const adminFallbacks = await prisma.callLog.count({
      where: { attributedAgentName: null, notes: { contains: ": " } },
    });
    ok(`Total CallLogs: ${total}`, total > 0);
    ok(`Most calls now have attribution`, withAttribution > total * 0.9, `${withAttribution}/${total}`);
    ok(`No imported rows still falling back to "Admin"`, adminFallbacks === 0, `${adminFallbacks} unattributed left`);

    const distinctNames = await prisma.callLog.findMany({
      where: { attributedAgentName: { not: null } },
      select: { attributedAgentName: true },
      distinct: ["attributedAgentName"],
    });
    ok(`Multiple agent names present`, distinctNames.length > 1,
      `${distinctNames.length} distinct: ${distinctNames.slice(0, 6).map(d => d.attributedAgentName).join(", ")}...`);
  }

  console.log("\n═══ G. Rescore distribution sanity ═══");
  {
    const total = await prisma.lead.count({ where: { isColdCall: false } });
    const hot = await prisma.lead.count({ where: { isColdCall: false, aiScore: "HOT" } });
    const warm = await prisma.lead.count({ where: { isColdCall: false, aiScore: "WARM" } });
    const cold = await prisma.lead.count({ where: { isColdCall: false, aiScore: "COLD" } });
    console.log(`  Distribution: HOT=${hot}  WARM=${warm}  COLD=${cold}  (total ${total})`);
    ok(`Not 100% in one bucket`, hot < total && warm < total && cold < total, "stateless rescorer producing variety");
    ok(`At least some scored`, hot + warm + cold > 0);
  }

  console.log("\n═══ H. Not-picked filter — Prisma query works ═══");
  {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const notPickedLeads = await prisma.lead.count({
      where: {
        isColdCall: false,
        callLogs: {
          some: {
            outcome: { in: ["NOT_PICKED", "SWITCHED_OFF", "BUSY"] },
            startedAt: { gte: sevenDaysAgo },
          },
          none: {
            outcome: { in: ["CONNECTED", "INTERESTED"] },
            startedAt: { gte: sevenDaysAgo },
          },
        },
      },
    });
    ok(`Query runs without error`, notPickedLeads >= 0, `${notPickedLeads} leads match "not picked 7+ days"`);
  }

  console.log("\n═══ I. First/Last call dates derivation ═══");
  {
    const leadsWithCalls = await prisma.lead.findMany({
      where: { callLogs: { some: {} } },
      include: { callLogs: { orderBy: { startedAt: "desc" }, take: 1000 } },
      take: 3,
    });
    for (const l of leadsWithCalls) {
      const last = l.callLogs[0]?.startedAt;
      const first = l.callLogs[l.callLogs.length - 1]?.startedAt;
      const span = first && last
        ? Math.floor((last.getTime() - first.getTime()) / 86_400_000)
        : 0;
      console.log(`  ${l.name.padEnd(25)} first=${first?.toISOString().slice(0,10)} last=${last?.toISOString().slice(0,10)} span=${span}d (${l.callLogs.length} calls)`);
      ok(`  ↳ first <= last`, !!first && !!last && first.getTime() <= last.getTime());
    }
  }

  console.log("\n═══ J. Schema sanity ═══");
  {
    const fields = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'Lead' AND column_name IN ('altName','altPhone','followupReminderSentAt')`;
    const names = fields.map(f => f.column_name).sort();
    ok("Lead schema has altName / altPhone / followupReminderSentAt",
      names.length === 3,
      `got: ${names.join(", ")}`);
    const cl = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'CallLog' AND column_name = 'attributedAgentName'`;
    ok("CallLog.attributedAgentName column exists", cl.length === 1);
  }

  console.log("\n═══ SUMMARY ═══");
  console.log(`  ${pass} pass · ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
