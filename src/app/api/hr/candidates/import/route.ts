import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HRCandidateStatus } from "@prisma/client";
import { fingerprintFor } from "@/lib/assignment";
import { HR_STATUSES } from "@/lib/hrStatus";

// status lookup by enum key OR human label (case-insensitive)
const STATUS_LOOKUP = new Map<string, HRCandidateStatus>();
for (const s of HR_STATUSES) { STATUS_LOOKUP.set(s.key.toLowerCase(), s.key); STATUS_LOOKUP.set(s.label.toLowerCase(), s.key); }
function parseStatus(v?: string): HRCandidateStatus { return STATUS_LOOKUP.get((v ?? "").trim().toLowerCase()) ?? "NEW"; }
function num(v?: string): number | null { if (!v) return null; const n = parseFloat(String(v).replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; }

type Row = Record<string, string>;
function toData(r: Row) {
  return {
    name: (r.name ?? "").trim(),
    phone: r.phone?.trim() || null, whatsappPhone: r.whatsappPhone?.trim() || null,
    email: r.email?.trim().toLowerCase() || null, location: r.location?.trim() || null, city: r.city?.trim() || null,
    currentCompany: r.currentCompany?.trim() || null, currentProfile: r.currentProfile?.trim() || null,
    positionApplied: r.positionApplied?.trim() || null, experience: r.experience?.trim() || null,
    realEstateExperience: r.realEstateExperience?.trim() || null,
    currentSalary: num(r.currentSalary), expectedSalary: num(r.expectedSalary),
    noticePeriod: r.noticePeriod?.trim() || null, source: r.source?.trim() || "Import",
    remarks: r.remarks?.trim() || null, nextAction: r.nextAction?.trim() || null,
  };
}

async function attachResume(candidateId: string, url: string, userId: string) {
  await prisma.hRResume.updateMany({ where: { candidateId, isActive: true }, data: { isActive: false } });
  await prisma.hRResume.create({
    data: { candidateId, url, filename: (url.split("/").pop() || "resume").slice(0, 120), mimeType: "application/octet-stream", isActive: true, uploadedById: userId },
  });
}

// Batched candidate import. The client sends rows in chunks (≈100) and shows
// progress, so no single request risks the serverless timeout even for 25k rows.
export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (me.role !== "ADMIN" && me.role !== "MANAGER") return NextResponse.json({ error: "Only Admin / HR Manager can import." }, { status: 403 });

  const body = await req.json();
  const rows: Row[] = Array.isArray(body.rows) ? body.rows : [];
  const strategy: "skip" | "update" | "create" = ["skip", "update", "create"].includes(body.strategy) ? body.strategy : "skip";
  const ownerId: string = body.primaryOwnerId || me.id;
  if (rows.length === 0) return NextResponse.json({ imported: 0, updated: 0, skipped: 0, failed: 0 });

  let imported = 0, updated = 0, skipped = 0, failed = 0;

  // One indexed lookup for the whole batch (fingerprint = phone||email digits).
  const fps = Array.from(new Set(rows.map(r => fingerprintFor(r.phone, r.email)).filter(Boolean) as string[]));
  const existing = fps.length ? await prisma.hRCandidate.findMany({ where: { fingerprint: { in: fps } }, select: { id: true, fingerprint: true } }) : [];
  const existingByFp = new Map(existing.map(e => [e.fingerprint!, e.id]));

  const bulk: Array<ReturnType<typeof toData> & { status: HRCandidateStatus; primaryOwnerId: string; fingerprint: string | null }> = [];
  const seenFp = new Set<string>();

  for (const r of rows) {
    const name = (r.name ?? "").trim();
    if (!name) { failed++; continue; }
    const fp = fingerprintFor(r.phone, r.email);
    const existsId = fp ? existingByFp.get(fp) : undefined;

    try {
      if (existsId) {
        if (strategy === "skip") { skipped++; continue; }
        if (strategy === "update") {
          const d = toData(r);
          const upd: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(d)) if (v !== null && v !== "" && k !== "name") upd[k] = v;
          await prisma.hRCandidate.update({ where: { id: existsId }, data: upd });
          if (r.resumeUrl?.trim()) await attachResume(existsId, r.resumeUrl.trim(), me.id);
          updated++;
          continue;
        }
        // strategy === "create": fall through and create a forced duplicate (no fingerprint)
      }

      const forcedDup = !!existsId || (fp ? seenFp.has(fp) : false);
      if (fp && !forcedDup) seenFp.add(fp);
      const record = { ...toData(r), status: parseStatus(r.status), primaryOwnerId: ownerId, fingerprint: forcedDup ? null : fp };

      if (r.resumeUrl?.trim()) {
        // needs the new id → individual create
        const cand = await prisma.hRCandidate.create({ data: record });
        await attachResume(cand.id, r.resumeUrl.trim(), me.id);
        imported++;
      } else {
        bulk.push(record);
      }
    } catch { failed++; }
  }

  if (bulk.length) {
    try {
      const res = await prisma.hRCandidate.createMany({ data: bulk, skipDuplicates: true });
      imported += res.count;
      failed += bulk.length - res.count;
    } catch {
      // fall back to per-row so one bad row doesn't sink the batch
      for (const rec of bulk) {
        try { await prisma.hRCandidate.create({ data: rec }); imported++; } catch { failed++; }
      }
    }
  }

  return NextResponse.json({ imported, updated, skipped, failed });
}
