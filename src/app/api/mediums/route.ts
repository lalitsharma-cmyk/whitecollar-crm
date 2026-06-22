import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAvailableMediums } from "@/lib/mediumManager";

// Returns the list of available mediums (standard + any custom ones seen on leads).
// Exists so client components (e.g. the New-Lead form) can fetch the list WITHOUT
// importing getAvailableMediums — that helper pulls in Prisma, which must never be
// bundled into a "use client" component (server/client boundary violation).
export async function GET() {
  await requireUser();
  const mediums = await getAvailableMediums();
  return NextResponse.json({ mediums });
}
