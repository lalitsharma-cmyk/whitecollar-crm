"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────
// Module filter for the Agent Performance report (Lalit 2026-07-06).
//   All | Leads | Master Data | Revival Engine — the 3 lead-origin modules.
// Pushes ?module=<value> (omitted for "all") and PRESERVES every other param
// (range / from / to / team / view). Thin client wrapper — the server reads the
// param back and picks which module column of the split to show. The Buyer
// section has its own market split, so this filter applies to the Lead view only.
// ─────────────────────────────────────────────────────────────────────────

const OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All modules" },
  { value: "Leads", label: "Leads" },
  { value: "Master Data", label: "Master Data" },
  { value: "Revival Engine", label: "Revival" },
];

export default function ModuleFilter({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function go(value: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (value === "all") params.delete("module");
    else params.set("module", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Module:</span>
      <div className="seg">
        {OPTIONS.map((o) => (
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
