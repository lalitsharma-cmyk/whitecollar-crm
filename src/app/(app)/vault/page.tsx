// Vault — private mental-health + reflection space (Phase 3, master spec §10).
// PRIVACY: only ever query with userId = current session user. We never expose
// vault content anywhere else (no activity log, no audit log, no notification).
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import VaultClient from "@/components/VaultClient";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const me = await requireUser();
  const entries = await prisma.vaultEntry.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  // Serialize Date fields so the client component can safely consume them.
  const initial = entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    mood: e.mood,
    content: e.content,
    tags: e.tags,
    expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
    aiReflection: e.aiReflection,
    createdAt: e.createdAt.toISOString(),
  }));

  return <VaultClient initialEntries={initial} />;
}
