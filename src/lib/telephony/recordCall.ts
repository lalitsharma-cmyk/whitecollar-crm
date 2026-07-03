import "server-only";
// The telephony SINK. Every inbound webhook and every sync-pulled call funnels
// through recordCallEvent():
//   1. resolve the owning CRM record (Lead / Revival / Buyer) by phone
//   2. resolve the acting agent (telephony ext → CRM user)
//   3. idempotently upsert ONE CallLog (keyed on provider callId)
//   4. on call-end, drop the entry into the RIGHT record's timeline exactly once
//      (Lead → Activity, Buyer → BuyerActivity) WITH the recording link
//   5. audit the write
// Idempotent: providers retry webhooks; re-processing the same event never
// duplicates the CallLog or the timeline entry. NEVER throws on link/agent miss —
// an unmatched call is still stored (unlinked) so nothing is ever lost.
import { prisma } from "@/lib/prisma";
import { CallDirection, CallOutcome, ActivityType, ActivityStatus } from "@prisma/client";
import { callOutcomeLabel } from "@/lib/callOutcome";
import type { NormalizedCallEvent } from "./types";
import { resolveCallLink } from "./linkResolver";

export interface RecordResult {
  callLogId: string;
  leadId: string | null;
  buyerId: string | null;
  userId: string | null;
  outcome: CallOutcome;
  created: boolean;        // false = idempotent update of an existing log
  timelineWritten: boolean;
}

export function mapOutcome(status: string | null): CallOutcome {
  const s = (status || "").toLowerCase();
  if (s.includes("answer") || s.includes("connect") || s.includes("complete")) return CallOutcome.CONNECTED;
  if (s.includes("busy")) return CallOutcome.BUSY;
  if (s.includes("fail") || s.includes("congest") || s.includes("reject") || s.includes("off")) return CallOutcome.SWITCHED_OFF;
  if (s.includes("miss") || s.includes("no_answer") || s.includes("noanswer") || s.includes("no-answer") || s.includes("cancel")) return CallOutcome.NOT_PICKED;
  return CallOutcome.NOT_PICKED;
}

export async function recordCallEvent(ev: NormalizedCallEvent): Promise<RecordResult> {
  const link = await resolveCallLink(ev.otherNumber, ev.customIdentifier);
  const direction = ev.direction === "inbound" ? CallDirection.INBOUND : CallDirection.OUTBOUND;

  // Agent attribution — ONLY the CRM user whose telephony ext matches. Never fall
  // back to the record owner (that fabricates authorship — Lalit's rule 2026-07-01).
  let userId: string | null = null;
  if (ev.agentExt) {
    const user = await prisma.user.findFirst({ where: { acefoneAgentId: ev.agentExt }, select: { id: true } });
    if (user) userId = user.id;
  }
  const unmatchedAgentName = userId ? null : ev.agentExt ? `Unknown Agent (ext ${ev.agentExt})` : "Unknown Agent";

  const outcome = mapOutcome(ev.status);
  const startedAt = ev.startedAt ?? new Date();
  const endedAt = ev.endedAt;
  const isTerminal = !!endedAt; // call has finished

  const existing = await prisma.callLog.findUnique({ where: { ivrCallId: ev.providerCallId } });

  let callLogId: string;
  let created: boolean;
  let firstTerminal: boolean; // this upsert is the moment the call first became terminal

  if (existing) {
    firstTerminal = isTerminal && existing.endedAt == null;
    const updated = await prisma.callLog.update({
      where: { ivrCallId: ev.providerCallId },
      data: {
        leadId: existing.leadId ?? link.leadId,
        buyerId: existing.buyerId ?? link.buyerId,
        userId: existing.userId ?? userId,
        attributedAgentName: (existing.userId ?? userId) ? existing.attributedAgentName : (existing.attributedAgentName ?? unmatchedAgentName),
        durationSec: ev.durationSec ?? existing.durationSec,
        outcome,
        endedAt: endedAt ?? existing.endedAt,
        recordingUrl: ev.recordingUrl ?? existing.recordingUrl,
        ivrAccountId: existing.ivrAccountId ?? ev.accountId,
      },
    });
    callLogId = updated.id;
    created = false;
  } else {
    const row = await prisma.callLog.create({
      data: {
        ivrProvider: ev.provider,
        ivrCallId: ev.providerCallId,
        ivrAccountId: ev.accountId,
        leadId: link.leadId,
        buyerId: link.buyerId,
        userId,
        attributedAgentName: unmatchedAgentName,
        direction,
        phoneNumber: ev.otherNumber ?? "(unknown)",
        durationSec: ev.durationSec ?? undefined,
        outcome,
        startedAt,
        endedAt: endedAt ?? undefined,
        recordingUrl: ev.recordingUrl ?? undefined,
      },
    });
    callLogId = row.id;
    created = true;
    firstTerminal = isTerminal;
  }

  // ── Drop into the owning record's timeline exactly once (on first terminal) ──
  let timelineWritten = false;
  if (firstTerminal) {
    const durTxt = ev.durationSec ? ` · ${Math.round(ev.durationSec)}s` : "";
    const title = `Call ${direction.toLowerCase()} · ${outcome.replaceAll("_", " ").toLowerCase()}${durTxt}`;
    const desc = ev.recordingUrl ? `Recording: ${ev.recordingUrl}` : undefined;

    if (link.leadId) {
      await prisma.activity.create({
        // outcome mirrors the CallLog's outcome (same format the log-call route
        // writes) so the Smart-Timeline chip is populated and the CALL-outcome
        // integrity invariant can't drift as telephony calls flow in.
        data: { leadId: link.leadId, userId, type: ActivityType.CALL, status: ActivityStatus.DONE, title, description: desc, outcome: callOutcomeLabel(outcome), completedAt: endedAt ?? new Date() },
      });
      await prisma.lead.update({ where: { id: link.leadId }, data: { lastTouchedAt: endedAt ?? new Date(), slaEscalated: false } });
      timelineWritten = true;
    } else if (link.buyerId) {
      // BuyerActivity powers the buyer conversation timeline (5b). type=CALL so it
      // renders as a call entry; the recording itself is played via the scope-proxied
      // player the timeline renders from the buyer-linked CallLog (no raw URL in text).
      await prisma.buyerActivity.create({
        data: { buyerId: link.buyerId, userId, type: "CALL", description: `${title}${ev.recordingUrl ? " · 🎙 recording" : ""}` },
      });
      timelineWritten = true;
    }
  }

  // ── Audit every write (reversible/inspectable) ──────────────────────────────
  await prisma.auditLog.create({
    data: {
      userId,
      action: created ? "call.record" : "call.update",
      entity: "CallLog",
      entityId: callLogId,
      meta: JSON.stringify({
        provider: ev.provider, direction, outcome, linked: link.leadId ? "lead" : link.buyerId ? "buyer" : "none",
        isRevival: link.isRevival, buyerMarket: link.buyerMarket, recording: !!ev.recordingUrl, agentMatched: !!userId,
      }),
    },
  }).catch(() => {}); // audit must never break call recording

  return { callLogId, leadId: link.leadId, buyerId: link.buyerId, userId, outcome, created, timelineWritten };
}
