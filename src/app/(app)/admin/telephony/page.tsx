import { requireRole } from "@/lib/auth";
import TelephonyConsoleClient from "@/components/TelephonyConsoleClient";

// AS Phone / telephony admin console. ADMIN only. Shows which of the 5 credential
// placeholders are set, the exact webhook URL to paste into the provider, the
// agent→extension mapping, the raw inbound event feed, retry-queue health, and
// manual Sync / Drain-queue / Replay controls. Everything is INERT (self-skips)
// until the credentials are pasted into Vercel env.
export const dynamic = "force-dynamic";

export default async function TelephonyAdminPage() {
  await requireRole("ADMIN");
  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">📞 AS Phone — Telephony Console</h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
          Provider-agnostic cloud-telephony integration. Incoming &amp; outgoing calls, click-to-call,
          recordings, and cross-module linking (Lead / Revival / Buyer). Paste the credentials in Vercel
          env and everything below lights up — no code change.
        </p>
      </div>
      <TelephonyConsoleClient />
    </div>
  );
}
