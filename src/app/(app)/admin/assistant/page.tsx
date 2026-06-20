import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AdminAssistantClient from "@/components/AdminAssistantClient";
import { Bot } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminAssistantPage() {
  const me = await requireRole("ADMIN");

  const recent = await prisma.assistantRun.findMany({
    where: { createdById: me.id, status: { in: ["EXECUTED", "UNDONE", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, command: true, intent: true, status: true, affectedCount: true, newValue: true, createdAt: true },
  });

  // For ASSIGN runs, newValue is a user id — resolve to a name for display.
  const ownerIds = recent.filter((r) => r.intent === "ASSIGN" && r.newValue).map((r) => r.newValue!) as string[];
  const owners = ownerIds.length ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
  const ownerName = new Map(owners.map((u) => [u.id, u.name]));

  const recentRuns = recent.map((r) => ({
    id: r.id,
    command: r.command,
    intent: r.intent,
    status: r.status,
    affectedCount: r.affectedCount,
    newValue: r.intent === "ASSIGN" && r.newValue ? (ownerName.get(r.newValue) ?? null) : r.newValue,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-[#c9a24b] dark:bg-[#c9a24b] dark:text-slate-900">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-serif text-xl font-semibold text-slate-900 dark:text-slate-100">AI Assistant</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">Run bulk CRM operations in plain English — preview, approve, undo.</p>
        </div>
      </div>
      <AdminAssistantClient recentRuns={recentRuns} />
    </div>
  );
}
