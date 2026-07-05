"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────
// Lead / Buyer / Combined view toggle for the Agent Performance report
// (Lalit 2026-07-06 — PARALLEL sections). Pushes ?view=<value> (omitted for the
// default "lead") and preserves every other param. The server renders:
//   • lead      → the Lead performance section (module-bifurcated).
//   • buyer     → the Buyer Data parallel section (Dubai + India), buyer metrics.
//   • combined  → both sections stacked (two parallel sections, not merged).
// Options are gated by access (a user with no buyer-market access only sees Lead).
// ─────────────────────────────────────────────────────────────────────────

export default function ReportViewToggle({
  current,
  showBuyer,
}: {
  current: "lead" | "buyer" | "combined";
  /** Whether the user can see ANY buyer market — hides Buyer/Combined otherwise. */
  showBuyer: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function go(value: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (value === "lead") params.delete("view");
    else params.set("view", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  const options: Array<{ value: "lead" | "buyer" | "combined"; label: string }> = showBuyer
    ? [
        { value: "lead", label: "🧲 Leads" },
        { value: "buyer", label: "🏷️ Buyer Data" },
        { value: "combined", label: "🔀 Combined" },
      ]
    : [{ value: "lead", label: "🧲 Leads" }];

  if (!showBuyer) return null; // nothing to toggle — Lead is the only view

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">View:</span>
      <div className="seg">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => go(o.value)}
            className={current === o.value ? "on" : ""}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
