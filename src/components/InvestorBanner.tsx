"use client";

// InvestorBanner — surfaces "this is a returning investor" prominently at the
// top of the lead detail page. Built per Lalit's 2026-06-02 ask:
// > "It should be tracked that He is a investor and then his previous
// > properties buyed, and all other details should be auto fetched, so agent
// > is able to have history."
//
// Hides itself when there's nothing investor-y to show (saves vertical real
// estate on solo first-time leads). Loads detailed history (names, dates,
// statuses) lazily on first "View full history" click — keeps SSR payload
// small and avoids leaking IDs the agent might not even need.
//
// Backend dependency: GET /api/leads/[id]/investor-history (server re-applies
// leadScopeWhere so a manager can't probe leads they shouldn't see).

import { useState } from "react";
import Link from "next/link";
import { fmtISTDate } from "@/lib/datetime";

interface MatchedLeadDetail {
  id: string;
  name: string;
  status: string;
  bookingDoneAt: string | null;
  createdAt: string;
  alreadyBought: string | null;
}

interface Props {
  /** This lead's id — used to fetch the full history. */
  leadId: string;
  categorization: string | null;
  alreadyBought: string | null;
  /** Ids of matched leads — when empty AND categorization!=Investor, banner hides. */
  matchedLeadIds: string[];
  bookingsCount: number;
}

const statusChipClass: Record<string, string> = {
  WON: "chip-won",
  BOOKING_DONE: "chip-won",
  NEGOTIATION: "chip-warm",
  QUALIFIED: "chip-warm",
  SITE_VISIT: "chip-warm",
  CONTACTED: "chip-new",
  NEW: "chip-new",
  LOST: "chip-lost",
};

export default function InvestorBanner({
  leadId,
  categorization,
  alreadyBought,
  matchedLeadIds,
  bookingsCount,
}: Props) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<MatchedLeadDetail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Hide silently when there's no investor signal AND no matches at all.
  if (categorization !== "Investor" && matchedLeadIds.length === 0) return null;

  const isInvestor = categorization === "Investor";
  const projectChips = alreadyBought
    ? alreadyBought.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  async function loadHistory() {
    if (history !== null || loading) {
      setOpen((v) => !v);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/investor-history`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { matches: MatchedLeadDetail[] };
      setHistory(data.matches);
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`mb-4 rounded-xl border p-4 shadow-sm ${
        isInvestor
          ? "border-amber-300 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100"
          : "border-blue-200 bg-blue-50"
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-bold text-[15px] text-[#0b1a33]">
          {isInvestor ? "💎 Existing investor" : "🔁 Returning contact"}
        </div>
        {matchedLeadIds.length > 0 && (
          <button
            type="button"
            onClick={loadHistory}
            className="text-xs font-semibold underline text-[#0b1a33] hover:text-amber-800"
          >
            {open ? "Hide history" : loading ? "Loading…" : "View full history"}
          </button>
        )}
      </div>

      {projectChips.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] uppercase tracking-widest text-gray-600 font-semibold mb-1.5">
            Already owns
          </div>
          <div className="flex flex-wrap gap-1.5">
            {projectChips.map((p) => (
              <span
                key={p}
                className="inline-flex items-center rounded-full border border-amber-400 bg-white px-2 py-0.5 text-xs font-medium text-amber-900"
              >
                🏢 {p}
              </span>
            ))}
          </div>
        </div>
      )}

      <ul className="mt-3 text-sm text-[#0b1a33] space-y-1">
        <li>
          <b>{bookingsCount}</b> confirmed booking{bookingsCount === 1 ? "" : "s"}
          {" · "}
          <b>{matchedLeadIds.length}</b> previous inquir
          {matchedLeadIds.length === 1 ? "y" : "ies"}
        </li>
        {isInvestor && (
          <li className="text-xs text-amber-900">
            🎯 Treat as warm — pull up old comms before first call.
          </li>
        )}
      </ul>

      {err && (
        <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {err}
        </div>
      )}

      {open && history && (
        <div className="mt-3 border-t border-amber-200 pt-3 space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-gray-600 font-semibold">
            Prior records ({history.length})
          </div>
          {history.length === 0 ? (
            <div className="text-xs text-gray-600">No accessible records in your scope.</div>
          ) : (
            history.map((m) => {
              const chipClass = statusChipClass[m.status] ?? "chip-new";
              const dateLabel = m.bookingDoneAt
                ? `Booked ${fmtISTDate(m.bookingDoneAt)}`
                : fmtISTDate(m.createdAt);
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white/80 px-2 py-1.5"
                >
                  <Link
                    href={`/leads/${m.id}`}
                    className="text-sm text-[#0b1a33] font-semibold truncate hover:underline"
                  >
                    {m.name}
                  </Link>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] text-gray-500">{dateLabel}</span>
                    <span className={`chip ${chipClass} text-[10px]`}>
                      {m.status.replaceAll("_", " ")}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
