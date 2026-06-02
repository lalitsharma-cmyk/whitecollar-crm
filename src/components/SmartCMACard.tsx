"use client";

// Smart CMA card — "Lookalike from our inventory" v1.
//
// Mounts on a lead detail page, fetches GET /api/leads/{leadId}/cma, and
// renders:
//   - Anchor unit (the lead's pinned PRIMARY interest), if any
//   - Up to 3 comparable AVAILABLE units in a horizontal/grid row, with the
//     price delta vs the anchor (e.g. "−7%", "+3%")
//   - Optional 5-line AI narrative at the bottom (only when the API returned
//     one — i.e. an AI provider is configured)
//
// Empty state: a friendly nudge + a link to /properties so the agent can
// seed more inventory if the catalogue is too thin to match anything.
//
// Loading: a skeleton matching the final layout so the right rail doesn't
// jump on first paint.

import { useEffect, useState } from "react";
import Link from "next/link";

interface ProjectLite {
  id: string;
  name: string;
  city: string;
  area: string | null;
  status: string;
}

interface UnitLite {
  id: string;
  code: string;
  configuration: string;
  carpetArea: number | null;
  priceBase: number;
  floor: number | null;
  view: string | null;
  status: string;
  project: ProjectLite;
}

interface CMAResponse {
  anchor: UnitLite | null;
  comparables: UnitLite[];
  aiNarrative?: string;
}

interface Props {
  leadId: string;
}

export default function SmartCMACard({ leadId }: Props) {
  const [data, setData] = useState<CMAResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/leads/${leadId}/cma`, {
          headers: { Accept: "application/json" },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j: CMAResponse = await r.json();
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load CMA");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (loading) return <SmartCMASkeleton />;

  if (error) {
    return (
      <div className="card p-4">
        <Header />
        <div className="text-xs text-red-600 mt-2">Could not load CMA: {error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { anchor, comparables, aiNarrative } = data;

  // Nothing matched and no anchor → empty-state nudge.
  if (!anchor && comparables.length === 0) {
    return (
      <div className="card p-4">
        <Header />
        <div className="mt-3 text-sm text-gray-600">
          Not enough inventory data to build a CMA yet.
        </div>
        <Link href="/properties" className="text-xs text-blue-600 hover:underline">
          Add more units in /properties →
        </Link>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <Header count={comparables.length} />

      {anchor && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="text-[10px] font-bold tracking-widest text-amber-700">ANCHOR</div>
          <UnitLineFull u={anchor} />
        </div>
      )}

      {comparables.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          {comparables.map((c) => (
            <ComparableCard key={c.id} comp={c} anchor={anchor} />
          ))}
        </div>
      )}

      {aiNarrative && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          <div className="text-[10px] font-bold tracking-widest text-gray-500 mb-1">AI READ</div>
          <p className="text-xs italic text-gray-700 whitespace-pre-line leading-snug">
            {aiNarrative}
          </p>
        </div>
      )}
    </div>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-base">🏠</span>
        <span className="text-xs font-bold tracking-widest text-gray-600">
          SMART CMA — {count != null ? `${count} LOOKALIKE UNIT${count === 1 ? "" : "S"}` : "3 LOOKALIKE UNITS"}
        </span>
      </div>
    </div>
  );
}

function ComparableCard({ comp, anchor }: { comp: UnitLite; anchor: UnitLite | null }) {
  const delta =
    anchor && anchor.priceBase > 0
      ? Math.round(((comp.priceBase - anchor.priceBase) / anchor.priceBase) * 100)
      : null;
  const deltaLabel =
    delta == null
      ? null
      : delta === 0
      ? "±0%"
      : delta > 0
      ? `+${delta}%`
      : `${delta}%`;
  const deltaClass =
    delta == null
      ? "text-gray-500"
      : delta > 0
      ? "text-red-600"
      : delta < 0
      ? "text-emerald-700"
      : "text-gray-600";

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold text-gray-900">{comp.project.name}</div>
          <div className="truncate text-[11px] text-gray-500">
            {comp.code} · {comp.configuration}
          </div>
        </div>
        {deltaLabel && (
          <span className={`shrink-0 text-[11px] font-semibold ${deltaClass}`}>
            {deltaLabel}
          </span>
        )}
      </div>
      <div className="mt-2 text-[11px] text-gray-700">{fmtAED(comp.priceBase)}</div>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-gray-500">
        {comp.carpetArea ? <span>{Math.round(comp.carpetArea)} sqft</span> : null}
        {comp.floor != null ? <span>Floor {comp.floor}</span> : null}
        {comp.view ? <span className="truncate max-w-[120px]">{comp.view}</span> : null}
      </div>
    </div>
  );
}

function UnitLineFull({ u }: { u: UnitLite }) {
  return (
    <div className="mt-1 text-xs text-gray-800">
      <div className="font-semibold text-gray-900">
        {u.project.name} <span className="text-gray-500 font-normal">· {u.code}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
        <span>{u.configuration}</span>
        {u.carpetArea ? <span>{Math.round(u.carpetArea)} sqft</span> : null}
        <span className="font-semibold text-gray-900">{fmtAED(u.priceBase)}</span>
        {u.floor != null ? <span>Floor {u.floor}</span> : null}
        {u.view ? <span>{u.view}</span> : null}
      </div>
    </div>
  );
}

function SmartCMASkeleton() {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 rounded bg-gray-200 animate-pulse" />
        <div className="h-3 w-44 rounded bg-gray-200 animate-pulse" />
      </div>
      <div className="mt-3 h-14 rounded-md bg-gray-100 animate-pulse" />
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="h-20 rounded-md bg-gray-100 animate-pulse" />
        <div className="h-20 rounded-md bg-gray-100 animate-pulse" />
        <div className="h-20 rounded-md bg-gray-100 animate-pulse" />
      </div>
    </div>
  );
}

// Lightweight AED formatter (matches the convention in src/lib/money.ts but
// inline so this client component doesn't pull a server-only module).
function fmtAED(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e9) return `AED ${(v / 1e9).toFixed(2)} B`;
  if (v >= 1e6) return `AED ${(v / 1e6).toFixed(1)} M`;
  if (v >= 1e3) return `AED ${(v / 1e3).toFixed(0)} K`;
  return `AED ${v.toLocaleString()}`;
}
