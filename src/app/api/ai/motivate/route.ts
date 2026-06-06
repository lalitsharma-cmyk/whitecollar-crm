import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { generateText, aiEnabled } from "@/lib/ai";
import { quoteOfTheDay } from "@/lib/salesQuotes";
import { AIScore } from "@prisma/client";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";

/**
 * GET /api/ai/motivate
 *
 * Lalit's brief (verbatim):
 *   "For each agent, there should be AI who analyses everything in agent
 *    dashboard and Motivate him yes , You can do it or suggestion for any
 *    client"
 *
 * Returns one short motivational paragraph + one concrete client suggestion
 * pulled from the agent's hottest untouched lead. The dashboard card
 * (AIMotivatorCard) renders these two pieces.
 *
 * Falls back to a deterministic rule-based message when no AI key is set
 * so the card never goes blank.
 *
 * Per-agent per-day cache lives in MEMORY only (Next route handler module
 * scope) — good enough for the dashboard which re-renders many times per
 * day and we don't want to spam the LLM with identical prompts. Cold start
 * regenerates, which is fine.
 */

interface Cached { day: string; payload: Payload; }
interface Payload {
  motivation: string;
  suggestionLeadId: string | null;
  suggestionLeadName: string | null;
  suggestionAction: string | null;
  source: "ai" | "rule";
}

// Module-level cache. Vercel cold starts blow this away — that's fine.
const CACHE = new Map<string, Cached>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  const me = await requireUser();
  const cacheKey = me.id;
  const day = todayKey();

  const cached = CACHE.get(cacheKey);
  if (cached && cached.day === day) {
    return NextResponse.json(cached.payload);
  }

  // Pick the agent's most pressing untouched HOT lead — or if none, the most
  // recently-active lead they own. This becomes the "suggestion".
  const sixHoursAgo = new Date(Date.now() - 6 * 3600_000);
  const hotUntouched = await prisma.lead.findFirst({
    where: {
      ownerId: me.id,
      aiScore: AIScore.HOT,
      currentStatus: { notIn: SUPPRESSED_STATUSES },
      OR: [{ lastTouchedAt: { lt: sixHoursAgo } }, { lastTouchedAt: null }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      whoIsClient: true,
      configuration: true,
      budgetMin: true,
      budgetCurrency: true,
      currentStatus: true,
      whenCanInvest: true,
      lastTouchedAt: true,
    },
  });

  // Lightweight "yesterday" perf signal so the motivator can reference
  // something concrete the agent actually did.
  const yesterdayStart = new Date(Date.now() - 24 * 3600_000);
  const [callsToday, leadsOwned] = await Promise.all([
    prisma.callLog.count({ where: { userId: me.id, startedAt: { gte: yesterdayStart } } }),
    prisma.lead.count({ where: { ownerId: me.id, currentStatus: { notIn: SUPPRESSED_STATUSES } } }),
  ]);

  let payload: Payload;
  if (aiEnabled()) {
    const prompt = `You are a senior sales coach for a Dubai property investment firm.
Give a SHORT pep-talk to one of your agents — 1 sentence, max 22 words, energetic but not cheesy.
Then give a 1-sentence concrete next-best-action for the specific client below.
Reply STRICTLY as JSON: {"motivation":"...","action":"..."}.

Agent: ${me.name.split(" ")[0]}
Active leads they own: ${leadsOwned}
Calls in the last 24h: ${callsToday}

${hotUntouched ? `Hottest untouched lead:
  Name: ${hotUntouched.name}
  Looking for: ${hotUntouched.configuration ?? "—"}
  Budget: ${hotUntouched.budgetCurrency ?? "AED"} ${hotUntouched.budgetMin ?? "—"}
  Timeline: ${hotUntouched.whenCanInvest ?? "—"}
  Status: ${hotUntouched.currentStatus ?? "—"}
  Last touched: ${hotUntouched.lastTouchedAt ? hotUntouched.lastTouchedAt.toISOString().slice(0, 10) : "never"}
  Who is the client (full situation): ${(hotUntouched.whoIsClient ?? "(no narrative)").slice(0, 800)}
` : "Agent has no untouched HOT leads right now."}

Rules for "motivation":
- Address the agent by first name.
- Be specific to today (mention call count, stage, or pipeline size if relevant).
- No clichés like "you can do it" without context.

Rules for "action":
- Must reference the client's name and one specific fact (timeline / budget / config / situation).
- One concrete verb: Call / Message / Send / Visit / Confirm.
- Under 20 words.`;
    const text = await generateText({ prompt, maxTokens: 260 });
    if (text) {
      try {
        const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text);
        const motivation = String(json.motivation ?? "").trim();
        const action = String(json.action ?? "").trim();
        if (motivation) {
          payload = {
            motivation,
            suggestionLeadId: hotUntouched?.id ?? null,
            suggestionLeadName: hotUntouched?.name ?? null,
            suggestionAction: action || null,
            source: "ai",
          };
          CACHE.set(cacheKey, { day, payload });
          return NextResponse.json(payload);
        }
      } catch {
        // fall through to rule-based
      }
    }
  }

  // Rule-based fallback — uses the daily sales quote so the agent still gets
  // something concrete and the card never goes blank on a no-AI day.
  const q = quoteOfTheDay();
  const motivation = `${me.name.split(" ")[0]}, ${callsToday > 0 ? `${callsToday} call${callsToday === 1 ? "" : "s"} already today — keep the momentum.` : "let's start strong today."} ${q.text}`;
  const action = hotUntouched
    ? `Call ${hotUntouched.name} now — HOT lead, ${hotUntouched.whenCanInvest ?? "ready"}, looking for ${hotUntouched.configuration ?? "a unit"}.`
    : null;
  payload = {
    motivation,
    suggestionLeadId: hotUntouched?.id ?? null,
    suggestionLeadName: hotUntouched?.name ?? null,
    suggestionAction: action,
    source: "rule",
  };
  CACHE.set(cacheKey, { day, payload });
  return NextResponse.json(payload);
}
