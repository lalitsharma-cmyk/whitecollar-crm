import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseImportDate } from "@/lib/parseImportDate";
import { normalizeBuyerKey, toJsonArray, primaryPhone } from "@/lib/buyerIntelligence";
import { audit, reqMeta } from "@/lib/audit";

// ── Buyer import — ADMIN ONLY (passport + financial data) ────────────────────
// Two actions on this one endpoint:
//   POST {init:true, source, sourceRef, total}  → create a BuyerImportBatch, return its id.
//   POST {batchId, rows:[...]}                   → create BuyerRecords for a chunk,
//                                                  log failures to BuyerImportLog,
//                                                  bump the batch counters.
// The client sends rows in chunks (~200) so no single request risks the
// serverless timeout. Each row carries the MAPPED buyer fields plus an `_extra`
// object of every unmapped sheet column — preserved verbatim into extraFields so
// NO imported data is ever dropped.

type ImportRow = {
  clientName?: string;
  coBuyerNames?: string;     // delimited or single
  phones?: string;
  emails?: string;
  passport?: string;
  nationality?: string;
  projectName?: string;
  tower?: string;
  unitNumber?: string;
  propertyType?: string;
  configuration?: string;
  transactionValue?: string;
  pricePerSqFt?: string;
  transactionDate?: string;
  transactionId?: string;
  agentName?: string;
  _extra?: Record<string, string>;   // unmapped columns, verbatim
};

function num(v?: string): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? null : n;
}
const str = (v?: string): string | null => {
  const t = String(v ?? "").trim();
  return t || null;
};

export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (me.role !== "ADMIN") return NextResponse.json({ error: "Admin only — buyer data is restricted." }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  // ── Action 1: initialise a batch ──────────────────────────────────────────
  if (body.init === true) {
    const batch = await prisma.buyerImportBatch.create({
      data: {
        source: String(body.source ?? "Excel file").slice(0, 120),
        sourceRef: body.sourceRef ? String(body.sourceRef).slice(0, 300) : null,
        recordCount: Number(body.total) || 0,
        importedById: me.id,
      },
    });
    await audit({ userId: me.id, action: "buyer.import.start", entity: "BuyerImportBatch", entityId: batch.id, meta: { source: batch.source, total: batch.recordCount }, request: reqMeta(req) });
    return NextResponse.json({ id: batch.id });
  }

  // ── Action 2: import a chunk of rows ──────────────────────────────────────
  const batchId: string | null = typeof body.batchId === "string" && body.batchId ? body.batchId : null;
  const rows: ImportRow[] = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return NextResponse.json({ imported: 0, failed: 0 });

  // Resolve the batch's first-seen row offset so logged rowNum is global, not
  // per-chunk. The client passes rowOffset (rows already processed).
  const rowOffset: number = Number(body.rowOffset) || 0;
  const sourceFile: string | null = body.sourceFile ? String(body.sourceFile).slice(0, 200) : null;

  let imported = 0;
  let failed = 0;
  const errorLogs: { batchId: string; rowNum: number; error: string; rawRow: object }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = rowOffset + i + 1;
    const clientName = str(r.clientName);
    if (!clientName) {
      failed++;
      if (batchId) errorLogs.push({ batchId, rowNum, error: "Missing required field: Client Name", rawRow: { ...r } });
      continue;
    }
    try {
      const phonesJson = toJsonArray((r.phones ?? "").split(/[,;|]/));
      const emailsJson = toJsonArray((r.emails ?? "").split(/[,;|]/).map((e) => e.toLowerCase()));
      const coBuyersJson = toJsonArray((r.coBuyerNames ?? "").split(/[,;|]/));
      const buyerKey = normalizeBuyerKey(clientName, primaryPhone(phonesJson, null));
      const extra = r._extra && typeof r._extra === "object"
        ? Object.fromEntries(Object.entries(r._extra).filter(([k, v]) => k.trim() && String(v ?? "").trim()))
        : {};

      await prisma.buyerRecord.create({
        data: {
          clientName,
          coBuyerNames: coBuyersJson,
          phones: phonesJson,
          emails: emailsJson,
          passport: str(r.passport),
          nationality: str(r.nationality),
          projectName: str(r.projectName),
          tower: str(r.tower),
          unitNumber: str(r.unitNumber),
          propertyType: str(r.propertyType),
          configuration: str(r.configuration),
          transactionValue: num(r.transactionValue),
          pricePerSqFt: num(r.pricePerSqFt),
          // transactionDate ALWAYS from the sheet — never the import timestamp.
          transactionDate: parseImportDate(r.transactionDate) ?? null,
          transactionId: str(r.transactionId),
          agentName: str(r.agentName),
          source: "Excel import",
          sourceFile,
          extraFields: Object.keys(extra).length ? extra : undefined,
          buyerKey,
          importBatchId: batchId,
        },
      });
      imported++;
    } catch (e) {
      failed++;
      if (batchId) errorLogs.push({ batchId, rowNum, error: String(e).slice(0, 500), rawRow: { ...r } });
    }
  }

  // Persist failure logs + bump batch counters.
  if (batchId) {
    if (errorLogs.length) {
      await prisma.buyerImportLog.createMany({
        data: errorLogs.map((l) => ({ batchId: l.batchId, rowNum: l.rowNum, error: l.error, rawRow: l.rawRow })),
      });
    }
    await prisma.buyerImportBatch.update({
      where: { id: batchId },
      data: { successCount: { increment: imported }, errorCount: { increment: failed } },
    });
  }

  return NextResponse.json({ imported, failed, errors: errorLogs.map((l) => ({ row: l.rowNum, error: l.error })) });
}
