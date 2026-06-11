import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordFeedback } from "@/lib/ai-openai";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await requireUser();
  const { id: leadId } = await params;

  const body = await req.json() as {
    analysisId: string;
    fieldName: string;
    aiValue: string;
    action: "ACCEPT" | "EDIT" | "REJECT";
    editedValue?: string;
  };

  if (!body.analysisId || !body.fieldName || !body.action) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Verify the analysis belongs to this lead
  const analysis = await prisma.aiAnalysis.findUnique({ where: { id: body.analysisId } });
  if (!analysis || analysis.leadId !== leadId) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  }

  const feedback = await recordFeedback({
    analysisId: body.analysisId,
    leadId,
    fieldName: body.fieldName,
    aiValue: body.aiValue,
    action: body.action,
    editedValue: body.editedValue,
    userId: me.id,
  });

  return NextResponse.json({ feedback });
}
