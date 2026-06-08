import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiLive, activeModel, costMicroUsd } from "@/lib/ai";

const MAX_BYTES = 5 * 1024 * 1024;
const IMG_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const PROMPT = `You are reading a job candidate's resume. Extract these fields and reply STRICTLY as JSON (no markdown, no prose):
{"name":"","phone":"","email":"","experience":"","currentCompany":"","currentProfile":""}
Rules:
- phone: digits only (if Indian, the 10-digit mobile).
- experience: short total-experience string like "3 years" or "6 months".
- currentProfile: the most recent job title / designation.
- Use an empty string for anything not present. Do not invent data.`;

// AI vision extraction of candidate fields from an uploaded PDF/image resume.
// Gated on the admin AI kill-switch (aiLive); cost is logged to AiUsageLog.
export async function POST(req: NextRequest) {
  await requireUser();
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  if (!(await aiLive())) return NextResponse.json({ error: "AI is currently turned off by the admin." }, { status: 503 });

  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 });

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImg = IMG_TYPES.includes(file.type);
  if (!isPdf && !isImg) {
    return NextResponse.json({ error: "Auto-fill reads PDF or JPG/PNG resumes only — fill the form manually for this file." }, { status: 400 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const model = activeModel() ?? "claude-haiku-4-5";
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const filePart: Anthropic.ContentBlockParam = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 } };

  const started = Date.now();
  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model,
      max_tokens: 500,
      messages: [{ role: "user", content: [filePart, { type: "text", text: PROMPT }] }],
    });
  } catch (e) {
    console.error("resume extract failed", e);
    return NextResponse.json({ error: "Could not read the resume — please fill the form manually." }, { status: 502 });
  }

  const text = msg.content.map(b => (b.type === "text" ? b.text : "")).join("");
  const inTok = msg.usage?.input_tokens ?? 0, outTok = msg.usage?.output_tokens ?? 0;
  try {
    await prisma.aiUsageLog.create({
      data: {
        provider: "anthropic", model, feature: "resume_extract",
        inputTokens: inTok, outputTokens: outTok, costMicroUsd: costMicroUsd(model, inTok, outTok),
        ms: Date.now() - started, ok: true,
      },
    });
  } catch { /* logging is best-effort */ }

  let fields: Record<string, string> = {};
  try { fields = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text); } catch { /* leave empty */ }

  return NextResponse.json({
    fields: {
      name: String(fields.name ?? ""),
      phone: String(fields.phone ?? ""),
      email: String(fields.email ?? ""),
      experience: String(fields.experience ?? ""),
      currentCompany: String(fields.currentCompany ?? ""),
      currentProfile: String(fields.currentProfile ?? ""),
    },
  });
}
