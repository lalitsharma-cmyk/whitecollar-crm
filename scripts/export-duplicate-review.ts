// READ-ONLY duplicate REVIEW LIST export (no merges, no writes to lead data).
// Mirrors the Customer Identity Center's detection (src/lib/customer/candidates.ts):
// groups of live, UNLINKED leads sharing a normalized mobile (last-10, non-placeholder)
// or email. Produces an approval-ready markdown report so duplicates can be reviewed and
// decided by a human — never auto-merged. Phones are masked (last 4) in the artifact.
//
// Output: docs/reviews/duplicate-review-<YYYY-MM-DD>.md  (+ console summary)
import { prisma } from "../src/lib/prisma";
import * as fs from "fs";

const PLACEHOLDER = new Set(["9999999999", "0000000000", "1111111111", "1234567890"]);
const normPhone = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);
const normEmail = (e: string | null) => (e ?? "").trim().toLowerCase();
const maskPhone = (p: string | null) => { const d = (p ?? "").replace(/\D/g, ""); return d ? `••••••${d.slice(-4)}` : "—"; };
const maskEmail = (e: string | null) => { const s = (e ?? "").trim(); if (!s.includes("@")) return "—"; const [u, d] = s.split("@"); return `${u.slice(0, 2)}***@${d}`; };

type L = { id: string; name: string; phone: string | null; email: string | null; currentStatus: string | null; forwardedTeam: string | null; market: string | null; createdAt: Date; owner: { name: string | null } | null };
type Group = { key: string; keyMasked: string; matchType: "phone" | "email"; leads: L[] };

function push(m: Map<string, L[]>, k: string, v: L) { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); }

async function main() {
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, customerId: null, OR: [{ phone: { not: null } }, { email: { not: null } }] },
    select: { id: true, name: true, phone: true, email: true, currentStatus: true, forwardedTeam: true, market: true, createdAt: true, owner: { select: { name: true } } },
    orderBy: { createdAt: "desc" }, take: 8000,
  });

  const byPhone = new Map<string, L[]>(), byEmail = new Map<string, L[]>();
  for (const l of leads) {
    const pk = normPhone(l.phone);
    if (pk.length === 10 && !PLACEHOLDER.has(pk)) push(byPhone, pk, l);
    const ek = normEmail(l.email);
    if (ek.includes("@")) push(byEmail, ek, l);
  }

  const groups: Group[] = [];
  const claimed = new Set<string>();
  for (const [k, v] of byPhone) if (v.length > 1) { groups.push({ key: k, keyMasked: maskPhone(v[0].phone), matchType: "phone", leads: v }); v.forEach((l) => claimed.add(l.id)); }
  for (const [k, v] of byEmail) { const fresh = v.filter((l) => !claimed.has(l.id)); if (fresh.length > 1) { groups.push({ key: k, keyMasked: maskEmail(fresh[0].email), matchType: "email", leads: fresh }); fresh.forEach((l) => claimed.add(l.id)); } }
  groups.sort((a, b) => b.leads.length - a.leads.length);

  const dupLeads = groups.reduce((n, g) => n + g.leads.length, 0);
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Duplicate Review List — ${today}`);
  lines.push("");
  lines.push(`> READ-ONLY review artifact. **No records were merged or modified.** Each group is a set of live, unlinked leads sharing a mobile or email. Decide per group: **Link** (virtual unified profile, reversible, via the Customer Identity Center) · **Keep separate** · **Merge** (irreversible — requires explicit approval).`);
  lines.push("");
  lines.push(`**${groups.length} duplicate group(s)** covering **${dupLeads} lead(s)**. Phones masked (last 4).`);
  lines.push("");
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    lines.push(`### ${i + 1}. ${g.matchType === "phone" ? "📱 Same mobile" : "✉️ Same email"} \`${g.keyMasked}\` — ${g.leads.length} records`);
    lines.push("");
    lines.push("| Lead ID | Name | Status | Team | Market | Owner | Created |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const l of g.leads.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      lines.push(`| \`${l.id}\` | ${l.name} | ${l.currentStatus ?? "—"} | ${l.forwardedTeam ?? "—"} | ${l.market ?? "—"} | ${l.owner?.name ?? "—"} | ${l.createdAt.toISOString().slice(0, 10)} |`);
    }
    lines.push("");
  }
  if (!groups.length) lines.push("_No duplicate groups found — every live lead has a unique mobile/email._");

  fs.mkdirSync("docs/reviews", { recursive: true });
  const out = `docs/reviews/duplicate-review-${today}.md`;
  fs.writeFileSync(out, lines.join("\n"), "utf8");
  console.log(`Wrote ${out}`);
  console.log(`Duplicate groups: ${groups.length} | leads involved: ${dupLeads}`);
  console.log(`By type: phone=${groups.filter((g) => g.matchType === "phone").length}, email=${groups.filter((g) => g.matchType === "email").length}`);
  console.log(`Largest group: ${groups[0]?.leads.length ?? 0} records`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
