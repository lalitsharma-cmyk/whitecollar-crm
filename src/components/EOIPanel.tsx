"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ShieldCheck, AlertTriangle, ChevronRight, ChevronDown, Clock } from "lucide-react";
import { fmtIST12 } from "@/lib/datetime";

// ── EOI / Booking-funnel side panel ──
//
// Companion to (and visually distinct from) EOIWorkflowCard. Where the older
// card is a single fixed-stage editor with an Advance button, EOIPanel lets
// the agent CLICK ANY of the 8 stepper dots and reveal that stage's fields
// inline — useful when you need to backfill an earlier KYC status or update
// a paid-but-unstamped commission line without first walking up the funnel.
//
// All persistence goes through PATCH /api/leads/[id]/eoi (same endpoint
// EOIWorkflowCard uses). Updates are optimistic; on failure we roll the
// local copy back and surface a toast at the bottom.

// ── Stage definition ────────────────────────────────────────────────────
// Short labels match the spec ("EOI", "KYC", "Form sent", ...) so the
// stepper stays readable on narrow viewports.
const STAGES = [
  { key: "EOI_DISCUSSED",          label: "EOI Discussed",          short: "EOI" },
  { key: "EOI_COLLECTED",          label: "EOI Collected",          short: "Collected" },
  { key: "KYC_PENDING",            label: "KYC",                    short: "KYC" },
  { key: "BOOKING_FORM_SENT",      label: "Booking Form Sent",      short: "Form sent" },
  { key: "BOOKING_FORM_SIGNED",    label: "Booking Form Signed",    short: "Form signed" },
  { key: "PAYMENT_PROOF_RECEIVED", label: "Payment Proof Received", short: "Payment" },
  { key: "DEVELOPER_CONFIRMATION", label: "Developer Confirmation", short: "Confirm" },
  { key: "BOOKING_DONE",           label: "Booking Done",           short: "Booked" },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

// ── Lead shape ──
// Same minimal projection EOIWorkflowCard uses. Declared locally so the
// server component doesn't have to ship the full Prisma type across the
// boundary (it's huge).
export interface EOIPanelLead {
  id: string;
  status: string;
  eoiStage: string | null;
  eoiAmount: number | null;
  eoiCurrency: string | null;
  eoiPaymentMethod: string | null;
  eoiCollectedAt: Date | string | null;
  kycStatus: string | null;
  kycReceivedAt: Date | string | null;
  bookingFormStatus: string | null;
  bookingFormSentAt: Date | string | null;
  bookingFormSignedAt: Date | string | null;
  paymentProofStatus: string | null;
  paymentProofReceivedAt: Date | string | null;
  developerConfirmationStatus: string | null;
  developerConfirmedAt: Date | string | null;
  bookingDoneAt: Date | string | null;
  commissionAmount: number | null;
  commissionCurrency: string | null;
  commissionStatus: string | null;
  commissionReceivedAt: Date | string | null;
  eoiNotes: string | null;
  eoiApprovalRequired: boolean;
  eoiApprovedAt: Date | string | null;
}

interface Props {
  lead: EOIPanelLead;
  /** Caller-provided role, used to show/hide the manager approve button. */
  currentUserRole?: "ADMIN" | "MANAGER" | "AGENT" | string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const stageIndex = (s: string | null): number => {
  if (!s) return -1;
  return STAGES.findIndex((st) => st.key === s);
};

const fmt = (d: Date | string | null): string | null => (d ? fmtIST12(d) : null);

// Returns the canonical "completion timestamp" for a stage if one exists.
// EOI_DISCUSSED has none (completion is implicit in stage > 0); all others
// map to a single *At column.
function completionAt(stage: StageKey, lead: EOIPanelLead): Date | string | null {
  switch (stage) {
    case "EOI_DISCUSSED":          return null;
    case "EOI_COLLECTED":          return lead.eoiCollectedAt;
    case "KYC_PENDING":            return lead.kycReceivedAt;
    case "BOOKING_FORM_SENT":      return lead.bookingFormSentAt;
    case "BOOKING_FORM_SIGNED":    return lead.bookingFormSignedAt;
    case "PAYMENT_PROOF_RECEIVED": return lead.paymentProofReceivedAt;
    case "DEVELOPER_CONFIRMATION": return lead.developerConfirmedAt;
    case "BOOKING_DONE":           return lead.bookingDoneAt;
  }
}

// Translate the stored UTC date into the value a datetime-local input
// expects (IST wall-clock). Mirrors the helper in EOIWorkflowCard.
const toLocal = (d: Date | string | null): string => {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "";
  const ist = new Date(dt.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 16);
};

// Convert a datetime-local string (interpreted as IST) back to UTC ISO.
const fromLocal = (s: string): string | null => {
  if (!s) return null;
  const d = new Date(`${s}:00+05:30`);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const inputCls =
  "w-full border border-[color:var(--border,#e5e7eb)] rounded-lg px-3 py-2 text-sm bg-white text-gray-900 dark:bg-[#0b1a33]/40 dark:text-gray-100 dark:border-white/10";
const labelCls = "text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1";

// ── Component ───────────────────────────────────────────────────────────

export default function EOIPanel({ lead, currentUserRole }: Props) {
  const router = useRouter();

  // Local optimistic snapshot of the lead. Kept in sync with incoming props
  // (in case the server-rendered detail page refreshes after router.refresh()).
  const [snap, setSnap] = useState<EOIPanelLead>(lead);
  useEffect(() => { setSnap(lead); }, [lead]);

  const currentIdx = stageIndex(snap.eoiStage);
  // No eoiStage yet → treat EOI_DISCUSSED as the implicit starting point so
  // the panel still renders fillable fields for a fresh negotiation lead.
  const effectiveIdx = currentIdx === -1 ? 0 : currentIdx;

  // Which dot is currently expanded. Default to the active stage. Clicking
  // a different dot reveals THAT stage's fields without advancing eoiStage.
  const [expandedIdx, setExpandedIdx] = useState<number>(effectiveIdx);
  useEffect(() => { setExpandedIdx(effectiveIdx); }, [effectiveIdx]);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // Per-stage form state. Seeded from the snapshot; recomputed when snap changes.
  const initialForm = useMemo(() => seedForm(snap), [snap]);
  const [form, setForm] = useState(initialForm);
  useEffect(() => { setForm(initialForm); }, [initialForm]);

  const isWon = snap.eoiStage === "BOOKING_DONE";
  const awaitingApproval = snap.eoiApprovalRequired && !snap.eoiApprovedAt;
  const canApprove = currentUserRole === "ADMIN" || currentUserRole === "MANAGER";

  // ── PATCH with optimistic update + rollback ────────────────────────
  // The optimistic patch is shallow: we merge `optimistic` into snap, fire
  // the request, and on failure restore the previous snap. Toast surfaces
  // the failure text from the server when present.
  async function patch(optimistic: Partial<EOIPanelLead>, payload: Record<string, unknown>) {
    if (busy) return;
    const prev = snap;
    setSnap({ ...snap, ...optimistic });
    setBusy(true);
    setToast(null);
    try {
      const r = await fetch(`/api/leads/${snap.id}/eoi`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setSnap(prev);
        setToast({ tone: "err", text: j.error ?? `Save failed (${r.status})` });
        return;
      }
      setToast({ tone: "ok", text: "Saved" });
      // Pull the server-canonical snapshot so any derived fields (auto-stamped
      // *At timestamps, lead.status flip on BOOKING_DONE) flow back into the UI.
      router.refresh();
    } catch (e) {
      setSnap(prev);
      setToast({ tone: "err", text: `Network error: ${String(e).slice(0, 80)}` });
    } finally {
      setBusy(false);
    }
  }

  // Save the visible stage's editable fields. Compares against snap so we
  // only PATCH what's actually changed.
  async function saveStage(stage: StageKey) {
    const { payload, optimistic } = collectStageDiff(stage, form, snap);
    if (!Object.keys(payload).length) {
      setToast({ tone: "err", text: "Nothing changed." });
      return;
    }
    // If no eoiStage is set yet, stamp the lead with EOI_DISCUSSED so the
    // stepper reads correctly for fresh negotiation leads.
    if (!snap.eoiStage) {
      payload.eoiStage = "EOI_DISCUSSED";
      optimistic.eoiStage = "EOI_DISCUSSED";
    }
    await patch(optimistic, payload);
  }

  // Mark the panel's CURRENT (effective) stage complete and move the
  // funnel one step forward. Per-stage "Mark X" buttons all funnel through
  // this with their key passed in.
  async function setStage(target: StageKey) {
    if (snap.eoiApprovalRequired && !snap.eoiApprovedAt) {
      setToast({ tone: "err", text: "Approval required before advancing." });
      return;
    }
    await patch({ eoiStage: target }, { eoiStage: target });
  }

  async function approveBooking() {
    if (!canApprove) return;
    if (busy) return;
    setBusy(true);
    setToast(null);
    try {
      const r = await fetch(`/api/leads/${snap.id}/eoi/approve`, { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setToast({ tone: "err", text: j.error ?? `Approve failed (${r.status})` });
        return;
      }
      setToast({ tone: "ok", text: "Approved" });
      router.refresh();
    } catch (e) {
      setToast({ tone: "err", text: `Network error: ${String(e).slice(0, 80)}` });
    } finally {
      setBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="card p-5 border-l-4 border-[#2b6cb0]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="font-semibold text-base">EOI / Booking funnel</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            Click any stage dot to edit its fields. The active stage is highlighted.
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {awaitingApproval && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
              <Clock className="w-3 h-3" /> Awaiting manager approval
            </span>
          )}
          {snap.eoiApprovedAt && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300">
              <ShieldCheck className="w-3 h-3" /> Approved {fmt(snap.eoiApprovedAt)}
            </span>
          )}
          {awaitingApproval && canApprove && (
            <button
              onClick={approveBooking}
              disabled={busy}
              className="btn btn-primary text-xs"
              title="Stamp this booking as manager-approved"
            >
              {busy ? "…" : "Approve booking"}
            </button>
          )}
        </div>
      </div>

      {/* Stepper — horizontal scroll on mobile so all 8 dots stay one line. */}
      <div className="overflow-x-auto -mx-2 px-2 mb-3">
        <ol className="flex items-start gap-1 min-w-max">
          {STAGES.map((s, i) => {
            const done = isStageDone(s.key, i, effectiveIdx, snap);
            const active = i === effectiveIdx;
            const expanded = i === expandedIdx;
            const at = completionAt(s.key, snap);
            return (
              <li key={s.key} className="flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => setExpandedIdx(expanded ? -1 : i)}
                  className="flex flex-col items-center min-w-[72px] text-center cursor-pointer group"
                  title={`${s.label}${at ? ` — ${fmt(at)} IST` : ""}`}
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shadow-sm transition-all ${
                      done
                        ? "bg-emerald-500 text-white"
                        : active
                        ? "bg-blue-600 text-white ring-4 ring-blue-300/40"
                        : "bg-gray-200 text-gray-500 dark:bg-white/10 dark:text-gray-400 group-hover:bg-gray-300"
                    }`}
                  >
                    {done ? <Check className="w-4 h-4" /> : i + 1}
                  </div>
                  <div
                    className={`text-[10px] mt-1 font-semibold leading-tight ${
                      active ? "text-blue-700 dark:text-blue-300" : "text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    {s.short}
                  </div>
                  {at && done && (
                    <div className="text-[9px] text-gray-500 mt-0.5 leading-tight">
                      {fmt(at)?.split(",")[0]}
                    </div>
                  )}
                  <ChevronDown
                    className={`w-3 h-3 mt-0.5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
                {i < STAGES.length - 1 && (
                  <div
                    className={`h-0.5 w-4 sm:w-6 mt-4 ${
                      i < effectiveIdx ? "bg-emerald-400" : "bg-gray-200 dark:bg-white/10"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Inline expansion for the picked stage */}
      {expandedIdx >= 0 && expandedIdx < STAGES.length && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-400/30 bg-blue-50/40 dark:bg-blue-400/5 p-3 mt-2">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="font-semibold text-sm flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-blue-600" />
              {STAGES[expandedIdx].label}
              {expandedIdx === effectiveIdx && (
                <span className="text-[10px] uppercase tracking-wider text-blue-700 font-bold">Current</span>
              )}
            </div>
            {!isWon && (
              <StageActionButton
                stage={STAGES[expandedIdx].key}
                expandedIdx={expandedIdx}
                effectiveIdx={effectiveIdx}
                busy={busy}
                onSet={setStage}
              />
            )}
          </div>

          <StageEditor stage={STAGES[expandedIdx].key} form={form} setForm={setForm} />

          {hasEditableFields(STAGES[expandedIdx].key) && (
            <div className="flex justify-end mt-3">
              <button
                onClick={() => saveStage(STAGES[expandedIdx].key)}
                disabled={busy}
                className="btn btn-ghost text-xs"
              >
                {busy ? "Saving…" : "Save fields"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Toast — non-blocking. Auto-dismisses on next save. */}
      {toast && (
        <div
          className={`mt-3 text-xs rounded p-2 flex items-start gap-2 border ${
            toast.tone === "ok"
              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
              : "bg-red-50 text-red-900 border-red-200"
          }`}
        >
          {toast.tone === "err" && <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />}
          <div className="flex-1">{toast.text}</div>
          <button
            type="button"
            className="text-[10px] underline opacity-70"
            onClick={() => setToast(null)}
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ── A stage is "done" when its representative completion flag is true OR
// when the funnel has moved past it. The funnel-position check is the
// safety net for stages that don't have a 1:1 completion column
// (e.g. EOI_DISCUSSED).
function isStageDone(stage: StageKey, idx: number, effectiveIdx: number, lead: EOIPanelLead): boolean {
  if (idx < effectiveIdx) return true;
  switch (stage) {
    case "EOI_COLLECTED":          return Boolean(lead.eoiCollectedAt);
    case "KYC_PENDING":            return lead.kycStatus === "VERIFIED" || lead.kycStatus === "DOCS_RECEIVED";
    case "BOOKING_FORM_SENT":      return Boolean(lead.bookingFormSentAt) || lead.bookingFormStatus === "SENT";
    case "BOOKING_FORM_SIGNED":    return Boolean(lead.bookingFormSignedAt) || lead.bookingFormStatus === "SIGNED";
    case "PAYMENT_PROOF_RECEIVED": return lead.paymentProofStatus === "VERIFIED" || lead.paymentProofStatus === "RECEIVED";
    case "DEVELOPER_CONFIRMATION": return lead.developerConfirmationStatus === "CONFIRMED";
    case "BOOKING_DONE":           return Boolean(lead.bookingDoneAt);
    default:                        return false;
  }
}

// ── Form state ──────────────────────────────────────────────────────────

interface FormState {
  notes: string;
  eoiAmount: string;
  eoiCurrency: string;
  eoiPaymentMethod: string;
  eoiCollectedAt: string;
  kycStatus: string;
  kycReceivedAt: string;
  bookingFormSentAt: string;
  bookingFormSignedAt: string;
  paymentProofStatus: string;
  paymentProofReceivedAt: string;
  paymentProofVerified: boolean;
  developerConfirmationStatus: string;
  developerConfirmedAt: string;
  bookingDoneAt: string;
  commissionAmount: string;
  commissionCurrency: string;
  commissionStatus: string;
  commissionReceivedAt: string;
}

function seedForm(lead: EOIPanelLead): FormState {
  return {
    notes: lead.eoiNotes ?? "",
    eoiAmount: lead.eoiAmount != null ? String(lead.eoiAmount) : "",
    eoiCurrency: lead.eoiCurrency ?? "AED",
    eoiPaymentMethod: lead.eoiPaymentMethod ?? "",
    eoiCollectedAt: toLocal(lead.eoiCollectedAt),
    kycStatus: lead.kycStatus ?? "",
    kycReceivedAt: toLocal(lead.kycReceivedAt),
    bookingFormSentAt: toLocal(lead.bookingFormSentAt),
    bookingFormSignedAt: toLocal(lead.bookingFormSignedAt),
    paymentProofStatus: lead.paymentProofStatus ?? "",
    paymentProofReceivedAt: toLocal(lead.paymentProofReceivedAt),
    paymentProofVerified: lead.paymentProofStatus === "VERIFIED",
    developerConfirmationStatus: lead.developerConfirmationStatus ?? "",
    developerConfirmedAt: toLocal(lead.developerConfirmedAt),
    bookingDoneAt: toLocal(lead.bookingDoneAt),
    commissionAmount: lead.commissionAmount != null ? String(lead.commissionAmount) : "",
    commissionCurrency: lead.commissionCurrency ?? "AED",
    commissionStatus: lead.commissionStatus ?? "",
    commissionReceivedAt: toLocal(lead.commissionReceivedAt),
  };
}

function hasEditableFields(_stage: StageKey): boolean {
  // Every stage in this panel exposes at least one input — the "Mark
  // discussed" / "Mark X" verbs are handled by the action button, not by
  // saveStage, but the underlying inputs are still editable.
  return true;
}

// Diff helper — compares each form key against the current snap and only
// includes changed values in the payload. Mirrors the same null/empty
// semantics the API expects.
function collectStageDiff(
  stage: StageKey,
  form: FormState,
  lead: EOIPanelLead,
): { payload: Record<string, unknown>; optimistic: Partial<EOIPanelLead> } {
  const payload: Record<string, unknown> = {};
  const optimistic: Partial<EOIPanelLead> = {};

  const setStr = (key: keyof EOIPanelLead, value: string) => {
    const v = value === "" ? null : value;
    if (v !== (lead[key] ?? null)) {
      payload[key as string] = v;
      (optimistic as Record<string, unknown>)[key as string] = v;
    }
  };
  const setNum = (key: keyof EOIPanelLead, value: string) => {
    const v = value === "" ? null : Number(value);
    if (v !== (lead[key] ?? null)) {
      payload[key as string] = v;
      (optimistic as Record<string, unknown>)[key as string] = v;
    }
  };
  const setDate = (key: keyof EOIPanelLead, value: string) => {
    const iso = fromLocal(value);
    const current = lead[key] ? new Date(lead[key] as string).toISOString() : null;
    if (iso !== current) {
      payload[key as string] = iso;
      (optimistic as Record<string, unknown>)[key as string] = iso;
    }
  };

  switch (stage) {
    case "EOI_DISCUSSED":
      setStr("eoiNotes", form.notes);
      break;
    case "EOI_COLLECTED":
      setNum("eoiAmount", form.eoiAmount);
      setStr("eoiCurrency", form.eoiCurrency);
      setStr("eoiPaymentMethod", form.eoiPaymentMethod);
      setDate("eoiCollectedAt", form.eoiCollectedAt);
      break;
    case "KYC_PENDING":
      setStr("kycStatus", form.kycStatus);
      setDate("kycReceivedAt", form.kycReceivedAt);
      break;
    case "BOOKING_FORM_SENT":
      setDate("bookingFormSentAt", form.bookingFormSentAt);
      break;
    case "BOOKING_FORM_SIGNED":
      setDate("bookingFormSignedAt", form.bookingFormSignedAt);
      break;
    case "PAYMENT_PROOF_RECEIVED":
      setDate("paymentProofReceivedAt", form.paymentProofReceivedAt);
      // The "verified" toggle is a sugar shortcut: ON → status VERIFIED,
      // OFF and currently VERIFIED → revert to RECEIVED. Untouched otherwise.
      if (form.paymentProofVerified && lead.paymentProofStatus !== "VERIFIED") {
        payload.paymentProofStatus = "VERIFIED";
        optimistic.paymentProofStatus = "VERIFIED";
      } else if (!form.paymentProofVerified && lead.paymentProofStatus === "VERIFIED") {
        payload.paymentProofStatus = "RECEIVED";
        optimistic.paymentProofStatus = "RECEIVED";
      } else if (form.paymentProofStatus && form.paymentProofStatus !== lead.paymentProofStatus) {
        payload.paymentProofStatus = form.paymentProofStatus;
        optimistic.paymentProofStatus = form.paymentProofStatus;
      }
      break;
    case "DEVELOPER_CONFIRMATION":
      setStr("developerConfirmationStatus", form.developerConfirmationStatus);
      setDate("developerConfirmedAt", form.developerConfirmedAt);
      break;
    case "BOOKING_DONE":
      setDate("bookingDoneAt", form.bookingDoneAt);
      setNum("commissionAmount", form.commissionAmount);
      setStr("commissionCurrency", form.commissionCurrency);
      setStr("commissionStatus", form.commissionStatus);
      setDate("commissionReceivedAt", form.commissionReceivedAt);
      break;
  }
  return { payload, optimistic };
}

// ── Per-stage action button ─────────────────────────────────────────────
// Distinct verbs per stage: "Mark discussed", "Mark collected", ... etc.
// Only shows when the user is looking at the stage that's CURRENTLY active
// (or earlier — for backfill of skipped stages it stays hidden to avoid
// implying you can "go back" through the funnel).
function StageActionButton({
  stage,
  expandedIdx,
  effectiveIdx,
  busy,
  onSet,
}: {
  stage: StageKey;
  expandedIdx: number;
  effectiveIdx: number;
  busy: boolean;
  onSet: (s: StageKey) => void | Promise<void>;
}) {
  // Only show the advance verb when the expanded dot is the currently active stage.
  // Earlier-stage dots are inspection-only here (their date fields can still be
  // backfilled via Save fields).
  if (expandedIdx !== effectiveIdx) return null;
  const next = STAGES[effectiveIdx + 1];
  if (!next) return null;
  const verb = (() => {
    switch (stage) {
      case "EOI_DISCUSSED":          return "Mark discussed";
      case "EOI_COLLECTED":          return "Mark collected";
      case "KYC_PENDING":            return "Mark KYC done";
      case "BOOKING_FORM_SENT":      return "Mark form sent";
      case "BOOKING_FORM_SIGNED":    return "Mark signed";
      case "PAYMENT_PROOF_RECEIVED": return "Mark payment received";
      case "DEVELOPER_CONFIRMATION": return "Mark confirmed";
      case "BOOKING_DONE":           return "";
    }
  })();
  if (!verb) return null;
  return (
    <button
      type="button"
      onClick={() => onSet(next.key)}
      disabled={busy}
      className="btn btn-primary text-xs"
      title={`Advance to ${next.label}`}
    >
      {busy ? "…" : `${verb} →`}
    </button>
  );
}

// ── Per-stage editor ────────────────────────────────────────────────────
function StageEditor({
  stage,
  form,
  setForm,
}: {
  stage: StageKey;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  const upd = <K extends keyof FormState>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));
  const updBool = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.checked }));

  switch (stage) {
    case "EOI_DISCUSSED":
      return (
        <div>
          <div className={labelCls}>Discussion notes</div>
          <textarea
            value={form.notes}
            onChange={upd("notes")}
            rows={3}
            placeholder="e.g. Client agreed to AED 50K EOI verbally on call. Wife is decision maker — call her tomorrow for confirmation."
            className={`${inputCls} font-mono text-[12px] leading-relaxed`}
          />
        </div>
      );
    case "EOI_COLLECTED":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className={labelCls}>Amount</div>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={form.eoiAmount}
              onChange={upd("eoiAmount")}
              placeholder="50000"
              className={inputCls}
            />
          </div>
          <div>
            <div className={labelCls}>Currency</div>
            <select value={form.eoiCurrency} onChange={upd("eoiCurrency")} className={inputCls}>
              <option value="AED">AED</option>
              <option value="INR">INR</option>
            </select>
          </div>
          <div>
            <div className={labelCls}>Payment method</div>
            <select value={form.eoiPaymentMethod} onChange={upd("eoiPaymentMethod")} className={inputCls}>
              <option value="">—</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CARD">Card</option>
              <option value="CHEQUE">Cheque</option>
              <option value="CASH">Cash</option>
            </select>
          </div>
          <div>
            <div className={labelCls}>Collected at (IST)</div>
            <input
              type="datetime-local"
              value={form.eoiCollectedAt}
              onChange={upd("eoiCollectedAt")}
              className={inputCls}
            />
          </div>
        </div>
      );
    case "KYC_PENDING":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className={labelCls}>KYC status</div>
            <select value={form.kycStatus} onChange={upd("kycStatus")} className={inputCls}>
              <option value="">—</option>
              <option value="PENDING">Pending</option>
              <option value="DOCS_RECEIVED">Docs received</option>
              <option value="VERIFIED">Verified</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
          <div>
            <div className={labelCls}>Received at (IST)</div>
            <input
              type="datetime-local"
              value={form.kycReceivedAt}
              onChange={upd("kycReceivedAt")}
              className={inputCls}
            />
          </div>
        </div>
      );
    case "BOOKING_FORM_SENT":
      return (
        <div>
          <div className={labelCls}>Sent at (IST)</div>
          <input
            type="datetime-local"
            value={form.bookingFormSentAt}
            onChange={upd("bookingFormSentAt")}
            className={inputCls}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Leaving blank and advancing the stage stamps the current time.
          </p>
        </div>
      );
    case "BOOKING_FORM_SIGNED":
      return (
        <div>
          <div className={labelCls}>Signed at (IST)</div>
          <input
            type="datetime-local"
            value={form.bookingFormSignedAt}
            onChange={upd("bookingFormSignedAt")}
            className={inputCls}
          />
        </div>
      );
    case "PAYMENT_PROOF_RECEIVED":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className={labelCls}>Received at (IST)</div>
            <input
              type="datetime-local"
              value={form.paymentProofReceivedAt}
              onChange={upd("paymentProofReceivedAt")}
              className={inputCls}
            />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={form.paymentProofVerified}
                onChange={updBool("paymentProofVerified")}
                className="w-4 h-4"
              />
              <span>Verified</span>
            </label>
          </div>
        </div>
      );
    case "DEVELOPER_CONFIRMATION":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className={labelCls}>Status</div>
            <select
              value={form.developerConfirmationStatus}
              onChange={upd("developerConfirmationStatus")}
              className={inputCls}
            >
              <option value="">—</option>
              <option value="PENDING">Pending</option>
              <option value="CONFIRMED">Confirmed</option>
            </select>
          </div>
          <div>
            <div className={labelCls}>Confirmed at (IST)</div>
            <input
              type="datetime-local"
              value={form.developerConfirmedAt}
              onChange={upd("developerConfirmedAt")}
              className={inputCls}
            />
          </div>
        </div>
      );
    case "BOOKING_DONE":
      return (
        <div className="space-y-3">
          <div>
            <div className={labelCls}>Booking done at (IST)</div>
            <input
              type="datetime-local"
              value={form.bookingDoneAt}
              onChange={upd("bookingDoneAt")}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-blue-200/60 dark:border-blue-400/20">
            <div className="sm:col-span-2 text-[11px] uppercase tracking-wider text-blue-700 dark:text-blue-300 font-bold">
              Commission
            </div>
            <div>
              <div className={labelCls}>Amount</div>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={form.commissionAmount}
                onChange={upd("commissionAmount")}
                placeholder="25000"
                className={inputCls}
              />
            </div>
            <div>
              <div className={labelCls}>Currency</div>
              <select value={form.commissionCurrency} onChange={upd("commissionCurrency")} className={inputCls}>
                <option value="AED">AED</option>
                <option value="INR">INR</option>
              </select>
            </div>
            <div>
              <div className={labelCls}>Status</div>
              <select value={form.commissionStatus} onChange={upd("commissionStatus")} className={inputCls}>
                <option value="">—</option>
                <option value="PENDING">Pending</option>
                <option value="INVOICED">Invoiced</option>
                <option value="RECEIVED">Received</option>
              </select>
            </div>
            <div>
              <div className={labelCls}>Received at (IST)</div>
              <input
                type="datetime-local"
                value={form.commissionReceivedAt}
                onChange={upd("commissionReceivedAt")}
                className={inputCls}
              />
            </div>
          </div>
        </div>
      );
  }
}
