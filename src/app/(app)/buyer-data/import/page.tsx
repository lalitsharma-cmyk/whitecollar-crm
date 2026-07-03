import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import BuyerImportClient from "@/components/BuyerImportClient";
import { canImportData } from "@/lib/exportPerms";

// Buyer import — OWNER ONLY (Super Admin): passport + financial data.
export const dynamic = "force-dynamic";

export default async function BuyerImportPage() {
  const me = await requireUser();
  if (!canImportData(me)) redirect("/dashboard");

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <Link href="/buyer-data" className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-slate-200">← Dubai Buyer Data</Link>
        <h1 className="text-xl sm:text-2xl font-bold mt-1">Import Dubai Buyer Data</h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
          Upload an Excel / CSV of Dubai property transactions. A mapping wizard lets you, per column,
          match it to a known field, keep it as a new field, or skip it — nothing is ever dropped
          unless you skip it. Transaction dates are read from the sheet (Excel serials &amp;
          dd/mm/yyyy supported). Repeat-buyer rollups are computed automatically.
        </p>
      </div>
      <BuyerImportClient />
    </div>
  );
}
