import Link from "next/link";

// Custom 404 — shown for any unmatched route instead of the bare Next.js default.
export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="card p-8 max-w-md w-full space-y-5">
        <div
          className="mx-auto w-14 h-14 rounded-full flex items-center justify-center text-2xl"
          style={{ background: "rgba(201,162,75,0.12)" }}
        >
          🧭
        </div>
        <div>
          <h2 className="text-lg font-bold" style={{ color: "#0b1a33" }}>Page not found</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            This link doesn&apos;t exist or may have moved. Let&apos;s get you back on track.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/dashboard" className="btn btn-primary">Back to Dashboard</Link>
          <Link href="/leads" className="btn btn-ghost">Go to Leads</Link>
        </div>
      </div>
    </div>
  );
}
