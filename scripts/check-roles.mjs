import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  select: { name: true, email: true, role: true },
  orderBy: { createdAt: "asc" },
  take: 20,
});
users.forEach(u => console.log(u.role.padEnd(10), u.email, "-", u.name));
await prisma.$disconnect();
