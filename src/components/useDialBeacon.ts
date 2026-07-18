"use client";

// ────────────────────────────────────────────────────────────────────────────
// useDialBeacon — the ONE way a Call affordance tells the CRM a dial happened.
//
// THE PROBLEM IT SOLVES (Lalit P0, 2026-07-18)
// Every "Call" button in the CRM is a plain `tel:` link. Tapping it hands the
// number to the phone's dialer and records NOTHING — a call only ever appeared
// in the CRM if the agent later remembered to fill the Log-Call form. Attach
// this hook and the same tap also writes a CallLog at outcome=INITIATED, so the
// dial is visible in Call Logs immediately.
//
// USAGE — the onClick is all there is to it:
//
//   const dial = useDialBeacon();
//
//   <a href={telLink(phone)} onClick={dial({ leadId })}>Call</a>
//   <ActionIconButton action="call" href={tel} onClick={dial({ leadId: l.id })} />
//   <ActionButton action="call" href={tel}
//     onClick={dial({ leadId: l.id }, { stopPropagation: true })} />   // inside a clickable row
//   <ActionButton action="call" href={telLink(alt)}
//     onClick={dial({ buyerId, phone: alt })} />                        // alt number
//
// ── NON-NEGOTIABLE BEHAVIOUR ────────────────────────────────────────────────
//   • NEVER blocks the dial. No preventDefault, no await, no throw. The `tel:`
//     navigation proceeds exactly as before; the beacon rides alongside it.
//   • SURVIVES the navigation. navigator.sendBeacon is built for precisely this
//     (the browser owns the request after the page is gone). Where it is
//     unavailable or refuses the payload, we fall back to fetch({keepalive}).
//   • SWALLOWS EVERYTHING. Any failure is silent — a bookkeeping problem must
//     never surface to an agent who is trying to make a phone call.
//
// The row this creates is PENDING (INITIATED). When the agent logs the call,
// resolveOrCreateCall() transitions THAT row instead of creating another —
// one dial = one CallLog row. See src/lib/callLogService.ts for the contract.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback } from "react";
import type { MouseEvent } from "react";

/** Which record was dialled. Exactly one of leadId / buyerId. */
export interface DialTarget {
  /** Lead, Master Data, Revival / cold-call record — all are Lead rows. */
  leadId?: string | null;
  /** Buyer Data record (Dubai / India). */
  buyerId?: string | null;
  /** The exact number tapped. Only needed for an ALT number — otherwise the
   *  server resolves the record's primary number itself (and prefers it). */
  phone?: string | null;
}

export interface DialOptions {
  /** Stop the click bubbling to a clickable table row / card wrapper. */
  stopPropagation?: boolean;
  /** Extra handler to run alongside the beacon (runs first, errors swallowed). */
  onClick?: (e: MouseEvent<HTMLElement>) => void;
}

const DIAL_ENDPOINT = "/api/calls/dial";

/**
 * Fire the beacon. Returns immediately; the request outlives the page if the
 * `tel:` handoff tears it down. Never throws.
 */
export function sendDialBeacon(target: DialTarget): void {
  try {
    if (!target.leadId && !target.buyerId) return;
    const payload = JSON.stringify({
      leadId: target.leadId ?? undefined,
      buyerId: target.buyerId ?? undefined,
      phone: target.phone ?? undefined,
    });

    // Preferred path — the browser takes ownership of the request, so it
    // completes even though we are navigating to the dialer this instant.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const blob = new Blob([payload], { type: "application/json" });
        if (navigator.sendBeacon(DIAL_ENDPOINT, blob)) return;
      } catch {
        /* sendBeacon refused (payload/queue/content-type) — fall through */
      }
    }

    // Fallback — keepalive lets this outlive the page too.
    void fetch(DIAL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* a dial must always go through, logged or not */
  }
}

/**
 * Returns a factory that builds the onClick handler for a dial affordance.
 * Stable across renders, so it is safe in a list of hundreds of rows.
 */
export function useDialBeacon() {
  return useCallback(
    (target: DialTarget, options?: DialOptions) =>
      (e: MouseEvent<HTMLElement>) => {
        // Caller's own handler first (e.g. row-click suppression), then ours.
        // Both are wrapped: nothing here may prevent the tel: navigation.
        try {
          if (options?.stopPropagation) e.stopPropagation();
          options?.onClick?.(e);
        } catch {
          /* ignore — never block the dial */
        }
        sendDialBeacon(target);
      },
    [],
  );
}

export default useDialBeacon;
