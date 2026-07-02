"use client";
// Route-group error boundary for src/app/(hr)/ — mirrors the (app) boundary so an HR
// page that throws shows a friendly branded card + retry instead of an unhandled crash.
import { useEffect } from "react";

export default function HRError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[HRError boundary]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] px-4 text-center">
      <div className="card p-8 max-w-md w-full space-y-5">
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
            This HR page ran into a temporary snag. Your data is safe — most
            likely a brief connection issue. Give it another go.
          </p>
        </div>
        {error.digest && (
          <p className="text-[10px] text-gray-400 font-mono">Ref: {error.digest}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={reset} className="btn btn-primary">Try again</button>
          <a href="/hr" className="btn btn-ghost">Back to HR</a>
        </div>
      </div>
    </div>
  );
}
