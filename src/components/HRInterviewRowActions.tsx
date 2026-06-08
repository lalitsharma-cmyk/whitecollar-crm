"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function HRInterviewRowActions({ interviewId, candidateId, phone, attendanceStatus }: {
  interviewId: string; candidateId: string; phone: string | null; attendanceStatus: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const closed = attendanceStatus === "ATTENDED" || attendanceStatus === "NO_SHOW" || attendanceStatus === "CANCELLED";

  async function markCompleted() {
    setBusy(true);
    await fetch(`/api/hr/candidates/${candidateId}/interview`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewId, attendanceStatus: "ATTENDED" }),
    });
    setBusy(false); router.refresh();
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {phone && <a href={`tel:${phone}`} title="Call" className="px-1.5 py-1 rounded hover:bg-blue-50 text-blue-600">📞</a>}
      {phone && <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="px-1.5 py-1 rounded hover:bg-green-50 text-green-600">💬</a>}
      {!closed && <button type="button" disabled={busy} onClick={markCompleted} className="text-[11px] px-2 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50">✓ Completed</button>}
      <Link href={`/hr/candidates/${candidateId}?do=interview`} className="text-[11px] px-2 py-1 rounded border border-purple-300 text-purple-700 hover:bg-purple-50">↻ Reschedule</Link>
    </div>
  );
}
