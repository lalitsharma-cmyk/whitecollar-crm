import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ProjectMasterClient from "@/components/ProjectMasterClient";

export const dynamic = "force-dynamic";

// Project Master — the single source of truth the lead auto-classifier routes
// from. Admin-only. Add/activate a project and routing picks it up automatically.
export default async function ProjectMasterPage() {
  const me = await requireUser();
  if (me.role !== "ADMIN") redirect("/dashboard");

  const projects = await prisma.project.findMany({
    select: { id: true, name: true, developer: true, country: true, city: true, active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  const rows = projects.map((p) => ({
    id: p.id,
    name: p.name,
    developer: p.developer ?? "",
    market: (p.country === "India" ? "India" : "Dubai") as "Dubai" | "India",
    city: p.city ?? "",
    active: p.active,
  }));
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Project Master</h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
          The routing source of truth — the lead auto-classifier matches NEW website leads against{" "}
          <span className="font-semibold">{activeCount}</span> active projects here. Add a project and routing
          starts using it automatically (no code change). Deactivate to retire it from routing without deleting.
        </p>
      </div>
      <ProjectMasterClient rows={rows} />
    </>
  );
}
