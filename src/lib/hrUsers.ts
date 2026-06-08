import { prisma } from "@/lib/prisma";

// "HR users" = dedicated HR staff (hrOnly) + admins explicitly on the HR team (hrTeam).
// Sales agents / managers and non-HR admins are EXCLUDED. Used for every owner /
// interviewer / assignment picker in the HR module so Sales CRM users never appear.
// Flag an admin into HR via /hr/settings (HR-team toggle) or scripts/set-hr-access.ts.
export function getHrUsers() {
  return prisma.user.findMany({
    where: { active: true, OR: [{ hrOnly: true }, { hrTeam: true }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
