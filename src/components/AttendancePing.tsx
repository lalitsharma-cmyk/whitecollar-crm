"use client";
import { useEffect } from "react";

export default function AttendancePing() {
  useEffect(() => {
    // Fire-and-forget — mark attendance if not already marked today.
    // The endpoint is idempotent and fast (Prisma findUnique then early-return).
    fetch("/api/attendance/mark", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
