import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { format } from "date-fns";
import Link from "next/link";
import { formatBudget } from "@/lib/budgetParse";

export const dynamic = "force-dynamic";

/** Mask phone: show first 4 + last 2 digits, hide the rest. */
function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  const prefix = phone.slice(0, 4);
  const suffix = phone.slice(-2);
  const masked = "*".repeat(Math.max(0, phone.length - 6));
  return `${prefix}${masked}${suffix}`;
}

export default async function CustomersPage() {
  const me = await requireUser();

  // Scope: agents see only their own, admin/manager see all.
  const scope = me.role === "AGENT" ? { ownerId: me.id } : {};

  const customers = await prisma.lead.findMany({
    where: {
      ...scope,
      leadOrigin: "ACTIVE",
      status: { in: ["WON", "BOOKING_DONE"] },
    },
    orderBy: { lastTouchedAt: "desc" },
    include: {
      owner: { select: { name: true } },
      discussed: { take: 3, select: { project: { select: { name: true } } } },
    },
  });

  const count = customers.length;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            Customers
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-sm font-bold bg-emerald-100 text-emerald-800">
              {count}
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Won deals and completed bookings — active leads only
          </p>
        </div>
      </div>

      {count === 0 ? (
        <div className="card p-8 text-center text-gray-500 text-sm">
          No customers yet. Customers appear here when a lead status is set to WON or BOOKING_DONE.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e5e7eb] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#f5f6fa] text-xs uppercase tracking-wide text-gray-500 border-b border-[#e5e7eb]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Name</th>
                <th className="px-4 py-3 text-left font-semibold">Phone</th>
                <th className="px-4 py-3 text-left font-semibold">Budget</th>
                <th className="px-4 py-3 text-left font-semibold">Projects Discussed</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Last Touch</th>
                <th className="px-4 py-3 text-left font-semibold">Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e7eb]">
              {customers.map((c) => {
                const projectNames = c.discussed.map((d) => d.project.name);
                const budgetStr = formatBudget(c.budgetMin, c.budgetCurrency) !== "—"
                  ? `${c.budgetCurrency} ${formatBudget(c.budgetMin, c.budgetCurrency)}`
                  : "—";
                return (
                  <tr key={c.id} className="hover:bg-[#f9fafb] transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/leads/${c.id}`} className="text-[#0b1a33] hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                      {maskPhone(c.phone)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{budgetStr}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {projectNames.length > 0 ? projectNames.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`chip ${c.status === "WON" ? "chip-won" : "chip-won"} text-xs`}>
                        {c.status === "BOOKING_DONE" ? "Booking Done" : "Won"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {c.lastTouchedAt ? format(c.lastTouchedAt, "dd MMM yyyy") : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.owner?.name ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
