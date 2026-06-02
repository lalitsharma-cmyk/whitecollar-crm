import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

/**
 * POST /api/transcribe?leadId=…
 *
 * Receives an audio blob (audio/webm preferred, captured by
 * VoiceNoteRecorder via MediaRecorder) and returns the transcribed text.
 *
 * Lalit's brief: "There should be a voice recording feature, and it should
 * auto write whatever agents says."
 *
 * Implementation note — IMPORTANT:
 *   Anthropic's Messages API does NOT support audio input as of the SDK
 *   version pinned in package.json (no `input_audio` content block, no
 *   Whisper-style transcription endpoint on Claude). Both option (a) tried
 *   in spec and a base64 audio block fail with "unsupported content type".
 *
 *   So this route ships option (b) from the brief: graceful degradation.
 *   Returns 200 with an empty transcript + a friendly `note` field that the
 *   client renders above the editable textarea. Agent can type the note;
 *   workflow doesn't break.
 *
 *   When Anthropic ships audio input (or when an explicit transcription key
 *   like OPENAI_API_KEY is set), wire the real STT in here behind an
 *   environment flag and the UI keeps working unchanged.
 *
 * Always audit-logged so we have a paper trail of every transcription
 * attempt (size + leadId + agent), and so future cost-accounting is easy.
 */
export async function POST(req: NextRequest) {
  const me = await requireUser();
  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId") ?? null;

  // Read the raw bytes — we don't actually upload them anywhere right now,
  // but we measure the size so audit log captures usage, and so we can fail
  // fast on absurdly large payloads (>10 MB is almost certainly a misuse).
  const buf = await req.arrayBuffer().catch(() => new ArrayBuffer(0));
  const bytes = buf.byteLength;

  if (bytes > 10 * 1024 * 1024) {
    return NextResponse.json(
      {
        transcript: "",
        note: "Recording too long (over 10 MB). Try a shorter clip — or type the note manually.",
      },
      { status: 413 },
    );
  }

  // Try Claude / Gemini? Both providers in /lib/ai.ts are text-only today.
  // If an explicit STT provider key is added later, branch here.
  const sttConfigured = false; // future flag — e.g. process.env.OPENAI_API_KEY

  let transcript = "";
  let note: string | null = null;

  if (!sttConfigured) {
    note =
      "Voice transcription isn't configured yet on the server. " +
      "Type the note in the box below and tap Save — your recording isn't lost from the workflow.";
  } else {
    // Reserved for when an STT provider lands. Today this path is unreachable.
    transcript = "";
    note = "Transcription returned empty — type what you said and save.";
  }

  // Best-effort audit. Never block the response on this.
  await audit({
    userId: me.id,
    action: "voice_transcribe",
    entity: "Lead",
    entityId: leadId,
    meta: {
      audioBytes: bytes,
      mimeHint: req.headers.get("content-type") ?? null,
      sttConfigured,
    },
    request: reqMeta(req),
  });

  return NextResponse.json({ transcript, note });
}
