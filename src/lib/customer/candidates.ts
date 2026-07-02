import "server-only";
// Customer Identity Resolution Center (Phase E) — candidate detection. READ-ONLY.
// Finds UNLINKED leads (customerId = null) that share a Very-High signal (same
// mobile OR same email) with another unlinked lead → the duplicate groups an admin
// resolves into ONE virtual Customer. Records stay separate; linking is reversible
// (unlinkEnquiry). Agents never see this — the page is ADMIN-only.
import { prisma } from "@/lib/prisma";

const PLACEHOLDER = new Set(["9999999999", "0000000000", "1111111111", "1234567890"]);
const normPhone = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);
const normEmail = (e: string | null) => (e ?? "").trim().toLowerCase();

export interface CandidateLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  currentStatus: string | null;
  forwardedTeam: string | null;
  ownerName: string | null;
  createdAt: Date;
}

export interface CandidateGroup {
  key: string;                 // the shared phone (last-10) or email
  matchType: "phone" | "email";
  leads: CandidateLead[];      // ≥2 unlinked leads that share the key
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

/** Groups of unlinked leads sharing a phone/email (Very-High duplicate candidates),
 *  largest groups first. Phone groups take precedence; an already-grouped lead is
 *  not re-listed under a weaker email group. */
export async function getUnlinkedCandidateGroups(limit = 100): Promise<CandidateGroup[]> {
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, customerId: null, OR: [{ phone: { not: null } }, { email: { not: null } }] },
    select: {
      id: true, name: true, phone: true, email: true, currentStatus: true,
      forwardedTeam: true, createdAt: true, owner: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 8000,
  });

  const byPhone = new Map<string, CandidateLead[]>();
  const byEmail = new Map<string, CandidateLead[]>();
  for (const l of leads) {
    const cl: CandidateLead = {
      id: l.id, name: l.name, phone: l.phone, email: l.email, currentStatus: l.currentStatus,
      forwardedTeam: l.forwardedTeam, ownerName: l.owner?.name ?? null, createdAt: l.createdAt,
    };
    const pk = normPhone(l.phone);
    if (pk.length === 10 && !PLACEHOLDER.has(pk)) push(byPhone, pk, cl);
    const ek = normEmail(l.email);
    if (ek.includes("@")) push(byEmail, ek, cl);
  }

  const groups: CandidateGroup[] = [];
  const claimed = new Set<string>(); // a lead belongs to at most one group (phone wins)
  for (const [k, v] of byPhone) {
    if (v.length > 1) { groups.push({ key: k, matchType: "phone", leads: v }); v.forEach((l) => claimed.add(l.id)); }
  }
  for (const [k, v] of byEmail) {
    const fresh = v.filter((l) => !claimed.has(l.id));
    if (fresh.length > 1) { groups.push({ key: k, matchType: "email", leads: fresh }); fresh.forEach((l) => claimed.add(l.id)); }
  }
  return groups.sort((a, b) => b.leads.length - a.leads.length).slice(0, limit);
}

/** Total unresolved-candidate lead count (for the nav badge). */
export async function countUnlinkedCandidates(): Promise<number> {
  const groups = await getUnlinkedCandidateGroups(1000);
  return groups.reduce((n, g) => n + g.leads.length, 0);
}
