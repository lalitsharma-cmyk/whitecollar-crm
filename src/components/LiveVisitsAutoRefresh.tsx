"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the route every N seconds so the LIVE section reflects each agent's
 * latest 60-second GPS push without a full reload (router.refresh() re-runs
 * the server component, which preserves scroll position + form state).
 */
export default function LiveVisitsAutoRefresh({ intervalSec = 30 }: { intervalSec?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalSec * 1000);
    return () => clearInterval(t);
  }, [router, intervalSec]);
  return null;
}
