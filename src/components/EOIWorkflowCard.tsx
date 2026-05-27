"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, AlertTriangle, Clock, ShieldCheck, ChevronRight } from "lucide-react";
import { fmtIST12 } from "@/lib/datetime";
import { showCelebration } from "./DealCelebration";

// ── EOI / Booking workflow card ──
//
// Renders the 8-step booking funnel for a single Lead. Each step shows
// whether it's been completed (check + date) or is pending. Below the
// stepper sits an inline editor for the CURRENT stage's fields and an
// "Advance to next stage" button that stamps the relevant *At column
// and bumps eoiStage on the server.
//
// All mutations hit PATCH /api/leads/[id]/eoi which validates enums and
// auto-stamps timestamps on status transitions.

const STAGES = [
  { key: "EOI_DISCUSSED",          label: "EOI Discussed",           short: "Discussed" },
  { key: "EOI_COLLECTED",          label: "EOI Collected",           short: "Collected" },
  { key: "KYC_PENDING",            label: "KYC",                     short: "KYC" },
  { key: "BOOKING_FORM_SENT",      label: "Booking Form Sent",       short: "Form Sent" },
  { key: "BOOKING_FORM_SIGNED",    label: "Booking Form Signed",     short: "Form Signed" },
  { key: "PAYMENT_PROOF_RECEIVED", label: "Payment Proof Received",  short: "Pay Proof" },
  { key: "DEVELOPER_CONFIRMATION", label: "Developer Confirmation",  short: "Dev Conf." },
  { key: "BOOKING_DONE",           label: "Booking Done",             short: "Booked" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

// All EOI / booking columns the card reads or writes. Mirrors the Prisma
// schema's "EOI / Booking workflow" section. Kept as a local interface so the
// card doesn't depend on the generated Prisma type (which would require the
// parent to pull a giant object across the server→client boundary).
export interface EOILead {
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
  lead: EOILead;
  // Optional display name used by the booking-done celebration. Safe to
  // omit — falls back to a generic message.
  leadName?: string;
}

const stageIndex = (s: string | null): number => {
  if (!s) return -1;
  return STAGES.findIndex((st) => st.key === s);
};

// Each stage maps to ONE optional completion timestamp. Used to render the
// little date stamp under each completed step.
function completionAt(stage: StageKey, lead: EOILead): Date | string | null {
  switch (stage) {
    case "EOI_DISCUSSED":          return null; // no dedicated *At — completion implied by stage > 0
    case "EOI_COLLECTED":          return lead.eoiCollectedAt;
    case "KYC_PENDING":            return lead.kycReceivedAt;
    case "BOOKING_FORM_SENT":      return lead.bookingFormSentAt;
    case "BOOKING_FORM_SIGNED":    return lead.bookingFormSignedAt;
    case "PAYMENT_PROOF_RECEIVED": return lead.paymentProofReceivedAt;
    case "DEVELOPER_CONFIRMATION": return lead.developerConfirmedAt;
    case "BOOKING_DONE":           return lead.bookingDoneAt;
    default:                        return null;
  }
}

const fmt = (d: Date | string | null): string | null => (d ? `${fmtIST12(d)} IST` : null);

const fieldLabel = "text-[11px] uppercase tracking-wider text-gray-500 font-semibold";
const inputCls = "w-full border border-[color:var(--border,#e5e7eb)] rounded-lg px-3 py-2 text-sm bg-white text-gray-900 dark:bg-[#0b1a33]/40 dark:text-gray-100 dark:border-white/10";

export default function EOIWorkflowCard({ lead, leadName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const currentIdx = stageIndex(lead.eoiStage);
  // If the lead is in NEGOTIATION but no eoiStage is set yet, treat
  // "EOI_DISCUSSED" as the implicit starting stage — agents shouldn't need to
  // click anything to begin filling EOI fields.
  const effectiveStage: StageKey =
    (lead.eoiStage as StageKey | null) ?? "EOI_DISCUSSED";
  const effectiveIdx = currentIdx === -1 ? 0 : currentIdx;

  // ── Editable form state — local per-stage. Resets on prop change via
  // useMemo seed, then mutated by inputs. Persist on Save click. ──
  const [form, setForm] = useState(() => seedForm(lead));

  // ── Derived alerts ──
  const alerts = useMemo(() => deriveAlerts(lead), [lead]);

  async function patch(payload: Record<string, unknown>, successAction?: () => void) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/leads/${lead.id}/eoi`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Save failed (${r.status})`);
        return;
      }
      successAction?.();
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrentStage() {
    const payload = collectStagePayload(effectiveStage, form, lead);
    if (!Object.keys(payload).length) {
      setErr("Nothing changed.");
      return;
    }
    // If lead is in NEGOTIATION with no eoiStage set, also stamp EOI_DISCUSSED
    // as the starting point so the stepper renders the first dot as active.
    if (!lead.eoiStage) {
      payload.eoiStage = "EOI_DISCUSSED";
    }
    await patch(payload);
  }

  async function advanceStage() {
    const next = STAGES[effectiveIdx + 1];
    if (!next) return;
    if (lead.eoiApprovalRequired && !lead.eoiApprovedAt) {
      setErr("Approval required before advancing. Ask a manager to sign off.");
      return;
    }
    // Fire the big celebration when the agent advances INTO booking_done —
    // this is the milestone Lalit wants to feel rewarding. We trigger from
    // the successAction callback so it only plays after the PATCH succeeds.
    const isBookingDone = next.key === "BOOKING_DONE";
    await patch({ eoiStage: next.key }, () => {
      if (isBookingDone) {
        showCelebration({
          kind: "booking_done",
          message: `Booking done — ${leadName ?? "client confirmed"}`,
        });
      }
    });
  }

  async function toggleApproval(value: boolean) {
    await patch({ eoiApprovalRequired: value });
  }

  async function saveNotes(notes: string) {
    await patch({ eoiNotes: notes });
  }

  const nextStage = STAGES[effectiveIdx + 1];
  const isWon = lead.eoiStage === "BOOKING_DONE";

  return (
    <div className="card p-5 border-l-4 border-[#c9a24b]">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="font-semibold text-base flex items-center gap-2">
            🏷 EOI / Booking workflow
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            10-step funnel from EOI discussion to commission received
          </div>
        </div>
        {lead.eoiApprovedAt && (
          <span className="chip chip-won text-[11px] inline-flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Approved {fmt(lead.eoiApprovedAt)}
          </span>
        )}
      </div>

      {/* ── ALERTS ── */}
      {alerts.map((a) => (
        <div
          key={a.id}
          className={`p-2.5 rounded-lg border-l-4 mb-2 text-xs flex items-start gap-2 ${a.tone}`}
        >
          {a.icon}
          <div className="flex-1">{a.text}</div>
        </div>
      ))}

      {/* ── STEPPER ──
          Horizontal scroll on mobile so all 8 dots stay one line.
          Each dot: filled gold for completed, ring for active, grey for upcoming. */}
      <div className="overflow-x-auto -mx-2 px-2 mb-4">
        <ol className="flex items-center gap-1 min-w-max">
          {STAGES.map((s, i) => {
            const done = i < effectiveIdx;
            const active = i === effectiveIdx;
            const at = completionAt(s.key, lead);
            return (
              <li key={s.key} className="flex items-center gap-1">
                <div className="flex flex-col items-center min-w-[68px] text-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-sm transition-colors ${
                      done
                        ? "bg-emerald-500 text-white"
                        : active
                        ? "bg-[#c9a24b] text-[#0b1a33] ring-4 ring-[#c9a24b]/25"
                        : "bg-gray-200 text-gray-500 dark:bg-white/10 dark:text-gray-400"
                    }`}
                    title={s.label}
                  >
                    {done ? <Check className="w-4 h-4" /> : i + 1}
                  </div>
                  <div className={`text-[10px] mt-1 font-semibold leading-tight ${active ? "text-[#0b1a33] dark:text-amber-200" : "text-gray-600 dark:text-gray-400"}`}>
                    {s.short}
                  </div>
                  {at && done && (
                    <div className="text-[9px] text-gray-500 mt-0.5 leading-tight">
                      {fmt(at)?.replace(" IST", "")}
                    </div>
                  )}
                </div>
                {i < STAGES.length - 1 && (
                  <div className={`h-0.5 w-4 sm:w-6 ${i < effectiveIdx ? "bg-emerald-400" : "bg-gray-200 dark:bg-white/10"}`} />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── CURRENT STAGE EDITOR ── */}
      <div className="rounded-lg border border-[#e5e7eb] dark:border-white/10 p-3 bg-amber-50/40 dark:bg-white/[0.02]">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="font-semibold text-sm flex items-center gap-2">
            <ChevronRight className="w-4 h-4 text-[#c9a24b]" />
            Current: {STAGES[effectiveIdx]?.label}
          </div>
          {!isWon && nextStage && (
            <button
              onClick={advanceStage}
              disabled={busy || (lead.eoiApprovalRequired && !lead.eoiApprovedAt)}
              className="btn btn-primary text-xs disabled:opacity-50"
              title={lead.eoiApprovalRequired && !lead.eoiApprovedAt ? "Approval required first" : `Advance to ${nextStage.label}`}
            >
              {busy ? "…" : `Advance → ${nextStage.short}`}
            </button>
          )}
          {isWon && (
            <span className="chip chip-won text-[11px]">🎉 Booking complete</span>
          )}
        </div>

        <StageEditor stage={effectiveStage} form={form} setForm={setForm} />

        {/* Save button — only shown when the current stage actually has editable fields */}
        {hasEditableFields(effectiveStage) && (
          <div className="flex justify-end mt-3">
            <button
              onClick={saveCurrentStage}
              disabled={busy}
              className="btn btn-ghost text-xs"
            >
              {busy ? "Saving…" : "Save stage fields"}
            </button>
          </div>
        )}
      </div>

      {/* ── NOTES ── */}
      <div className="mt-4">
        <div className={fieldLabel}>EOI notes (discounts, waivers, special terms)</div>
        <NotesEditor initial={lead.eoiNotes ?? ""} onSave={saveNotes} busy={busy} />
      </div>

      {/* ── APPROVAL TOGGLE ── */}
      <div className="mt-4 flex items-center justify-between gap-3 p-3 rounded-lg border border-[#e5e7eb] dark:border-white/10">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-600" />
            Approval required
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            Toggle on when a discount / waiver needs a manager sign-off before booking proceeds.
          </div>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={lead.eoiApprovalRequired}
            onChange={(e) => toggleApproval(e.target.checked)}
            disabled={busy}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 dark:bg-white/10 peer-checked:bg-[#c9a24b] rounded-full peer transition-colors relative">
            <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
          </div>
        </label>
      </div>

      {err && (
        <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-none" /> {err}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

interface FormState {
  eoiAmount: string;
  eoiCurrency: string;
  eoiPaymentMethod: string;
  kycStatus: string;
  bookingFormStatus: string;
  paymentProofStatus: string;
  developerConfirmationStatus: string;
  bookingFormSignedAt: string; // datetime-local input value (IST wall-clock)
  commissionAmount: string;
  commissionCurrency: string;
  commissionStatus: string;
}

function seedForm(lead: EOILead): FormState {
  // Convert stored UTC date → IST wall-clock for the datetime-local input.
  const toLocal = (d: Date | string | null): string => {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (isNaN(dt.getTime())) return "";
    const ist = new Date(dt.getTime() + 330 * 60_000);
    return ist.toISOString().slice(0, 16);
  };
  return {
    eoiAmount: lead.eoiAmount != null ? String(lead.eoiAmount) : "",
    eoiCurrency: lead.eoiCurrency ?? "AED",
    eoiPaymentMethod: lead.eoiPaymentMethod ?? "",
    kycStatus: lead.kycStatus ?? "",
    bookingFormStatus: lead.bookingFormStatus ?? "",
    paymentProofStatus: lead.paymentProofStatus ?? "",
    developerConfirmationStatus: lead.developerConfirmationStatus ?? "",
    bookingFormSignedAt: toLocal(lead.bookingFormSignedAt),
    commissionAmount: lead.commissionAmount != null ? String(lead.commissionAmount) : "",
    commissionCurrency: lead.commissionCurrency ?? "AED",
    commissionStatus: lead.commissionStatus ?? "",
  };
}

function hasEditableFields(stage: StageKey): boolean {
  return stage !== "EOI_COLLECTED"; // EOI_COLLECTED has no inline fields — date is auto-stamped on transition.
}

// Pulls just the fields owned by the current stage and converts them to
// the payload shape PATCH expects (numbers / dates / strings, with empties
// → null to clear).
function collectStagePayload(stage: StageKey, form: FormState, lead: EOILead): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const setIfChanged = (key: string, val: unknown, current: unknown) => {
    // normalise empty → null for comparison
    const a = val === "" ? null : val;
    const b = current === "" || current === undefined ? null : current;
    if (a !== b) out[key] = a;
  };
  switch (stage) {
    case "EOI_DISCUSSED":
      setIfChanged("eoiAmount", form.eoiAmount === "" ? null : Number(form.eoiAmount), lead.eoiAmount);
      setIfChanged("eoiCurrency", form.eoiCurrency, lead.eoiCurrency);
      setIfChanged("eoiPaymentMethod", form.eoiPaymentMethod, lead.eoiPaymentMethod);
      break;
    case "EOI_COLLECTED":
      // No editable inputs — completion is reflected by eoiCollectedAt which is
      // auto-stamped on the eoiStage transition.
      break;
    case "KYC_PENDING":
      setIfChanged("kycStatus", form.kycStatus, lead.kycStatus);
      break;
    case "BOOKING_FORM_SENT":
      setIfChanged("bookingFormStatus", form.bookingFormStatus, lead.bookingFormStatus);
      break;
    case "BOOKING_FORM_SIGNED":
      if (form.bookingFormSignedAt) {
        // Treat input as IST wall-clock → UTC instant for the server.
        const isoUtc = new Date(`${form.bookingFormSignedAt}:00+05:30`).toISOString();
        if (!lead.bookingFormSignedAt || new Date(isoUtc).getTime() !== new Date(lead.bookingFormSignedAt).getTime()) {
          out.bookingFormSignedAt = isoUtc;
        }
      }
      break;
    case "PAYMENT_PROOF_RECEIVED":
      setIfChanged("paymentProofStatus", form.paymentProofStatus, lead.paymentProofStatus);
      break;
    case "DEVELOPER_CONFIRMATION":
      setIfChanged("developerConfirmationStatus", form.developerConfirmationStatus, lead.developerConfirmationStatus);
      break;
    case "BOOKING_DONE":
      setIfChanged("commissionAmount", form.commissionAmount === "" ? null : Number(form.commissionAmount), lead.commissionAmount);
      setIfChanged("commissionCurrency", form.commissionCurrency, lead.commissionCurrency);
      setIfChanged("commissionStatus", form.commissionStatus, lead.commissionStatus);
      break;
  }
  return out;
}

// Per-stage editor — small chunk of JSX per stage. Field labels mirror the
// Prisma columns one-to-one for predictability.
function StageEditor({
  stage,
  form,
  setForm,
}: {
  stage: StageKey;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  const update = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  switch (stage) {
    case "EOI_DISCUSSED":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className={fieldLabel}>EOI amount</div>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={form.eoiAmount}
              onChange={update("eoiAmount")}
              placeholder="e.g. 50000"
              className={inputCls}
            />
          </div>
          <div>
            <div className={fieldLabel}>Currency</div>
            <select value={form.eoiCurrency} onChange={update("eoiCurrency")} className={inputCls}>
              <option value="AED">AED</option>
              <option value="INR">INR</option>
            </select>
          </div>
          <div>
            <div className={fieldLabel}>Payment method</div>
            <select value={form.eoiPaymentMethod} onChange={update("eoiPaymentMethod")} className={inputCls}>
              <option value="">—</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="CARD">Card</option>
              <option value="CHEQUE">Cheque</option>
              <option value="CASH">Cash</option>
            </select>
          </div>
        </div>
      );
    case "EOI_COLLECTED":
      return (
        <p className="text-xs text-gray-600 dark:text-gray-300">
          EOI marked as collected. The collected date is stamped automatically when this stage is reached.
          Advance once KYC documents have been requested from the client.
        </p>
      );
    case "KYC_PENDING":
      return (
        <div>
          <div className={fieldLabel}>KYC status</div>
          <select value={form.kycStatus} onChange={update("kycStatus")} className={inputCls}>
            <option value="">—</option>
            <option value="PENDING">Pending — waiting on client</option>
            <option value="DOCS_RECEIVED">Docs received</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      );
    case "BOOKING_FORM_SENT":
      return (
        <div>
          <div className={fieldLabel}>Booking form status</div>
          <select value={form.bookingFormStatus} onChange={update("bookingFormStatus")} className={inputCls}>
            <option value="">—</option>
            <option value="NOT_SENT">Not sent</option>
            <option value="SENT">Sent to client</option>
            <option value="SIGNED">Signed</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      );
    case "BOOKING_FORM_SIGNED":
      return (
        <div>
          <div className={fieldLabel}>Signed at (IST)</div>
          <input
            type="datetime-local"
            value={form.bookingFormSignedAt}
            onChange={update("bookingFormSignedAt")}
            className={inputCls}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Leave blank and advance the stage — we'll stamp the current time automatically.
          </p>
        </div>
      );
    case "PAYMENT_PROOF_RECEIVED":
      return (
        <div>
          <div className={fieldLabel}>Payment proof status</div>
          <select value={form.paymentProofStatus} onChange={update("paymentProofStatus")} className={inputCls}>
            <option value="">—</option>
            <option value="PENDING">Pending</option>
            <option value="RECEIVED">Received</option>
            <option value="VERIFIED">Verified</option>
          </select>
        </div>
      );
    case "DEVELOPER_CONFIRMATION":
      return (
        <div>
          <div className={fieldLabel}>Developer confirmation</div>
          <select value={form.developerConfirmationStatus} onChange={update("developerConfirmationStatus")} className={inputCls}>
            <option value="">—</option>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
          </select>
        </div>
      );
    case "BOOKING_DONE":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className={fieldLabel}>Commission amount</div>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={form.commissionAmount}
              onChange={update("commissionAmount")}
              placeholder="e.g. 25000"
              className={inputCls}
            />
          </div>
          <div>
            <div className={fieldLabel}>Currency</div>
            <select value={form.commissionCurrency} onChange={update("commissionCurrency")} className={inputCls}>
              <option value="AED">AED</option>
              <option value="INR">INR</option>
            </select>
          </div>
          <div>
            <div className={fieldLabel}>Commission status</div>
            <select value={form.commissionStatus} onChange={update("commissionStatus")} className={inputCls}>
              <option value="">—</option>
              <option value="PENDING">Pending</option>
              <option value="INVOICED">Invoiced</option>
              <option value="RECEIVED">Received</option>
            </select>
          </div>
        </div>
      );
  }
}

// ── Notes editor (controlled local state, batch save) ──
function NotesEditor({
  initial,
  onSave,
  busy,
}: {
  initial: string;
  onSave: (v: string) => Promise<void> | void;
  busy: boolean;
}) {
  const [v, setV] = useState(initial);
  const dirty = v !== initial;
  return (
    <div>
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        rows={3}
        placeholder="e.g. 5% discount agreed verbally, waived processing fee, alt-investor cleared cheque..."
        className={`${inputCls} font-mono text-[12px] leading-relaxed mt-1`}
      />
      {dirty && (
        <div className="flex justify-end mt-1">
          <button
            onClick={() => onSave(v)}
            disabled={busy}
            className="btn btn-ghost text-xs"
          >
            {busy ? "Saving…" : "Save notes"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Alert derivation ─────────────────────────────────────────────────
interface Alert {
  id: string;
  tone: string;
  icon: React.ReactNode;
  text: React.ReactNode;
}

function deriveAlerts(lead: EOILead): Alert[] {
  const alerts: Alert[] = [];

  if (lead.eoiApprovalRequired && !lead.eoiApprovedAt) {
    alerts.push({
      id: "approval",
      tone: "border-amber-500 bg-amber-50 text-amber-900",
      icon: <Clock className="w-4 h-4 flex-none mt-0.5" />,
      text: <>⏳ Awaiting admin approval — flag a manager to sign off before advancing.</>,
    });
  }

  if (lead.kycStatus === "PENDING" && lead.bookingFormStatus === "SENT") {
    alerts.push({
      id: "kyc-premature",
      tone: "border-orange-500 bg-orange-50 text-orange-900",
      icon: <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />,
      text: <>⚠ KYC missing — booking form was sent before KYC docs were received. Chase the client for ID.</>,
    });
  }

  if (
    lead.paymentProofStatus === "PENDING" &&
    !lead.bookingDoneAt &&
    lead.eoiCollectedAt
  ) {
    const collected = typeof lead.eoiCollectedAt === "string" ? new Date(lead.eoiCollectedAt) : lead.eoiCollectedAt;
    const daysSince = (Date.now() - collected.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince >= 3) {
      alerts.push({
        id: "payment-overdue",
        tone: "border-red-500 bg-red-50 text-red-900",
        icon: <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />,
        text: <>⚠ Payment proof overdue — {Math.floor(daysSince)} day{Math.floor(daysSince) === 1 ? "" : "s"} since EOI was collected and no proof yet.</>,
      });
    }
  }

  return alerts;
}
