import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, leadCount] = await Promise.all([
    requireUser(),
    prisma.lead.count(),
  ]);
  return (
    <div className="flex min-h-screen">
      <Sidebar leadCount={leadCount} user={{ name: user.name, role: user.role, avatarColor: user.avatarColor ?? "bg-slate-500" }} />
      <main className="flex-1 flex flex-col min-w-0">
        <Topbar user={{ name: user.name, avatarColor: user.avatarColor ?? "bg-slate-500" }} />
        <section className="flex-1 p-6 space-y-6">{children}</section>
      </main>
    </div>
  );
}
