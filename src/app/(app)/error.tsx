"use client";
// Route-group error boundary for src/app/(app)/
// Next.js requires error boundaries to be Client Components.
// Props: error (the thrown Error), reset (retry callback).
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface in the browser console so support can grab it from devtools.
    // The digest can be cross-referenced in Vercel / server logs.
    // eslint-disable-next-line no-console
    console.error("[AppError boundary]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] px-4 text-center">
      <div className="card p-8 max-w-md w-full space-y-5">
        {/* Gold accent icon */}
        <div
          className="mx-auto w-14 h-14 rounded-full flex items-center justify-center text-2xl"
          style={{ background: "rgba(201,162,75,0.12)" }}
        >
          🔌
        </div>

        <div>
          <h2 className="text-lg font-bold" style={{ color: "#0b1a33" }}>
            Something hiccuped
          </h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            The page ran into a temporary snag. Your data is safe — this is
            most likely a brief connection issue. Give it another go and it
            should load right up.
          </p>
        </div>

        {error.digest && (
          <p className="text-[10px] text-gray-400 font-mono">
            Ref: {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="btn btn-primary"
          >
            Try again
          </button>
          <a href="/dashboard" className="btn btn-ghost">
            Back to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
