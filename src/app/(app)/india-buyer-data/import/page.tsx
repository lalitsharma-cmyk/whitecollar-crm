import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import BuyerImportClient from "@/components/BuyerImportClient";

// India Buyer import — ADMIN ONLY (passport + financial data). Same wizard + template as
// Dubai; rows are stamped market="India" (INR/Cr) via the market prop.
export const dynamic = "force-dynamic";

export default async function IndiaBuyerImportPage() {
  const me = await requireUser();
  if (me.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <Link href="/india-buyer-data" className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-slate-200">← India Buyer Data</Link>
        <h1 className="text-xl sm:text-2xl font-bold mt-1">Import India Buyer Data</h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
          Upload an Excel / CSV of India property transactions (₹ INR / Cr). A mapping wizard lets you, per column,
          match it to a known field, keep it as a new field, or skip it — nothing is ever dropped unless you skip it.
          Transaction dates are read from the sheet (Excel serials &amp; dd/mm/yyyy supported). Repeat-buyer rollups are
          computed automatically.
        </p>
      </div>
      <BuyerImportClient market="India" />
    </div>
  );
}
