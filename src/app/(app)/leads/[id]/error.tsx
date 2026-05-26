"use client";
// TEMPORARY DIAGNOSTIC — added 2026-05-26 to surface the actual error on a
// specific lead's detail page that's silently 500-ing in production. Without
// this, Next.js renders the generic Vercel "A server error occurred" page
// and the real exception is invisible to the agent.
//
// Once we identify + fix the root cause, this file should either be:
//   (a) deleted (so we go back to the generic 500), or
//   (b) toned down to hide the stack from non-admins.
import { useEffect } from "react";

export default function LeadDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Lead detail error boundary caught:", error);
  }, [error]);

  return (
    <div className="card p-6 m-4 border-l-4 border-red-500 bg-red-50">
      <div className="font-bold text-red-900 text-lg mb-2">⚠ Lead detail page crashed</div>
      <p className="text-sm text-red-800 mb-3">
        Showing diagnostic detail so we can find the root cause. Once fixed,
        this error page goes away.
      </p>
      <div className="text-xs font-mono bg-white border border-red-200 rounded p-3 whitespace-pre-wrap break-all">
        <div className="mb-2"><b>Message:</b> {error.message}</div>
        {error.digest && <div className="mb-2"><b>Digest:</b> {error.digest}</div>}
        {error.stack && (
          <details>
            <summary className="cursor-pointer text-red-700">Stack trace ↓</summary>
            <pre className="text-[10px] mt-2 overflow-x-auto">{error.stack}</pre>
          </details>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={reset} className="btn btn-primary text-sm">Retry</button>
        <a href="/leads" className="btn btn-ghost text-sm">← Back to leads</a>
      </div>
    </div>
  );
}
