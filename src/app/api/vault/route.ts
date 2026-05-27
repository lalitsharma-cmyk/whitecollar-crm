// Vault — create entry.
// PRIVACY: every write forces userId = current session user. We NEVER trust a
// userId from the request body. Vault entries are PRIVATE per-user; admin role
// has no special read/write access here.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const ALLOWED_KINDS = new Set(["JOURNAL", "VENT", "WIN", "LESSON", "GRATITUDE"]);
const ALLOWED_MOODS = new Set(["GREAT", "OK", "STRESSED", "OVERWHELMED", "ANGRY", "SAD"]);

export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));

  const kindRaw = String(body.kind ?? "").trim().toUpperCase();
  if (!ALLOWED_KINDS.has(kindRaw)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const content = String(body.content ?? "").trim();
  if (!content) {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }
  if (content.length > 10_000) {
    return NextResponse.json({ error: "Content too long" }, { status: 400 });
  }

  let mood: string | null = null;
  if (body.mood != null) {
    const moodRaw = String(body.mood).trim().toUpperCase();
    if (moodRaw) {
      if (!ALLOWED_MOODS.has(moodRaw)) {
        return NextResponse.json({ error: "Invalid mood" }, { status: 400 });
      }
      mood = moodRaw;
    }
  }

  let tags: string | null = null;
  if (body.tags != null) {
    const t = String(body.tags).trim().slice(0, 500);
    if (t) tags = t;
  }

  let expiresAt: Date | null = null;
  if (body.expiresAt) {
    const d = new Date(String(body.expiresAt));
    if (!isNaN(d.getTime())) expiresAt = d;
  }

  const entry = await prisma.vaultEntry.create({
    data: {
      userId: me.id, // ← forced; never read from body
      kind: kindRaw,
      mood,
      content,
      tags,
      expiresAt,
    },
  });

  return NextResponse.json(entry);
}
