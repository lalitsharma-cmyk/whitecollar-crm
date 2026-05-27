// Per-user notification preferences. The body is a JSON-stringified
// `{ kind: boolean }` map (plus a "sound" key for in-app sound effects).
// Validation keeps the column tiny + safe: plain object, ≤30 keys, all values
// must be booleans. Filtering at send-time is wired up later — this route only
// persists the user's choices.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function PATCH(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  const prefs = body?.prefs;

  if (
    !prefs ||
    typeof prefs !== "object" ||
    Array.isArray(prefs) ||
    Object.getPrototypeOf(prefs) !== Object.prototype
  ) {
    return NextResponse.json({ error: "prefs must be a plain object" }, { status: 400 });
  }

  const keys = Object.keys(prefs);
  if (keys.length > 30) {
    return NextResponse.json({ error: "Too many preference keys (max 30)" }, { status: 400 });
  }
  for (const k of keys) {
    if (typeof (prefs as Record<string, unknown>)[k] !== "boolean") {
      return NextResponse.json({ error: `Value for "${k}" must be a boolean` }, { status: 400 });
    }
  }

  await prisma.user.update({
    where: { id: me.id },
    data: { notifPrefs: JSON.stringify(prefs) },
  });

  return NextResponse.json({ ok: true });
}
