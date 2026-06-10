import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtIST12 } from "@/lib/datetime";
import DeletedLeadsClient, { type DeletedRow } from "@/components/DeletedLeadsClient";

export const dynamic = "force-dynamic";

export default async function DeletedLeadsPage() {
  const me = await requireUser();
  // Super-Admin (Lalit) only — the only account that can delete / restore leads.
  if (!me.isSuperAdmin) redirect("/leads");

  const leads = await prisma.lead.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    take: 300,
    select: { id: true, name: true, phone: true, currentStatus: true, forwardedTeam: true, deletedAt: true, deletedById: true },
  });
  const deleterIds = [...new Set(leads.map(l => l.deletedById).filter(Boolean) as string[])];
  const deleters = deleterIds.length
    ? await prisma.user.findMany({ where: { id: { in: deleterIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(deleters.map(d => [d.id, d.name]));

  const rows: DeletedRow[] = leads.map(l => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    status: l.currentStatus,
    team: l.forwardedTeam,
    deletedAt: l.deletedAt ? fmtIST12(l.deletedAt) : "—",
    deletedBy: l.deletedById ? (nameById.get(l.deletedById) ?? "—") : "—",
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/leads" className="hover:underline">Leads</Link>
            <span>/</span>
            <span className="text-gray-700 dark:text-slate-200 font-medium">Deleted (Archive)</span>
          </div>
          <h1 className="text-2xl font-bold mt-1">Deleted Leads — Super Admin Archive</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 max-w-2xl">
            Leads removed from the active CRM. <b>Nothing is destroyed</b> — each delete is kept here with
            who deleted it, when, and a full snapshot, and can be <b>Restored</b>. Super Admin only.
          </p>
        </div>
        <Link href="/leads" className="btn btn-ghost whitespace-nowrap">← Back to Leads</Link>
      </div>
      <DeletedLeadsClient rows={rows} />
    </div>
  );
}
