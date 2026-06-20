import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// Per-user notification sound + volume. Saved on the User row so the choice
// follows the agent across devices; the client mirrors it into localStorage so
// the in-app AudioContext can fire instantly.
const SOUNDS = new Set(["bell", "alert", "chime", "success", "siren", "premium"]);
const VOLUMES = new Set(["low", "medium", "high", "maximum"]);
const DEFAULT_SOUND = "premium";
const DEFAULT_VOLUME = "high";

export async function GET() {
  const me = await requireUser();
  const u = await prisma.user.findUnique({ where: { id: me.id }, select: { notifSound: true, notifVolume: true } });
  return NextResponse.json({
    sound: u?.notifSound && SOUNDS.has(u.notifSound) ? u.notifSound : DEFAULT_SOUND,
    volume: u?.notifVolume && VOLUMES.has(u.notifVolume) ? u.notifVolume : DEFAULT_VOLUME,
  });
}

export async function PATCH(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  const data: { notifSound?: string; notifVolume?: string } = {};
  if (typeof body.sound === "string") {
    if (!SOUNDS.has(body.sound)) return NextResponse.json({ error: "Invalid sound" }, { status: 400 });
    data.notifSound = body.sound;
  }
  if (typeof body.volume === "string") {
    if (!VOLUMES.has(body.volume)) return NextResponse.json({ error: "Invalid volume" }, { status: 400 });
    data.notifVolume = body.volume;
  }
  if (!data.notifSound && !data.notifVolume) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  await prisma.user.update({ where: { id: me.id }, data });
  return NextResponse.json({ ok: true });
}
