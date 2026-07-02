import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { fmtIST12 } from "@/lib/datetime";
import Link from "next/link";
import DuplicatesMergeClient from "@/components/DuplicatesMergeClient";
import { formatLeadName } from "@/lib/leadName";

export const dynamic = "force-dynamic";

// Normalize a phone number to its last 10 digits — handles "+91 91464 49146",
// "(044) 91464-49146" and similar formatting differences that would otherwise
// make exact-equality grouping miss obvious duplicates.
function phoneKey(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  return digits.slice(-10);
}

interface LeadRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  source: string;
  createdAt: Date;
  lastTouchedAt: Date | null;
  ownerName: string | null;
}

interface DupGroup {
  kind: "phone" | "email";
  key: string;
  leads: LeadRow[];
}

export default async function DuplicatesPage() {
  await requireRole("ADMIN");

  // ── Step 1: surface candidate groups via cheap SQL aggregates ─────────
  // For phone we group by the last 10 digits of the digit-only string,
  // for email we lowercase + trim before grouping. COUNT > 1 only.
  const phoneRowsRaw = await prisma.$queryRaw<{ key: string; n: bigint }[]>`
    SELECT RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g'), 10) AS key,
           COUNT(*) AS n
    FROM "Lead"
    WHERE phone IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(phone, '\D', '', 'g')) >= 10
    GROUP BY key
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 50
  `;

  const emailRowsRaw = await prisma.$queryRaw<{ key: string; n: bigint }[]>`
    SELECT LOWER(TRIM(email)) AS key,
           COUNT(*) AS n
    FROM "Lead"
    WHERE email IS NOT NULL AND TRIM(email) <> ''
    GROUP BY key
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 50
  `;

  // ── Step 2: for each group key, fetch the actual leads + owner ─────────
  // We fetch only what we need to render the cards (status, source, dates).
  const phoneKeys = phoneRowsRaw.map((r) => r.key).filter((k) => k && k.length === 10);
  const emailKeys = emailRowsRaw.map((r) => r.key).filter(Boolean);

  // Fetch candidate leads in two broad queries, then group in JS — this is
  // cheaper than 100 individual queries and easier to reason about.
  const phoneCandidates = phoneKeys.length
    ? await prisma.lead.findMany({
        where: { phone: { not: null } },
        select: {
          id: true, name: true, phone: true, email: true,
          status: true, source: true, createdAt: true, lastTouchedAt: true,
          owner: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const emailCandidates = emailKeys.length
    ? await prisma.lead.findMany({
        where: {
          email: { not: null },
          // Postgres-side filter: any lead whose lowercased email matches one
          // of our duplicate keys. We use `in` after lowercasing client-side.
        },
        select: {
          id: true, name: true, phone: true, email: true,
          status: true, source: true, createdAt: true, lastTouchedAt: true,
          owner: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const groups: DupGroup[] = [];

  // Phone groups
  for (const { key } of phoneRowsRaw) {
    if (!key || key.length !== 10) continue;
    const members = phoneCandidates
      .filter((l) => l.phone && phoneKey(l.phone) === key)
      .map<LeadRow>((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        email: l.email,
        status: l.status as unknown as string,
        source: l.source as unknown as string,
        createdAt: l.createdAt,
        lastTouchedAt: l.lastTouchedAt,
        ownerName: l.owner?.name ?? null,
      }));
    if (members.length > 1) groups.push({ kind: "phone", key, leads: members });
  }

  // Email groups
  for (const { key } of emailRowsRaw) {
    if (!key) continue;
    const members = emailCandidates
      .filter((l) => (l.email ?? "").trim().toLowerCase() === key)
      .map<LeadRow>((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        email: l.email,
        status: l.status as unknown as string,
        source: l.source as unknown as string,
        createdAt: l.createdAt,
        lastTouchedAt: l.lastTouchedAt,
        ownerName: l.owner?.name ?? null,
      }));
    if (members.length > 1) groups.push({ kind: "email", key, leads: members });
  }

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">🔁 Duplicate Detector</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Finds leads with the same phone (last 10 digits) or email (case-insensitive).
          Showing top {groups.length} groups. Pick one row as the <b>master</b> and merge the others into it.
          All activities, calls, notes, assignments, and project/unit interest move into the master.
        </p>
      </div>

      {groups.length === 0 && (
        <div className="card p-5 text-center text-gray-500 text-sm">
          No duplicates detected. Nice — the DB is clean.
        </div>
      )}

      <div className="space-y-3">
        {groups.map((g) => (
          <div key={`${g.kind}:${g.key}`} className="card p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className={`chip ${g.kind === "phone" ? "chip-hot" : "chip-warm"} text-[10px]`}>
                {g.kind === "phone" ? "📞 PHONE" : "✉️ EMAIL"}
              </span>
              <span className="font-mono text-xs text-gray-700 break-all">{g.key}</span>
              <span className="text-[10px] text-gray-500">{g.leads.length} leads</span>
            </div>

            <DuplicatesMergeClient
              groupKey={`${g.kind}:${g.key}`}
              leads={g.leads.map((l) => ({
                id: l.id,
                name: l.name,
                phone: l.phone,
                email: l.email,
                status: l.status,
                source: l.source,
                ownerName: l.ownerName,
                createdAtLabel: fmtIST12(l.createdAt) + " IST",
                lastTouchedLabel: l.lastTouchedAt ? fmtIST12(l.lastTouchedAt) + " IST" : "—",
              }))}
            />

            <div className="mt-2 text-[10px] text-gray-400">
              Tip: open each lead in a new tab to skim activity before deciding which to keep.
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              {g.leads.map((l) => (
                <Link key={l.id} href={`/leads/${l.id}`} target="_blank" className="text-[11px] underline text-[#0b1a33]">
                  open {formatLeadName(l.name).slice(0, 18)}…
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
