import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus, LeadStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";

// PATCH /api/leads/[id]/eoi — partial update of any EOI / booking-funnel field.
//
// Why a dedicated endpoint (instead of /update):
//   • The booking funnel has cascading side-effects the inline-edit endpoint
//     deliberately doesn't handle. Setting bookingFormStatus to "SIGNED" should
//     also stamp bookingFormSignedAt; advancing eoiStage to BOOKING_DONE should
//     stamp bookingDoneAt AND flip Lead.status to WON. Keeping that logic out
//     of the generic field-writer keeps both endpoints predictable.
//   • We validate every enum-like string against an allow-list so a client
//     can't slip in arbitrary status strings (the schema columns are plain
//     String? — there's no Prisma enum to lean on).
//
// Auth: same scope rule as the inline-edit endpoint — owner / manager / admin only.

const EOI_STAGES = [
  "EOI_DISCUSSED",
  "EOI_COLLECTED",
  "KYC_PENDING",
  "BOOKING_FORM_SENT",
  "BOOKING_FORM_SIGNED",
  "PAYMENT_PROOF_RECEIVED",
  "DEVELOPER_CONFIRMATION",
  "BOOKING_DONE",
] as const;
type EOIStage = (typeof EOI_STAGES)[number];

const KYC_STATUSES = ["PENDING", "DOCS_RECEIVED", "VERIFIED", "REJECTED"] as const;
const BOOKING_FORM_STATUSES = ["NOT_SENT", "SENT", "SIGNED", "REJECTED"] as const;
const PAYMENT_PROOF_STATUSES = ["PENDING", "RECEIVED", "VERIFIED"] as const;
const DEV_CONF_STATUSES = ["PENDING", "CONFIRMED"] as const;
const PAYMENT_METHODS = ["BANK_TRANSFER", "CARD", "CHEQUE", "CASH"] as const;
const CURRENCIES = ["AED", "INR"] as const;
const COMMISSION_STATUSES = ["PENDING", "INVOICED", "RECEIVED"] as const;

type EnumMap = Record<string, readonly string[]>;
const ENUMS: EnumMap = {
  eoiStage: EOI_STAGES,
  kycStatus: KYC_STATUSES,
  bookingFormStatus: BOOKING_FORM_STATUSES,
  paymentProofStatus: PAYMENT_PROOF_STATUSES,
  developerConfirmationStatus: DEV_CONF_STATUSES,
  eoiPaymentMethod: PAYMENT_METHODS,
  eoiCurrency: CURRENCIES,
  commissionCurrency: CURRENCIES,
  commissionStatus: COMMISSION_STATUSES,
};

const STRING_FIELDS = new Set(["eoiNotes"]);
const INT_FIELDS = new Set(["eoiAmount", "commissionAmount"]);
const DATE_FIELDS = new Set([
  "eoiCollectedAt",
  "kycReceivedAt",
  "bookingFormSentAt",
  "bookingFormSignedAt",
  "paymentProofReceivedAt",
  "developerConfirmedAt",
  "bookingDoneAt",
  "commissionReceivedAt",
]);
const BOOL_FIELDS = new Set(["eoiApprovalRequired"]);

// All fields this endpoint accepts (used to ignore stray keys).
const ALLOWED_FIELDS = new Set<string>([
  ...Object.keys(ENUMS),
  ...STRING_FIELDS,
  ...INT_FIELDS,
  ...DATE_FIELDS,
  ...BOOL_FIELDS,
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Load the current EOI columns so we can detect status transitions (needed
  // for auto-timestamping). Re-fetched here rather than relying on loadOwnedLead
  // because that helper only returns a slim select.
  const current = await prisma.lead.findUnique({
    where: { id },
    select: {
      eoiStage: true,
      kycStatus: true,
      bookingFormStatus: true,
      paymentProofStatus: true,
      developerConfirmationStatus: true,
      bookingFormSignedAt: true,
      eoiCollectedAt: true,
      kycReceivedAt: true,
      bookingFormSentAt: true,
      paymentProofReceivedAt: true,
      developerConfirmedAt: true,
      bookingDoneAt: true,
      status: true,
    },
  });
  if (!current) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  const notes: string[] = [];
  const now = new Date();

  for (const [key, raw] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(key)) continue;

    // Treat null / empty string / undefined as a clear.
    if (raw === null || raw === undefined || raw === "") {
      updates[key] = null;
      notes.push(`${key} cleared`);
      continue;
    }

    if (key in ENUMS) {
      const v = String(raw);
      if (!ENUMS[key].includes(v)) {
        return NextResponse.json({ error: `Invalid value for ${key}: ${v}` }, { status: 400 });
      }
      updates[key] = v;
      notes.push(`${key} → ${v}`);
      continue;
    }

    if (STRING_FIELDS.has(key)) {
      updates[key] = String(raw);
      notes.push(`${key} updated`);
      continue;
    }

    if (INT_FIELDS.has(key)) {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `Invalid number for ${key}` }, { status: 400 });
      }
      updates[key] = n;
      notes.push(`${key} → ${n}`);
      continue;
    }

    if (DATE_FIELDS.has(key)) {
      const d = new Date(String(raw));
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: `Invalid date for ${key}` }, { status: 400 });
      }
      updates[key] = d;
      notes.push(`${key} → ${d.toISOString().slice(0, 10)}`);
      continue;
    }

    if (BOOL_FIELDS.has(key)) {
      const b = raw === true || raw === "true" || raw === "1" || raw === 1;
      updates[key] = b;
      notes.push(`${key} → ${b}`);
      // If turning approval ON, clear any previous approval so a fresh sign-off
      // is required. If turning OFF without an approver, keep history.
      if (key === "eoiApprovalRequired" && b) {
        updates.eoiApprovedAt = null;
        updates.eoiApprovedById = null;
      }
      continue;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // ── Auto-stamp *At timestamps when a status crosses a meaningful threshold ──
  // Only stamp when the status is *changing* to the trigger value AND the
  // corresponding *At is currently null OR not being explicitly set in this
  // request (caller can override).
  const willChange = (field: keyof typeof current, to: string) =>
    updates[field] !== undefined && updates[field] !== current[field] && updates[field] === to;

  if (willChange("kycStatus", "DOCS_RECEIVED") || willChange("kycStatus", "VERIFIED")) {
    if (updates.kycReceivedAt === undefined && !current.kycReceivedAt) {
      updates.kycReceivedAt = now;
    }
  }
  if (willChange("bookingFormStatus", "SENT")) {
    if (updates.bookingFormSentAt === undefined && !current.bookingFormSentAt) {
      updates.bookingFormSentAt = now;
    }
  }
  if (willChange("bookingFormStatus", "SIGNED")) {
    if (updates.bookingFormSignedAt === undefined && !current.bookingFormSignedAt) {
      updates.bookingFormSignedAt = now;
    }
  }
  if (
    willChange("paymentProofStatus", "RECEIVED") ||
    willChange("paymentProofStatus", "VERIFIED")
  ) {
    if (updates.paymentProofReceivedAt === undefined && !current.paymentProofReceivedAt) {
      updates.paymentProofReceivedAt = now;
    }
  }
  if (willChange("developerConfirmationStatus", "CONFIRMED")) {
    if (updates.developerConfirmedAt === undefined && !current.developerConfirmedAt) {
      updates.developerConfirmedAt = now;
    }
  }

  // ── Stage transitions ──
  const newStage = updates.eoiStage as EOIStage | null | undefined;
  if (typeof newStage === "string" && newStage !== current.eoiStage) {
    // EOI_COLLECTED → stamp eoiCollectedAt if missing
    if (newStage === "EOI_COLLECTED" && updates.eoiCollectedAt === undefined && !current.eoiCollectedAt) {
      updates.eoiCollectedAt = now;
    }
    if (newStage === "BOOKING_FORM_SENT" && updates.bookingFormSentAt === undefined && !current.bookingFormSentAt) {
      updates.bookingFormSentAt = now;
      if (updates.bookingFormStatus === undefined && current.bookingFormStatus !== "SENT") {
        updates.bookingFormStatus = "SENT";
      }
    }
    if (newStage === "BOOKING_FORM_SIGNED" && updates.bookingFormSignedAt === undefined && !current.bookingFormSignedAt) {
      updates.bookingFormSignedAt = now;
      if (updates.bookingFormStatus === undefined) {
        updates.bookingFormStatus = "SIGNED";
      }
    }
    if (newStage === "BOOKING_DONE") {
      if (updates.bookingDoneAt === undefined && !current.bookingDoneAt) {
        updates.bookingDoneAt = now;
      }
      // Flip Lead.status → WON. The booking funnel reaching its end IS a win.
      if (current.status !== LeadStatus.WON) {
        updates.status = LeadStatus.WON;
      }
    }
  }

  updates.lastTouchedAt = now;

  const updated = await prisma.lead.update({ where: { id }, data: updates as never });

  if (notes.length) {
    await prisma.activity.create({
      data: {
        leadId: id,
        userId: me.id,
        type: ActivityType.NOTE,
        status: ActivityStatus.DONE,
        title: `EOI update: ${notes.length} field(s)`,
        description: notes.join(", "),
        completedAt: now,
      },
    });
  }

  return NextResponse.json({ ok: true, lead: updated });
}
