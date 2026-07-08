"use client";
// Floating "+" quick-add-lead button (FAB).
//
// Goal (Lalit): capture a lead in 2 taps from ANY page — tap the "+", type the
// name + phone, hit Save. Everything else is optional.
//
// It REUSES the exact same create path as the full /leads/new form: the
// `quickCreateLeadAction` server action (exported from that page) calls
// `ingestLead()` — the single source of truth for lead creation (dedupe,
// default follow-up, SLA, notifications, workflows). The only difference is it
// collects the essentials, sends sensible defaults for the rest, and returns
// JSON ({ ok, leadId }) instead of redirecting so we can show a toast + an
// "Open lead" link + an "Add another" reset without leaving the page.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { quickCreateLeadAction } from "@/app/(app)/leads/new/actions";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
// Shared source list — same allow-list the New-Lead form uses, so quick-add can't
// re-offer the deprecated WhatsApp/Inbound-Call/Event values (channel → Medium).
import { allowedSourceOptions } from "@/lib/lead-sources";
import { backdropProps } from "@/lib/useDismiss";

type Result = { ok: boolean; leadId?: string; error?: string };

export default function QuickAddLeadFab() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ leadId: string } | null>(null);

  // Lock background scroll while the sheet is open (same hook the shell drawer
  // and other modals use — keeps the page from shifting under the modal).
  useBodyScrollLock(open);

  const canSubmit = name.trim().length > 0 && phone.trim().length > 0 && !pending;

  function reset() {
    setName("");
    setPhone("");
    setError(null);
    setSuccess(null);
    formRef.current?.reset();
  }

  function close() {
    setOpen(false);
    // Defer the reset so the closing modal doesn't flash empty fields.
    setTimeout(reset, 200);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      let res: Result;
      try {
        res = await quickCreateLeadAction(null, fd);
      } catch {
        setError("Something went wrong. Please try again.");
        return;
      }
      if (res.ok && res.leadId) {
        setSuccess({ leadId: res.leadId });
      } else {
        setError(res.error ?? "Could not add lead.");
      }
    });
  }

  return (
    <>
      {/* ── Floating + button ──
          Sits bottom-right, ABOVE the mobile bottom nav (4rem) + iPhone home
          indicator safe area. z-40 so it tucks under modals/overlays (z-50+).
          On desktop there's no bottom nav, so we tighten the offset via lg:. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Quick add lead"
          className="fixed right-4 z-40 flex items-center justify-center w-14 h-14 rounded-full bg-[#c9a24b] text-[#0b1a33] shadow-xl hover:brightness-105 active:scale-95 transition lg:bottom-6"
          style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
        >
          <Plus className="w-7 h-7" strokeWidth={2.5} />
        </button>
      )}

      {/* ── Modal ── z-50 so it sits over the FAB + shell, under QuickSearch. */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
          {...backdropProps(close)}
          role="dialog"
          aria-modal="true"
          aria-label="Quick add lead"
        >
          <div
            className="w-full sm:w-[92vw] sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl border-2 border-[#c9a24b] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-[#0b1a33] text-white">
              <span className="font-bold text-sm">⚡ Quick add lead</span>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="p-1.5 rounded hover:bg-white/10 min-w-9 min-h-9 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto px-4 py-4">
              {success ? (
                // ── Success state: toast-style confirmation + next actions ──
                <div className="text-center py-4 space-y-4">
                  <div className="text-lg font-semibold text-emerald-600">✅ Lead added</div>
                  <p className="text-sm text-gray-500">What next?</p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const id = success.leadId;
                        close();
                        router.push(`/leads/${id}`);
                      }}
                      className="btn btn-primary justify-center"
                    >
                      Open lead →
                    </button>
                    <button
                      type="button"
                      onClick={reset}
                      className="btn btn-ghost justify-center"
                    >
                      + Add another
                    </button>
                  </div>
                </div>
              ) : (
                <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">👤 Name *</label>
                    <input
                      name="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      placeholder="Customer name"
                      className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-600">📞 Phone *</label>
                    <input
                      name="phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      type="tel"
                      inputMode="tel"
                      placeholder="+971 50 123 4567 / +91 98765 43210"
                      className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Include the country code (+971 Dubai · +91 India) so WhatsApp &amp; call work.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-600">Team</label>
                      <select
                        name="forwardedTeam"
                        defaultValue="Dubai"
                        className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="Dubai">Dubai (AED)</option>
                        <option value="India">India (₹)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600">Source</label>
                      <select
                        name="source"
                        defaultValue="OTHER"
                        className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
                      >
                        {allowedSourceOptions().map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-600">💰 Budget (optional)</label>
                    <input
                      name="budget"
                      placeholder="e.g. 2.5M · 500K · 3Cr · 30L"
                      className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-600">📝 Remarks (optional)</label>
                    <textarea
                      name="remarks"
                      rows={3}
                      placeholder="Who is the client? What do they want? Capture the situation, not keywords."
                      className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  {error && (
                    <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      ⚠ {error}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={close}
                      className="btn btn-ghost flex-1 justify-center"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="btn btn-primary flex-1 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {pending ? "Saving…" : "Save lead"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
