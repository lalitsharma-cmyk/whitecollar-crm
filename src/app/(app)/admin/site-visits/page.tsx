// Admin live + historical view of every site visit.
// Lalit explicitly asked: "Where can admin see live location of agent when on site visit"
// — before this page existed the SiteVisitTracker was collecting GPS every 60s into
// Activity.locationTrack but nothing surfaced it. Now this page does.
//
//   LIVE section   = Activity rows where startedAt is set and endedAt is null
//                    (auto-refresh every 30s via meta-refresh — no JS state needed)
//   RECENT section = last 50 completed SITE_VISIT rows
//
// Map links use Google Maps deep-links (no API key required, opens in any browser/app).
//   Single point:  https://www.google.com/maps?q=LAT,LNG
//   Full track:    https://www.google.com/maps/dir/p1.lat,p1.lng/p2.lat,p2.lng/...
//                  (we cap to 9 points = first, last, plus 7 evenly-spaced from the track
//                  to stay inside Google's URL waypoint limit)

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { fmtIST12 } from "@/lib/datetime";
import LiveVisitsAutoRefresh from "@/components/LiveVisitsAutoRefresh";

export const dynamic = "force-dynamic";

interface TrackPoint { ts: string; lat: number; lng: number }

function isValidCoord(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= -180 && n <= 180;
}

function parseTrack(s: string | null): TrackPoint[] {
  if (!s) return [];
  try {
    const j = JSON.parse(s);
    if (!Array.isArray(j)) return [];
    // Filter out any corrupt entries — a single bad row in locationTrack used to
    // crash the entire admin page when .toFixed() ran on a string/null/NaN lat.
    return j.filter((p): p is TrackPoint =>
      p != null && typeof p === "object" &&
      isValidCoord(p.lat) && isValidCoord(p.lng) &&
      typeof p.ts === "string"
    );
  } catch { return []; }
}

/** Single-point Google Maps pin */
function pinLink(lat: number | null, lng: number | null): string | null {
  if (!isValidCoord(lat) || !isValidCoord(lng)) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Driving-directions multi-waypoint URL — sampled down to ≤9 points to fit Google's URL limit */
function trackLink(track: TrackPoint[]): string | null {
  if (track.length === 0) return null;
  if (track.length === 1) return pinLink(track[0].lat, track[0].lng);
  // Sample: first, last, plus up to 7 evenly-spaced in-between
  const max = 9;
  const samples: TrackPoint[] = track.length <= max
    ? track
    : Array.from({ length: max }, (_, i) => track[Math.round((i * (track.length - 1)) / (max - 1))]);
  const path = samples.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("/");
  return `https://www.google.com/maps/dir/${path}`;
}

function elapsedSince(d: Date): string {
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default async function AdminSiteVisitsPage() {
  await requireRole("ADMIN");

  // ── LIVE: site visits currently in progress (startedAt set, endedAt null) ──
  const live = await prisma.activity.findMany({
    where: {
      type: "SITE_VISIT",
      startedAt: { not: null },
      endedAt: null,
      status: { not: "DONE" },
    },
    orderBy: { startedAt: "desc" },
    include: {
      lead: { select: { id: true, name: true, phone: true, forwardedTeam: true } },
      user: { select: { id: true, name: true, avatarColor: true, team: true, phone: true } },
    },
  });

  // ── RECENT: last 50 completed site visits ──
  const recent = await prisma.activity.findMany({
    where: {
      type: "SITE_VISIT",
      endedAt: { not: null },
    },
    orderBy: { endedAt: "desc" },
    take: 50,
    include: {
      lead: { select: { id: true, name: true, forwardedTeam: true } },
      user: { select: { id: true, name: true, avatarColor: true, team: true } },
    },
  });

  return (
    <>
      {/* Auto-refresh every 30s — re-renders the page server-side without losing scroll */}
      <LiveVisitsAutoRefresh intervalSec={30} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">🚗 Site visits — live map</h1>
          <p className="text-xs text-gray-500 mt-1">
            Every agent's GPS is captured at start, every 60 seconds during the visit, and at end.
            Click any 📍 to open the location in Google Maps.
          </p>
        </div>
        <div className="text-[11px] text-gray-500">Auto-refreshing every 30s · {fmtIST12(new Date())} IST</div>
      </div>

      {/* ── LIVE ──────────────────────────────────────────────────── */}
      <div className="card p-5 border-l-4 border-emerald-500">
        <div className="flex items-center gap-2 mb-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span className="font-semibold">LIVE NOW — {live.length} visit{live.length === 1 ? "" : "s"} in progress</span>
        </div>

        {live.length === 0 && (
          <div className="text-sm text-gray-500 text-center py-6">
            Nobody is on a site visit right now.
          </div>
        )}

        <div className="space-y-3">
          {live.map((v) => {
            const track = parseTrack(v.locationTrack);
            const last = track[track.length - 1];
            const startedAtPin = pinLink(v.startedLat, v.startedLng);
            const lastPin = last ? pinLink(last.lat, last.lng) : null;
            const fullTrack = trackLink(track);
            return (
              <div key={v.id} className="border-l-4 border-emerald-400 pl-4 py-2 bg-emerald-50/30 rounded-r">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                      {v.user && <span className={`avatar ${v.user.avatarColor ?? "bg-slate-500"} inline-flex w-6 h-6 text-[10px]`}>{v.user.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</span>}
                      <span>{v.user?.name ?? "Unknown agent"}</span>
                      <span className="text-gray-400">→</span>
                      {v.lead && <Link href={`/leads/${v.lead.id}`} className="text-[#0b1a33] underline">{v.lead.name}</Link>}
                      <span className="chip src text-[9px]">{v.lead?.forwardedTeam ?? v.user?.team ?? "—"}</span>
                    </div>
                    <div className="text-[11px] text-gray-600 mt-1">
                      Started {v.startedAt && fmtIST12(v.startedAt)} IST · {v.startedAt && elapsedSince(v.startedAt)} elapsed · {track.length} GPS point{track.length === 1 ? "" : "s"}
                      {v.lead?.phone && <> · 📞 {v.lead.phone}</>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap text-xs">
                    {lastPin && (
                      <a href={lastPin} target="_blank" rel="noopener noreferrer" className="btn btn-primary text-xs">
                        📍 Last known
                      </a>
                    )}
                    {startedAtPin && lastPin !== startedAtPin && (
                      <a href={startedAtPin} target="_blank" rel="noopener noreferrer" className="btn btn-ghost text-xs">
                        📍 Start
                      </a>
                    )}
                    {fullTrack && track.length > 1 && (
                      <a href={fullTrack} target="_blank" rel="noopener noreferrer" className="btn btn-ghost text-xs">
                        🛣 Full route
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RECENT (completed) ──────────────────────────────────── */}
      <div className="card p-5">
        <div className="font-semibold mb-3">Recent site visits · last 50</div>
        {recent.length === 0 && <div className="text-sm text-gray-500 text-center py-6">No completed site visits yet.</div>}
        <div className="space-y-2">
          {recent.map((v) => {
            const track = parseTrack(v.locationTrack);
            const startPin = pinLink(v.startedLat, v.startedLng);
            const endPin = pinLink(v.endedLat, v.endedLng);
            const routeLink = trackLink(track);
            const mins = v.startedAt && v.endedAt
              ? Math.round((v.endedAt.getTime() - v.startedAt.getTime()) / 60000)
              : 0;
            return (
              <div key={v.id} className="border border-[#e5e7eb] rounded-lg p-3 hover:border-[#c9a24b]">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                      {v.user && <span className={`avatar ${v.user.avatarColor ?? "bg-slate-500"} inline-flex w-6 h-6 text-[10px]`}>{v.user.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</span>}
                      <span>{v.user?.name ?? "Unknown"}</span>
                      <span className="text-gray-400">→</span>
                      {v.lead && <Link href={`/leads/${v.lead.id}`} className="text-[#0b1a33] underline">{v.lead.name}</Link>}
                      {v.isNoShow && <span className="chip chip-lost text-[9px]">NO-SHOW</span>}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      {v.startedAt && fmtIST12(v.startedAt)} → {v.endedAt && fmtIST12(v.endedAt)} IST · {mins}m · {track.length} GPS point{track.length === 1 ? "" : "s"}
                    </div>
                    {v.description && (
                      <div className="text-xs text-gray-700 mt-1 whitespace-pre-wrap line-clamp-2">{v.description}</div>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap text-[11px]">
                    {startPin && (
                      <a href={startPin} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100">
                        📍 Start
                      </a>
                    )}
                    {endPin && (
                      <a href={endPin} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-red-50 border border-red-200 rounded hover:bg-red-100">
                        📍 End
                      </a>
                    )}
                    {routeLink && track.length > 1 && (
                      <a href={routeLink} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100">
                        🛣 Route
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
