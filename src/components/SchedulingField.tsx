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
    const r = await fetch(`/api/leads/${leadId}/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: payload }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({})) as { error?: string };
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
