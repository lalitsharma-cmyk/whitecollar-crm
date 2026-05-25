"use client";
import { useRouter } from "next/navigation";

interface Props { users: { id: string; name: string }[]; current: string | null; }

export default function AuditUserFilter({ users, current }: Props) {
  const router = useRouter();
  return (
    <select
      value={current ?? ""}
      onChange={(e) => router.push(e.target.value ? `/admin/audit?userId=${e.target.value}` : "/admin/audit")}
      className="text-xs border border-[#e5e7eb] rounded px-2 py-1 ml-auto"
    >
      <option value="">Filter by user…</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
  );
}
