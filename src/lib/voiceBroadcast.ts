// voiceBroadcast — the ONE place that defines WHO can send a dashboard voice
// broadcast and WHICH broadcasts a given user receives. Pure (no server-only
// import) so the API routes AND the read-only regression suite can both use it.
//
// Feature 1 (dashboard broadcast) is SEPARATE from lead-specific voice guidance.
import type { Prisma } from "@prisma/client";

/**
 * May this user SEND a dashboard voice broadcast?
 * Allowed: real Admins + Super-Admin (Lalit). Excluded: Sameer (leadOpsOnly ADMIN),
 * Agents, and normal Managers. Mirrors Lalit's spec exactly.
 */
export function canSendBroadcast(me: { role: string; leadOpsOnly?: boolean | null }): boolean {
  return me.role === "ADMIN" && !me.leadOpsOnly;
}

/**
 * Prisma where for the broadcasts a given user RECEIVES on their dashboard:
 * everything sent to ALL, to their TEAM, or directly to them.
 */
export function broadcastRecipientWhere(me: { id: string; team: string | null }): Prisma.VoiceBroadcastWhereInput {
  return {
    OR: [
      { targetKind: "ALL" },
      { targetKind: "TEAM", targetTeam: me.team ?? "__no_team__" },
      { targetKind: "USER", targetUserId: me.id },
    ],
  };
}

/** Human label for a broadcast's audience (shown to recipients + the sender). */
export function broadcastAudienceLabel(b: { targetKind: string; targetTeam?: string | null; targetUserName?: string | null }): string {
  if (b.targetKind === "ALL") return "Everyone";
  if (b.targetKind === "TEAM") return `${b.targetTeam ?? "Team"} team`;
  if (b.targetKind === "USER") return b.targetUserName ?? "One agent";
  return "—";
}
