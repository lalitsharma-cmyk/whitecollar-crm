import MobileShell from "@/components/MobileShell";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <MobileShell user={{ name: user.name, role: user.role, avatarColor: user.avatarColor ?? "bg-slate-500" }}>
      {children}
    </MobileShell>
  );
}
