import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { generateText, aiEnabled } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";

/**
 * GET /api/ai/morning-message
 *
 * Lalit's brief (verbatim):
 *   "Each day in morning , A recorded voice should be there by Agent which
 *    should be like his manager who is motivating him."
 *
 * Returns a short (2-3 sentence) motivational message written in the voice
 * of a Dubai-property-investment sales manager. The dashboard card plays it
 * via the browser's `window.speechSynthesis` API (Web Speech) — no
 * server-side TTS, no extra dependency.
 *
 * Cached per-agent per-day so a reload doesn't regenerate the same text
 * (and so the agent hears the SAME line if they replay during the day,
 * which feels intentional rather than random).
 */

interface Cached { day: string; message: string; source: "ai" | "rule"; }

// Module-level cache. Cold-start regenerates which is fine.
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
    return NextResponse.json({ message: cached.message, source: cached.source });
  }

  // Tiny perf signal so the manager voice references something real, not
  // generic "have a great day" filler.
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const [pipelineCount, hotCount, newOvernight] = await Promise.all([
    prisma.lead.count({ where: { ownerId: me.id, currentStatus: { notIn: SUPPRESSED_STATUSES } } }),
    prisma.lead.count({ where: { ownerId: me.id, aiScore: "HOT", currentStatus: { notIn: SUPPRESSED_STATUSES } } }),
    prisma.lead.count({ where: { ownerId: me.id, createdAt: { gte: since24h } } }),
  ]);

  let message: string;
  let source: "ai" | "rule" = "rule";

  if (aiEnabled()) {
    const prompt = `You are Lalit, the sales manager at White Collar Realty (Dubai property investment).
You greet your agent every morning with a SHORT spoken pep-talk — this text will be read aloud by a text-to-speech voice, so write it like you're speaking, not writing an email.

Rules:
- Address the agent by first name.
- 2-3 sentences. Under 55 words total.
- Reference today's reality (their pipeline / hot count / new leads if non-zero).
- Confident but warm. No emojis (they don't read aloud well). No exclamation overload.
- Indian-English cadence is fine — this is a Dubai+India team.
- End with one specific instruction for today, not a generic "go get them".

Agent: ${me.name.split(" ")[0]}
Active pipeline: ${pipelineCount} leads
HOT leads on plate: ${hotCount}
New leads since yesterday: ${newOvernight}
Date: ${day}

Reply with the spoken message text only — no quotes, no JSON, just the words.`;
    const text = await generateText({ prompt, maxTokens: 180 });
    if (text && text.trim()) {
      message = text.trim().replace(/^["']|["']$/g, "");
      source = "ai";
      CACHE.set(cacheKey, { day, message, source });
      return NextResponse.json({ message, source });
    }
  }

  // Rule-based fallback — still in a manager voice, woven around real numbers.
  const first = me.name.split(" ")[0];
  const open = `Good morning ${first}. `;
  const middle =
    hotCount > 0
      ? `You have ${hotCount} hot lead${hotCount === 1 ? "" : "s"} on your plate today — those are the closest to closing, so they get your morning. `
      : pipelineCount > 0
        ? `Your pipeline is sitting at ${pipelineCount} live leads. Pick the three most ready and push them today. `
        : `Today is a build day. Focus on quality conversations, not numbers. `;
  const closer = newOvernight > 0
    ? `And there ${newOvernight === 1 ? "is" : "are"} ${newOvernight} new lead${newOvernight === 1 ? "" : "s"} waiting from overnight — call them within the hour, that's how we win.`
    : `Make the first call before you do anything else. That sets the rhythm for the day.`;
  message = `${open}${middle}${closer}`;
  CACHE.set(cacheKey, { day, message, source });
  return NextResponse.json({ message, source });
}
