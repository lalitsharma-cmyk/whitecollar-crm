"use client";
// DedupWarning — non-blocking duplicate detection UI (B-01 dedup groundwork)
//
// BEHAVIOUR:
//   • Listens for "change" events on the phone hidden input (name="phone") and
//     the email input (name="email") within the nearest ancestor <form>.
//   • After the user stops typing (400 ms debounce), hits GET /api/leads/check-duplicate.
//   • If matches are returned, shows an amber informational banner:
//       "⚠ Possible duplicate of <name> (<STATUS> · owner <ownerName>)"
//   • NON-BLOCKING: the banner is purely informational. The submit button
//     is not disabled; the user can proceed and create the lead anyway.
//
// INTEGRATION:
//   Drop <DedupWarning formId="new-lead-form" /> anywhere INSIDE the form
//   (or adjacent to it). The component uses document.querySelector to find the
//   relevant inputs by name within document scope (the form is server-rendered
//   so we can't pass refs).
//
// IMPORTANT: this component is safe to render inside a Next.js Server Component
// page — it is marked "use client" and has no server-only imports.

import { useEffect, useRef, useState } from "react";
import type { DuplicateMatch } from "@/app/api/leads/check-duplicate/route";

interface DedupWarningProps {
  /** The id= attribute on the <form> element to watch. */
  formId: string;
}

const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  SITE_VISIT: "Site visit",
  NEGOTIATION: "Negotiation",
  BOOKING_DONE: "Booking done",
  WON: "Won",
  LOST: "Lost",
};

export default function DedupWarning({ formId }: DedupWarningProps) {
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // We need to find the form AFTER it mounts.  The component renders adjacent
    // to the form in the server-rendered page, so the form is in the DOM.
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    // The PhoneInput component stores the final E.164 value in a hidden input
    // with name="phone".  Plain text inputs use name="email".
    function getValues() {
      const phoneInput = form!.querySelector<HTMLInputElement>('input[name="phone"]');
      const emailInput = form!.querySelector<HTMLInputElement>('input[name="email"]');
      return {
        phone: phoneInput?.value?.trim() ?? "",
        email: emailInput?.value?.trim() ?? "",
      };
    }

    async function checkDuplicates() {
      const { phone, email } = getValues();
      if (!phone && !email) {
        setMatches([]);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (phone) params.set("phone", phone);
        if (email) params.set("email", email);
        const res = await fetch(`/api/leads/check-duplicate?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json() as { duplicates: DuplicateMatch[] };
        setMatches(data.duplicates ?? []);
      } catch {
        // Silently swallow — this is an informational feature, never block the form.
      } finally {
        setLoading(false);
      }
    }

    function scheduleCheck() {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(checkDuplicates, 400);
    }

    // Listen on the whole form — catches both the hidden phone input and the
    // visible email input without attaching to each individually.
    form.addEventListener("change", scheduleCheck);
    form.addEventListener("input", scheduleCheck);

    return () => {
      form.removeEventListener("change", scheduleCheck);
      form.removeEventListener("input", scheduleCheck);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [formId]);

  if (!loading && matches.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 space-y-1"
    >
      {loading && matches.length === 0 ? (
        <span className="text-amber-600 text-xs">Checking for duplicates…</span>
      ) : (
        <>
          <div className="font-semibold text-amber-700 flex items-center gap-1.5">
            ⚠ Possible duplicate{matches.length > 1 ? "s" : ""} detected — you can still create this lead
          </div>
          <ul className="space-y-0.5 text-xs">
            {matches.map((m) => (
              <li key={m.id} className="flex items-center gap-1.5 flex-wrap">
                <a
                  href={`/leads/${m.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline hover:text-amber-900"
                >
                  {m.name}
                </a>
                <span className="text-amber-600">
                  ({STATUS_LABEL[m.status] ?? m.status}
                  {m.ownerName ? ` · owner ${m.ownerName}` : " · unassigned"})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
