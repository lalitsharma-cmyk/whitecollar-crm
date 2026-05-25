// Save/clear the logged-in user's own avatar photo. dataURL stored in User.photoUrl.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const MAX = 700_000; // ~700KB hard cap on the dataURL

export async function PATCH(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  const raw = body.photoUrl;
  const value: string | null = raw == null || raw === "" ? null : String(raw);
  if (value) {
    if (!/^data:image\/(jpe?g|png|webp);base64,/i.test(value)) {
      return NextResponse.json({ error: "Photo must be a base64 image dataURL" }, { status: 400 });
    }
    if (value.length > MAX) {
      return NextResponse.json({ error: "Photo too large (max ~500KB)" }, { status: 413 });
    }
  }
  await prisma.user.update({ where: { id: me.id }, data: { photoUrl: value } });
  return NextResponse.json({ ok: true });
}
