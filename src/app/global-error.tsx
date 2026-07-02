"use client";
// Root global error boundary — the last line of defense. It renders when the ROOT
// layout itself throws (so app CSS may not be loaded); therefore it ships its own
// <html>/<body> and uses INLINE styles only, with zero dependency on globals.css or
// any component. Keeps a hard crash from ever showing a raw Next.js error page.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[GlobalError boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", background: "#f6f7f9", color: "#0b1a33" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ maxWidth: 420, width: "100%", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 32, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ margin: "0 auto 16px", width: 56, height: 56, borderRadius: "9999px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, background: "rgba(201,162,75,0.12)" }}>🔌</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Something went wrong</h2>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 8, lineHeight: 1.5 }}>
              The app hit an unexpected error. Your data is safe. Please try again — if it keeps happening, refresh the page.
            </p>
            {error.digest && (
              <p style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace", marginTop: 8 }}>Ref: {error.digest}</p>
            )}
            <div style={{ marginTop: 20 }}>
              <button
                onClick={reset}
                style={{ background: "#0b1a33", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
