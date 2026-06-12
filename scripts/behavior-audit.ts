import { prisma } from "../src/lib/prisma";

/**
 * READ-ONLY behavioral audit. Answers: does a lead's BANT / intelligence /
 * conversation / AI output populate the SAME regardless of (a) owner role
 * (agent vs admin/Lalit) and (b) origin (newly imported vs existing/manual)?
 *
 * The role audit proved permissions are correct. This proves whether the DATA
 * an agent actually works with is equivalent to what an admin sees.
 */
const LALIT_ID = "cmplo0t6v0000vpxslasvbwuq";

type Row = Record<string, bigint | string | null>;
const n = (v: bigint | string | null) => (v == null ? 0 : Number(v));
const pct = (part: bigint | string | null, total: bigint | string | null) => {
  const t = n(total);
  return t === 0 ? "  —  " : `${String(Math.round((n(part) / t) * 100)).padStart(3)}%`;
};

async function main() {
  // ── Population by origin × owner-group ──────────────────────────────────────
  const grid = (await prisma.$queryRawUnsafe(`
    SELECT
      CASE WHEN l."importBatchId" IS NOT NULL THEN 'imported' ELSE 'manual' END AS origin,
      CASE
        WHEN l."ownerId" IS NULL THEN 'unassigned'
        WHEN l."ownerId" = '${LALIT_ID}' THEN 'lalit'
        WHEN u.role = 'AGENT' THEN 'agent'
        WHEN u.role = 'MANAGER' THEN 'manager'
        WHEN u.role = 'ADMIN' THEN 'admin'
        ELSE 'other'
      END AS owner_group,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE l."budgetMin" IS NOT NULL OR l."budgetMax" IS NOT NULL) AS budget,
      COUNT(*) FILTER (WHERE l."authorityLevel" IS NOT NULL) AS authority,
      COUNT(*) FILTER (WHERE l."needSummary" IS NOT NULL OR l."whoIsClient" IS NOT NULL) AS need,
      COUNT(*) FILTER (WHERE l."whenCanInvest" IS NOT NULL OR l."meetingDate" IS NOT NULL OR l."siteVisitDate" IS NOT NULL) AS timeline,
      COUNT(*) FILTER (WHERE l."aiSummary" IS NOT NULL AND length(l."aiSummary") > 0) AS ai_summary,
      COUNT(*) FILTER (WHERE l."remarks" IS NOT NULL AND length(l."remarks") > 0) AS remarks,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Activity" a WHERE a."leadId" = l.id)) AS activity,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "CallLog" c WHERE c."leadId" = l.id)) AS calls,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AiAnalysis" x WHERE x."leadId" = l.id)) AS ai_analysis
    FROM "Lead" l
    LEFT JOIN "User" u ON u.id = l."ownerId"
    WHERE l."deletedAt" IS NULL
    GROUP BY 1, 2
    ORDER BY 1, 2
  `)) as Row[];

  console.log("=== POPULATION RATE by origin × owner (deleted excluded) ===");
  console.log("origin   owner       total | Budget Auth  Need  Time  | AISumm Remark Activ Calls | WarRoomAI");
  console.log("-------- ---------- ------- | ----------------------- | ------------------------- | ---------");
  for (const r of grid) {
    console.log(
      `${String(r.origin).padEnd(8)} ${String(r.owner_group).padEnd(10)} ${String(n(r.total)).padStart(6)} |` +
        ` ${pct(r.budget, r.total)} ${pct(r.authority, r.total)} ${pct(r.need, r.total)} ${pct(r.timeline, r.total)} |` +
        ` ${pct(r.ai_summary, r.total)} ${pct(r.remarks, r.total)} ${pct(r.activity, r.total)} ${pct(r.calls, r.total)} |` +
        ` ${pct(r.ai_analysis, r.total)}`,
    );
  }

  // ── Concrete side-by-side examples ──────────────────────────────────────────
  const fields = {
    id: true, name: true, source: true, leadOrigin: true, importBatchId: true, createdAt: true,
    ownerId: true, budgetMin: true, budgetMax: true, authorityLevel: true, authorityPerson: true,
    needSummary: true, whoIsClient: true, whenCanInvest: true, bantStatus: true,
    aiSummary: true, aiScoreValue: true, aiNextAction: true, remarks: true,
    owner: { select: { name: true, role: true } },
    _count: { select: { activities: true, callLogs: true, notes: true } },
  } as const;

  const importedAgent = await prisma.lead.findFirst({
    where: { deletedAt: null, importBatchId: { not: null }, owner: { role: "AGENT" } },
    orderBy: { createdAt: "desc" }, select: fields,
  });
  const workedAgent = await prisma.lead.findFirst({
    where: { deletedAt: null, importBatchId: null, owner: { role: "AGENT" }, remarks: { not: null } },
    orderBy: { updatedAt: "desc" }, select: fields,
  });
  const lalitLead = await prisma.lead.findFirst({
    where: { deletedAt: null, ownerId: LALIT_ID },
    orderBy: { updatedAt: "desc" }, select: fields,
  });

  const show = (label: string, l: typeof importedAgent) => {
    console.log(`\n--- ${label} ---`);
    if (!l) { console.log("  (no matching lead found)"); return; }
    const r = l as NonNullable<typeof importedAgent>;
    console.log(`  id=${r.id}  owner=${r.owner?.name ?? "—"} (${r.owner?.role ?? "—"})  origin=${r.leadOrigin}  imported=${r.importBatchId ? "YES" : "no"}`);
    console.log(`  BANT-B budget: ${r.budgetMin ?? "—"}–${r.budgetMax ?? "—"}`);
    console.log(`  BANT-A authority: ${r.authorityLevel ?? "—"} / ${r.authorityPerson ?? "—"}`);
    console.log(`  BANT-N need: ${(r.needSummary ?? r.whoIsClient ?? "—")?.toString().slice(0, 70)}`);
    console.log(`  BANT-T timeline: whenCanInvest=${r.whenCanInvest ?? "—"}  bantStatus=${r.bantStatus}`);
    console.log(`  Intelligence: aiSummary=${r.aiSummary ? `"${r.aiSummary.slice(0, 60)}..."` : "EMPTY"}  aiScore=${r.aiScoreValue ?? "—"}`);
    console.log(`  Conversation: remarks=${r.remarks ? `${r.remarks.length} chars` : "EMPTY"}  activities=${r._count.activities}  calls=${r._count.callLogs}  notes=${r._count.notes}`);
  };

  console.log("\n=== CONCRETE EXAMPLES (real prod leads) ===");
  show("A. Newly IMPORTED lead, AGENT-owned", importedAgent);
  show("B. Worked MANUAL lead, AGENT-owned", workedAgent);
  show("C. Lalit lead (admin + AI pilot)", lalitLead);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
