// Admin Vault viewer — owner (Lalit) decision: ADMIN can review all
// agents' Vault entries. This is intentional and overrides the original
// "private-per-user" design of /vault. Aggregate-only signals still live on
// /admin/team-mood; THIS page shows full entry content for oversight.
//
// Gated by requireRole("ADMIN") — owner asked for admin-only visibility, not
// managers. Filtering (by agent name + kind) is
// done server-side via ?agent= / ?kind= query params so the page stays a single
// server component (no client bundle, robust against hand-crafted URLs).
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { fmtIST12 } from "@/lib/datetime";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// Mirror VaultClient's kind labels/chips + mood emoji so the admin view reads
// the same as what agents see.
const KIND_LABEL: Record<string, string> = {
  JOURNAL:    "Journal",
  VENT:       "Vent",
  WIN:        "Win",
  LESSON:     "Lesson",
  GRATITUDE:  "Gratitude",
  deal_story: "Deal story",
  reset:      "Reset",
};

const KIND_CHIP: Record<string, string> = {
  JOURNAL:    "bg-blue-100 text-blue-800",
  VENT:       "bg-rose-100 text-rose-800",
  WIN:        "bg-emerald-100 text-emerald-800",
  LESSON:     "bg-amber-100 text-amber-800",
  GRATITUDE:  "bg-purple-100 text-purple-800",
  deal_story: "bg-indigo-100 text-indigo-800",
  reset:      "bg-sky-100 text-sky-800",
};

const MOOD_EMOJI: Record<string, string> = {
  GREAT:        "😊",
  OK:           "🙂",
  STRESSED:     "😟",
  OVERWHELMED:  "🥵",
  ANGRY:        "😡",
  SAD:          "😢",
  NEUTRAL:      "😐",
  HESITANT:     "😬",
  COLD:         "🥶",
  CONFUSED:     "😕",
};

// Kinds offered in the filter dropdown (keeps order stable + predictable).
const KIND_OPTIONS = ["JOURNAL", "VENT", "WIN", "LESSON", "GRATITUDE", "deal_story", "reset"];

export default async function AdminVaultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireRole("ADMIN");
  const sp = await searchParams;

  const agentQ = (sp.agent ?? "").trim();
  const kindQ = (sp.kind ?? "").trim();

  const where: Prisma.VaultEntryWhereInput = {};
  if (kindQ && KIND_OPTIONS.includes(kindQ)) {
    where.kind = kindQ;
  }
  if (agentQ) {
    // Filter by agent name via the user relation (case-insensitive contains).
    where.user = { name: { contains: agentQ, mode: "insensitive" } };
  }

  const entries = await prisma.vaultEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      kind: true,
      mood: true,
      content: true,
      tags: true,
      createdAt: true,
      user: { select: { name: true, team: true, role: true } },
    },
  });

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">🔐 Vault entries</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          All team Vault entries (admin view).
        </p>
      </div>

      {/* Filters — plain GET form so state lives in the URL (shareable, robust). */}
      <form method="GET" className="card p-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="agent" className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">
            Agent name
          </label>
          <input
            id="agent"
            name="agent"
            type="text"
            defaultValue={agentQ}
            placeholder="Search by agent name"
            className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm min-w-[200px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="kind" className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">
            Kind
          </label>
          <select
            id="kind"
            name="kind"
            defaultValue={kindQ}
            className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm min-w-[160px]"
          >
            <option value="">All kinds</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn btn-primary text-sm min-h-11">
            Filter
          </button>
          {(agentQ || kindQ) && (
            <a href="/admin/vault" className="btn btn-ghost text-sm min-h-11">
              Clear
            </a>
          )}
        </div>
        <div className="ml-auto text-[11px] text-gray-500 self-center">
          Showing {entries.length}{entries.length === 200 ? "+ (newest 200)" : ""} entr{entries.length === 1 ? "y" : "ies"}
        </div>
      </form>

      {/* Entries table */}
      <div className="card overflow-x-auto">
        {entries.length === 0 ? (
          <div className="p-6 text-sm text-gray-500 text-center">
            {agentQ || kindQ
              ? "No Vault entries match these filters."
              : "No Vault entries yet."}
          </div>
        ) : (
          <table className="tbl min-w-[820px]">
            <thead>
              <tr>
                <th className="text-left">Agent</th>
                <th className="text-left">Kind</th>
                <th className="text-left">Entry</th>
                <th className="text-left whitespace-nowrap">When (IST)</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const tags = (e.tags ?? "")
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean);
                return (
                  <tr key={e.id}>
                    <td className="align-top">
                      <div className="font-semibold text-sm">{e.user?.name ?? "Unknown"}</div>
                      <div className="text-[10px] text-gray-500">
                        {e.user?.team ?? "—"}
                        {e.user?.role && e.user.role !== "AGENT" ? ` · ${e.user.role}` : ""}
                      </div>
                    </td>
                    <td className="align-top">
                      <span className="inline-flex items-center gap-1.5">
                        {e.mood && (
                          <span className="text-base leading-none" title={e.mood}>
                            {MOOD_EMOJI[e.mood] ?? "·"}
                          </span>
                        )}
                        <span className={`chip ${KIND_CHIP[e.kind] ?? "bg-gray-100 text-gray-700"}`}>
                          {KIND_LABEL[e.kind] ?? e.kind}
                        </span>
                      </span>
                    </td>
                    <td className="align-top">
                      <div className="text-sm whitespace-pre-wrap max-w-[640px]">{e.content}</div>
                      {tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {tags.map((t) => (
                            <span key={t} className="pill text-[10px]">#{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="align-top text-[11px] text-gray-500 whitespace-nowrap">
                      {fmtIST12(e.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
