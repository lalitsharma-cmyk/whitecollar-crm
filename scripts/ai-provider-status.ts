import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("=== PROVIDER KEY PRESENCE (production runtime reads these) ===");
  console.log("ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY?.trim() ? "SET" : "EMPTY/UNSET");
  console.log("OPENAI_API_KEY:   ", process.env.OPENAI_API_KEY?.trim() ? "SET" : "EMPTY/UNSET");
  console.log("GEMINI_API_KEY:   ", process.env.GEMINI_API_KEY?.trim() ? "SET" : "EMPTY/UNSET");
  console.log("(NOTE: this is LOCAL env. Production keys live in Vercel and may differ.)\n");

  console.log("=== aiUsageLog — last 12 real provider calls (proves live API hits) ===");
  const logs = await prisma.aiUsageLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { provider: true, model: true, feature: true, ok: true, inputTokens: true, outputTokens: true, ms: true, createdAt: true },
  });
  if (logs.length === 0) console.log("(none)");
  for (const l of logs) {
    console.log(
      `${l.createdAt.toISOString()} | ${l.provider.padEnd(10)} | ${(l.model ?? "").padEnd(28)} | ${l.feature?.padEnd(22) ?? ""} | ok=${l.ok} | in=${l.inputTokens ?? 0} out=${l.outputTokens ?? 0} | ${l.ms ?? "?"}ms`
    );
  }

  console.log("\n=== aiUsageLog — count by provider (all-time) ===");
  const byProvider = await prisma.aiUsageLog.groupBy({
    by: ["provider", "ok"],
    _count: { _all: true },
  });
  for (const g of byProvider) console.log(`${g.provider.padEnd(10)} ok=${g.ok} → ${g._count._all}`);

  console.log("\n=== aiAnalysis — count by model (stored comparison results) ===");
  const byModel = await prisma.aiAnalysis.groupBy({
    by: ["model"],
    _count: { _all: true },
    _max: { createdAt: true },
  });
  for (const g of byModel) console.log(`${(g.model ?? "").padEnd(34)} → ${g._count._all} rows, latest ${g._max.createdAt?.toISOString() ?? "?"}`);

  console.log("\n=== aiAnalysis — last 8 stored results (which model, which lead, when) ===");
  const analyses = await prisma.aiAnalysis.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { model: true, ok: true, leadId: true, createdAt: true, inputTokens: true, outputTokens: true },
  });
  if (analyses.length === 0) console.log("(none)");
  for (const a of analyses) {
    console.log(`${a.createdAt.toISOString()} | ${(a.model ?? "").padEnd(34)} | lead=${a.leadId} | ok=${a.ok} | in=${a.inputTokens ?? 0} out=${a.outputTokens ?? 0}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
