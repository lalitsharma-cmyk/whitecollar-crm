// Agent self-marks attendance for today. Used when auto-mark on login didn't
// fire (rare — e.g. agent stayed logged in from yesterday).
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { autoMarkAttendanceOnLogin } from "@/lib/attendance";

export async function POST() {
  const me = await requireUser();
  await autoMarkAttendanceOnLogin(me.id);
  return NextResponse.json({ ok: true });
}
