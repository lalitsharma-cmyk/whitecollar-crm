import { requireUser } from "@/lib/auth";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function ResumeBankPage() {
  await requireUser();
  return (
    <div className="p-6 max-w-3xl mx-auto text-center mt-12">
      <div className="text-5xl mb-4">📁</div>
      <h1 className="text-xl font-bold mb-2">Resume Bank</h1>
      <p className="text-gray-500 text-sm mb-4">Upload and manage candidate resumes. Coming in Phase 2.</p>
      <p className="text-xs text-gray-400">For now, upload resumes directly from each candidate profile.</p>
      <Link href="/hr/candidates" className="mt-4 inline-block text-sm text-blue-600 hover:underline">← Back to Candidates</Link>
    </div>
  );
}
