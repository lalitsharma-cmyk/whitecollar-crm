"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  leadId: string;
}

export default function ReactivateButton({ leadId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleReactivate() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/reactivate`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        alert(body.error ?? "Failed to reactivate lead");
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleReactivate}
      disabled={loading}
      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {loading ? "…" : "Reactivate →"}
    </button>
  );
}
