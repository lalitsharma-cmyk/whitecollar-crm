// Attendance helpers — drive round-robin (only present agents get new leads).
//
// Office hours: 10am–7pm IST. Rules:
//   logged in by 10:30am IST    → PRESENT
//   logged in 10:30am–7pm IST   → LATE   (still eligible for round-robin)
//   never logged in by 7pm      → ABSENT
//   admin marks                 → ON_LEAVE (planned)

import { prisma } from "@/lib/prisma";
import { AttendanceStatus } from "@prisma/client";

const IST_OFFSET_MIN = 330; // +05:30

/** Returns "today in IST" truncated to 00:00 IST, expressed as UTC Date. */
export function todayIST(): Date {
  const now = new Date();
  const istMs = now.getTime() + IST_OFFSET_MIN * 60_000;
  const istDay = new Date(istMs);
  istDay.setUTCHours(0, 0, 0, 0);
  return new Date(istDay.getTime() - IST_OFFSET_MIN * 60_000);
}

/** Hour of day in IST, 0-23 (24-hour clock). */
export function hourIST(d: Date = new Date()): number {
  const istMs = d.getTime() + IST_OFFSET_MIN * 60_000;
  return new Date(istMs).getUTCHours();
}

/** Minute of day in IST, 0-59. */
export function minIST(d: Date = new Date()): number {
  const istMs = d.getTime() + IST_OFFSET_MIN * 60_000;
  return new Date(istMs).getUTCMinutes();
}

/**
 * Called from /api/login on successful auth. Marks the user as PRESENT or LATE
 * depending on what time they logged in. Idempotent: no-op if already marked
 * for today.
 */
export async function autoMarkAttendanceOnLogin(userId: string): Promise<void> {
  const day = todayIST();
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: day } },
  });
  if (existing) return; // already marked — don't overwrite (admin may have set ON_LEAVE etc.)

  const h = hourIST();
  const m = minIST();
  const minutesSinceMidnight = h * 60 + m;
  const cutoffPresentMin = 10 * 60 + 30;  // 10:30am IST
  const cutoffLateMin    = 19 * 60;        // 7:00pm IST

  let status: AttendanceStatus;
  if (minutesSinceMidnight <= cutoffPresentMin) status = AttendanceStatus.PRESENT;
  else if (minutesSinceMidnight <= cutoffLateMin) status = AttendanceStatus.LATE;
  else status = AttendanceStatus.PRESENT; // logged in after-hours — still mark them as having shown up today

  await prisma.attendance.create({
    data: { userId, date: day, status, markedBy: null },
  });
}

/** Returns userIds of agents present (or late) today, optionally filtered by team. */
export async function presentAgentIdsToday(team?: string | null): Promise<string[]> {
  const day = todayIST();
  // Two-step: pull present attendance rows, then filter by team via User table.
  // (Attendance has no Prisma relation declared to User, hence the manual join.)
  const rows = await prisma.attendance.findMany({
    where: {
      date: day,
      status: { in: [AttendanceStatus.PRESENT, AttendanceStatus.LATE] },
    },
    select: { userId: true },
  });
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => r.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, active: true, ...(team ? { team } : {}) },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Is this user present today? */
export async function isPresentToday(userId: string): Promise<boolean> {
  const day = todayIST();
  const r = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: day } },
    select: { status: true },
  });
  return r?.status === AttendanceStatus.PRESENT || r?.status === AttendanceStatus.LATE;
}
