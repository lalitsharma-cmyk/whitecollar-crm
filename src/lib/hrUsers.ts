import { prisma } from "@/lib/prisma";

// "HR users" = dedicated HR staff (hrOnly) + super-admins (ADMIN).
// Sales agents / managers are EXCLUDED. Use this for every owner / interviewer /
// assignment picker in the HR module so Sales CRM users never appear there.
// (To restrict to HR-only staff and drop admins, remove the `{ role: "ADMIN" }` clause.)
export function getHrUsers() {
  return prisma.user.findMany({
    where: { active: true, OR: [{ hrOnly: true }, { role: "ADMIN" }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
