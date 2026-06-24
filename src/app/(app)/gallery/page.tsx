import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageResources } from "@/lib/resources";
import GalleryClient, { type ResourceItem } from "@/components/GalleryClient";
import { ImageIcon } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const me = await requireUser();
  const canManage = canManageResources(me.role);

  // NEVER select fileData here — list payloads stay small (bytes only stream
  // from the public download route).
  const rows = await prisma.resource.findMany({
    where: { deletedAt: null },
    select: {
      id: true, title: true, category: true, type: true,
      fileName: true, mimeType: true, fileSize: true, fileUrl: true, textContent: true,
      projectName: true, tags: true, createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
      _count: { select: { shares: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const initialItems: ResourceItem[] = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-[#c9a24b]/15 flex items-center justify-center text-[#c9a24b]">
          <ImageIcon className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold dark:text-slate-100">Gallery &amp; Resources</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Brochures, payment plans, creatives &amp; templates — share with clients via WhatsApp or Email.
          </p>
        </div>
      </div>

      <GalleryClient canManage={canManage} initialItems={initialItems} />
    </div>
  );
}
