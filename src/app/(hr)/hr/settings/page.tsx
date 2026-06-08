import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import HRUserManager from "@/components/HRUserManager";

export const dynamic = "force-dynamic";

export default async function HRSettingsPage() {
  const me = await requireUser();
  if (me.role !== "ADMIN") redirect("/hr");

  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, team: true, active: true, hrOnly: true },
  });

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-sm text-gray-500">Manage users &amp; HR access</p>
      </div>

      <HRUserManager initialUsers={users as never} meId={me.id} />

      <div className="card p-4 text-xs text-gray-400">
        Statuses, sources and interview types are currently defined in code. If you want them editable here too, just say so.
      </div>
    </div>
  );
}
