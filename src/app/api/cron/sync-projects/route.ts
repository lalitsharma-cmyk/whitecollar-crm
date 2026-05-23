import { NextResponse, type NextRequest } from "next/server";
import { syncProjectsFromMarketingSite } from "@/lib/syncProjects";

// Vercel Cron hits this endpoint daily.
// Configured in vercel.json — protected by a Bearer token Vercel sets in production.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncProjectsFromMarketingSite();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
