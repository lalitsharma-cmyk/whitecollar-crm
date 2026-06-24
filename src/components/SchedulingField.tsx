"use client";
import { useRouter } from "next/navigation";
import CRMDatePicker from "./CRMDatePicker";
import { isPastISTLocalInput } from "@/lib/datetime";

interface Props {
  leadId: string;
  field: string;
  title: string;       // modal header: "Set Follow-up"
  label: string;       // tile label: "🔁 Follow-up"
  value: string;       // "YYYY-MM-DDTHH:mm" or ""
  placeholder?: string;
  variant?: "primary" | "default";
}

export default function SchedulingField({
  leadId, field, title, label, value, placeholder = "Not scheduled", variant = "default",
}: Props) {
  const router = useRouter();

  async function handleConfirm(v: string) {
    if (v && isPastISTLocalInput(v)) {
      throw new Error("Pick a future date/time (IST).");
    }
    const payload = v ? `${v}:00+05:30` : null;
    const post = (rescheduleReason?: string) => fetch(`/api/leads/${leadId}/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: payload, ...(rescheduleReason ? { rescheduleReason } : {}) }),
    });
    let r = await post();
    let j = await r.json().catch(() => ({})) as { error?: string; rescheduleReasonRequired?: boolean };
    // Follow-up-date-change protection (agents): the server requires a reason when
    // there's no contact activity today. Prompt for it + retry. Only the
    // followupDate field is gated server-side; other scheduling fields pass through.
    if (!r.ok && j.rescheduleReasonRequired) {
      const reason = (typeof window !== "undefined"
        ? window.prompt("Please log an activity, or give a reason for changing the follow-up date:")
        : "")?.trim();
      if (!reason) throw new Error("A reason is required to change the follow-up date without logging an activity.");
      r = await post(reason);
      j = await r.json().catch(() => ({})) as { error?: string };
    }
    if (!r.ok) {
      throw new Error(j.error ?? "Save failed");
    }
    router.refresh();
  }

  return (
    <CRMDatePicker
      value={value}
      onConfirm={handleConfirm}
      withTime
      futureOnly
      label={label}
      title={title}
      placeholder={placeholder}
      triggerStyle="tile"
      tileVariant={variant}
    />
  );
}
