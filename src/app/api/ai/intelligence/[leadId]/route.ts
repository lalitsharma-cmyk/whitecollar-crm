// POST /api/ai/intelligence/[leadId]/generate
//
// Admin / Manager only.
// Reads the stored IntelligenceMatch + lead data, calls the AI to generate
// an 8-question sales coach assessment, stores the result back on
// IntelligenceMatch.aiSummary + .aiCheckedAt, and returns the result.
//
// If AI is not enabled, returns { aiSummary: null, suggestedApproach: null, disabled: true }.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { generateTextWithUsage, aiEnabled } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const me = await requireUser();

  // Admin / Manager only
  if (me.role !== "ADMIN" && me.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!aiEnabled()) {
    return NextResponse.json({ aiSummary: null, suggestedApproach: null, disabled: true });
  }

  // Fetch lead data
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      whoIsClient: true,
      remarks: true,
      status: true,
      currentStatus: true,
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Fetch stored intelligence match
  const row = await prisma.intelligenceMatch.findUnique({
    where: { leadId },
  });
  if (!row) {
    return NextResponse.json({ error: "No intelligence record found" }, { status: 404 });
  }

  // Parse history JSON
  let history: Array<{ date: string | null; agent: string | null; text: string; source: string }> = [];
  try {
    history = JSON.parse(row.historyJson ?? "[]");
  } catch {
    history = [];
  }

  const prompt = `You are a senior real estate sales coach reviewing CRM history for a client.
Client: ${lead.name}, Phone: ${lead.phone ?? "unknown"}
Previous history summary: ${JSON.stringify(history, null, 2)}
Project context: ${row.projectNote ?? "No project context available"}

Answer these 8 questions in a concise, structured way:
1. Who is this client?
2. What has happened before?
3. What was the last status?
4. What is the current opportunity?
5. What should the agent say now?
6. What should the agent avoid saying?
7. Should a manager handle this?
8. Is this an investor, repeat buyer, cold lead, or dead lead?

Reply as plain numbered text. Be specific, actionable, and grounded in the actual history. Do not be generic.`;

  const result = await generateTextWithUsage(
    { prompt, maxTokens: 700 },
    { feature: "intelligence", leadId }
  );

  const aiSummary = result.text ?? null;

  // Extract suggested approach from the AI text (question 5)
  let suggestedApproach: string | null = null;
  if (aiSummary) {
    const match = aiSummary.match(/5\.\s*([\s\S]*?)(?=6\.|$)/);
    if (match?.[1]) {
      suggestedApproach = match[1].trim().slice(0, 400);
    }
  }

  // Persist back to IntelligenceMatch
  await prisma.intelligenceMatch.update({
    where: { leadId },
    data: {
      aiSummary: aiSummary ?? undefined,
      suggestedApproach: suggestedApproach ?? undefined,
      aiCheckedAt: new Date(),
    },
  });

  return NextResponse.json({
    aiSummary,
    suggestedApproach,
    disabled: false,
    provider: result.provider,
    state: result.state,
  });
}
