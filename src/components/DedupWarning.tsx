"use client";
// DedupWarning — non-blocking duplicate detection UI (B-01 dedup groundwork)
//
// BEHAVIOUR:
//   • Watches ONLY the four contact fields by name:
//       phone, altPhone (hidden E.164 inputs from PhoneInput) and
//       email, altEmail (visible text inputs).
//   • It NEVER reacts to name/company/profession/city/country/project/source/
//     etc. — a change anywhere else in the form does not trigger a check
//     (task 1). Listeners are attached to the specific contact inputs, and the
//     check is additionally gated on at least one contact value being present.
//   • After the user stops typing (400 ms debounce), it hits
//     GET /api/leads/check-duplicate with whatever contact values exist.
//   • If matches are returned, shows an amber informational banner.
//   • NON-BLOCKING: purely informational; the submit button is never disabled.
//
// INTEGRATION:
//   Drop <DedupWarning formId="new-lead-form" /> anywhere INSIDE/adjacent to the
//   form. The component uses document.getElementById(formId) + querySelector to
//   find the contact inputs by name (the form is server-rendered, so refs can't
//   be passed). Safe in a Server Component page — marked "use client", no
//   server-only imports.

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

// The ONLY fields that may trigger a duplicate check. Anything else is ignored.
const CONTACT_FIELDS = ["phone", "altPhone", "email", "altEmail"] as const;

export default function DedupWarning({ formId }: DedupWarningProps) {
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    // Read the current values of the four contact fields. PhoneInput stores the
    // final E.164 value in hidden inputs name="phone"/"altPhone"; emails are
    // plain inputs name="email"/"altEmail".
    function getContactValues() {
      const val = (n: string) =>
        form!.querySelector<HTMLInputElement>(`input[name="${n}"]`)?.value?.trim() ?? "";
      return {
        phone: val("phone"),
        altPhone: val("altPhone"),
        email: val("email"),
        altEmail: val("altEmail"),
      };
    }

    async function checkDuplicates() {
      const { phone, altPhone, email, altEmail } = getContactValues();
      // GATE: only check when at least one CONTACT field is non-blank. With all
      // four empty, show nothing — never warn off non-contact fields (task 1).
      if (!phone && !altPhone && !email && !altEmail) {
        setMatches([]);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (phone) params.set("phone", phone);
        if (altPhone) params.set("altPhone", altPhone);
        if (email) params.set("email", email);
        if (altEmail) params.set("altEmail", altEmail);
        const res = await fetch(`/api/leads/check-duplicate?${params.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as { duplicates: DuplicateMatch[] };
        setMatches(data.duplicates ?? []);
      } catch {
        // Silently swallow — informational feature, never blocks the form.
      } finally {
        setLoading(false);
      }
    }

    function scheduleCheck() {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(checkDuplicates, 400);
    }

    // Attach listeners to the SPECIFIC contact inputs only — not the whole form.
    // A change/input on any other field therefore can't schedule a check.
    const watched: HTMLInputElement[] = [];
    for (const name of CONTACT_FIELDS) {
      const el = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (el) {
        el.addEventListener("change", scheduleCheck);
        el.addEventListener("input", scheduleCheck);
        watched.push(el);
      }
    }

    return () => {
      for (const el of watched) {
        el.removeEventListener("change", scheduleCheck);
        el.removeEventListener("input", scheduleCheck);
      }
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
