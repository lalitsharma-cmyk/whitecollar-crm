import { requireUser } from "@/lib/auth";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function HRReportsPage() {
  await requireUser();
  return (
    <div className="p-6 max-w-3xl mx-auto text-center mt-12">
      <div className="text-5xl mb-4">📊</div>
      <h1 className="text-xl font-bold mb-2">HR Reports</h1>
      <p className="text-gray-500 text-sm mb-4">Recruiter performance, pipeline funnel, and hiring metrics. Coming in Phase 2.</p>
      <Link href="/hr" className="mt-4 inline-block text-sm text-blue-600 hover:underline">← Dashboard</Link>
    </div>
  );
}
