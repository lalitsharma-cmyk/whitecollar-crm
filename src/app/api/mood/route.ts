// Daily end-of-day mood check-in. Idempotent per (user, date) — second submit
// the same day updates the existing row.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { Mood } from "@prisma/client";

export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  const moodRaw = String(body.mood ?? "");
  if (!(Object.values(Mood) as string[]).includes(moodRaw)) {
    return NextResponse.json({ error: "Invalid mood" }, { status: 400 });
  }
  const mood = moodRaw as Mood;
  const comment = String(body.comment ?? "").trim().slice(0, 500) || null;

  // Truncate to start-of-day so the unique key matches regardless of submit time
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.dailyMood.upsert({
    where: { userId_date: { userId: me.id, date: today } },
    create: { userId: me.id, date: today, mood, comment },
    update: { mood, comment },
  });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const me = await requireUser();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const row = await prisma.dailyMood.findUnique({
    where: { userId_date: { userId: me.id, date: today } },
  });
  return NextResponse.json({ mood: row?.mood ?? null, comment: row?.comment ?? null });
}
