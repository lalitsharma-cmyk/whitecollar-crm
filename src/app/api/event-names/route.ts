import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAvailableEventNames } from "@/lib/eventNameManager";

// Returns the list of available WCR event names (standard listing platforms +
// any custom names already saved on leads). Exists so the New-Lead client
// component can fetch the list WITHOUT importing getAvailableEventNames — that
// helper pulls in Prisma, which must never be bundled into a "use client"
// component (server/client boundary violation). Mirrors /api/mediums.
export async function GET() {
  await requireUser();
  const eventNames = await getAvailableEventNames();
  return NextResponse.json({ eventNames });
}
