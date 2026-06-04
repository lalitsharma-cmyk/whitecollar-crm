"use client";
import { useEffect } from "react";

export default function LeadDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console so devs can see the real error — never shown in UI.
    // eslint-disable-next-line no-console
    console.error("Lead detail error:", error);
  }, [error]);

  return (
    <div className="card p-6 m-4 border-l-4 border-red-500 bg-red-50">
      <div className="font-bold text-red-900 text-lg mb-2">⚠ Something went wrong</div>
      <p className="text-sm text-red-800 mb-3">
        This lead couldn&apos;t be loaded. Try refreshing, or go back to your leads list.
        {error.digest && (
          <span className="ml-1 text-red-600 font-mono text-xs">(ref: {error.digest})</span>
        )}
      </p>
      <div className="flex gap-2">
        <button onClick={reset} className="btn btn-primary text-sm">Retry</button>
        <a href="/leads" className="btn btn-ghost text-sm">← Back to leads</a>
      </div>
    </div>
  );
}
