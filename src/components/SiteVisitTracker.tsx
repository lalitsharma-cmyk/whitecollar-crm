"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, AlertCircle, CheckCircle2, X } from "lucide-react";
import { showCelebration } from "@/components/DealCelebration";
import { backdropProps } from "@/lib/useDismiss";

interface Props {
  leadId: string;
  leadName: string;
  /** Currently active visit (server-rendered) — if present, we resume tracking. */
  activeVisit?: {
    activityId: string;
    type: "OFFICE_MEETING" | "SITE_VISIT";
    startedAt: string;
  } | null;
}

// Virtual meetings DON'T appear here — they're not a physical visit that needs
// GPS start/end. Log them via the "Log Meeting" button on lead detail instead.
type VisitType = "OFFICE_MEETING" | "SITE_VISIT";

const TRACK_INTERVAL_MS = 60_000; // push a GPS point every 60s during a site visit

/**
 * SITE-VISIT LIFECYCLE
 *   1. Agent taps "Start Site Visit" → browser asks GPS permission → we capture
 *      start lat/lng + create an Activity (status=PLANNED, startedAt=now).
 *   2. While active, every 60s we read the current GPS and POST it as a track
 *      point. This gives the manager an after-the-fact map of where the agent
 *      went during the visit (without continuous surveillance — only between
 *      Start and End).
 *   3. Agent taps "End Visit" → capture end lat/lng, mark Activity DONE, ask
 *      "Did the client show up?" + "Who else attended?".
 *
 * SITE_VISIT requires location (we enforce server-side too).
 * OFFICE_MEETING / VIRTUAL_MEETING — location optional.
 */
export default function SiteVisitTracker({ leadId, leadName, activeVisit }: Props) {
  const router = useRouter();
  const [type, setType] = useState<VisitType>("SITE_VISIT");
  const [activity, setActivity] = useState<{ id: string; type: VisitType; startedAt: number } | null>(
    activeVisit ? { id: activeVisit.activityId, type: activeVisit.type, startedAt: new Date(activeVisit.startedAt).getTime() } : null
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [trackedPoints, setTrackedPoints] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [endNotes, setEndNotes] = useState("");
  const [isNoShow, setIsNoShow] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const pollRef = useRef<number | null>(null);
  const elapsedRef = useRef<number | null>(null);

  // Elapsed-time counter while a visit is active
  useEffect(() => {
    if (!activity) {
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
      setElapsedSec(0);
      return;
    }
    setElapsedSec(Math.floor((Date.now() - activity.startedAt) / 1000));
    elapsedRef.current = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - activity.startedAt) / 1000));
    }, 1000);
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [activity]);

  // Background GPS polling — only while visit is active AND type is SITE_VISIT
  useEffect(() => {
    if (!activity || activity.type !== "SITE_VISIT") return;
    const poll = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const r = await fetch(`/api/leads/${leadId}/visit`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ activityId: activity.id, lat: pos.coords.latitude, lng: pos.coords.longitude }),
            });
            if (r.ok) {
              const j = await r.json();
              setTrackedPoints(j.points ?? trackedPoints + 1);
            }
          } catch { /* ignore — next tick will retry */ }
        },
        () => { /* permission revoked or no signal — ignore this tick */ },
        { enableHighAccuracy: true, timeout: 30_000, maximumAge: 30_000 }
      );
    };
    pollRef.current = window.setInterval(poll, TRACK_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activity, leadId]);

  // Ask for a single GPS reading — returns { lat, lng } or throws with a user-friendly error
  async function getLocation(): Promise<{ lat: number; lng: number }> {
    if (!navigator.geolocation) {
      throw new Error("Your browser doesn't support GPS. Use Chrome/Safari on a phone for site visits.");
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (e) => {
          const msg =
            e.code === e.PERMISSION_DENIED ? "GPS permission denied. Go to browser/Settings → Site permissions → Location and allow it for this site." :
            e.code === e.POSITION_UNAVAILABLE ? "Couldn't get a GPS fix. Step outside or near a window and try again." :
            e.code === e.TIMEOUT ? "GPS timed out. Try again." :
            "Location error.";
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
      );
    });
  }

  async function start() {
    if (busy) return;
    setErr(null); setBusy(true);
    try {
      let lat: number | null = null, lng: number | null = null;
      if (type === "SITE_VISIT") {
        const loc = await getLocation();
        lat = loc.lat; lng = loc.lng;
      } else {
        // Try to capture location for meetings too but don't fail if not available
        try { const loc = await getLocation(); lat = loc.lat; lng = loc.lng; } catch {}
      }
      const r = await fetch(`/api/leads/${leadId}/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, lat, lng }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed to start visit"); return; }
      setActivity({ id: j.activityId, type, startedAt: Date.now() });
      setTrackedPoints(lat != null ? 1 : 0);
      router.refresh();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally { setBusy(false); }
  }

  async function end() {
    if (!activity || busy) return;
    setBusy(true); setErr(null);
    try {
      let lat: number | null = null, lng: number | null = null;
      if (activity.type === "SITE_VISIT" && !isNoShow) {
        try { const loc = await getLocation(); lat = loc.lat; lng = loc.lng; } catch {}
      }
      const r = await fetch(`/api/leads/${leadId}/visit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId: activity.id, lat, lng, notes: endNotes, isNoShow }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed to end visit"); return; }
      setActivity(null);
      setShowEndModal(false);
      setEndNotes("");
      setIsNoShow(false);
      showCelebration({ kind: "site_visit_done", message: `Site visit done — ${leadName}` });
      router.refresh();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally { setBusy(false); }
  }

  const elapsedFmt = `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;

  // ── No active visit: show "Start" controls ──
  if (!activity) {
    return (
      <div className="card p-4 border-l-4 border-[#c9a24b] bg-amber-50/40">
        <div className="font-semibold mb-2 text-sm flex items-center gap-2">
          <MapPin className="w-4 h-4 text-[#c9a24b]" /> Start a visit / meeting
        </div>
        <p className="text-[11px] text-gray-600 mb-2">
          Site visits require GPS — your browser will ask permission. Location is captured at start, every 60s during the visit, and at end.
        </p>
        <div className="flex flex-wrap gap-2">
          <select value={type} onChange={(e) => setType(e.target.value as VisitType)} className="border border-[#e5e7eb] rounded-lg px-2 py-2 text-xs flex-1 min-w-[140px]">
            <option value="SITE_VISIT">🚗 Site visit (GPS required)</option>
            <option value="OFFICE_MEETING">🏢 Office meeting</option>
          </select>
          <button onClick={start} disabled={busy} className="btn btn-primary text-xs">
            {busy ? "Starting…" : "▶ Start"}
          </button>
        </div>
        {err && <div className="text-[11px] text-red-700 mt-2 flex items-start gap-1"><AlertCircle className="w-3 h-3 mt-0.5 flex-none" /> {err}</div>}
      </div>
    );
  }

  // ── Active visit: show live tracker ──
  return (
    <>
      <div className="card p-4 border-l-4 border-emerald-500 bg-emerald-50/40">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold text-sm flex items-center gap-2">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span></span>
            {activity.type === "SITE_VISIT" ? "🚗 Site visit in progress" : activity.type === "OFFICE_MEETING" ? "🏢 Office meeting" : "💻 Virtual meeting"}
          </div>
          <div className="text-xs text-gray-600 font-mono">{elapsedFmt}</div>
        </div>
        {activity.type === "SITE_VISIT" && (
          <div className="text-[11px] text-gray-600 mb-2">
            📍 GPS tracked · {trackedPoints} point{trackedPoints === 1 ? "" : "s"} recorded
          </div>
        )}
        <button onClick={() => setShowEndModal(true)} className="btn btn-primary w-full justify-center text-sm">
          ⏹ End visit & log
        </button>
        {err && <div className="text-[11px] text-red-700 mt-2 flex items-start gap-1"><AlertCircle className="w-3 h-3 mt-0.5 flex-none" /> {err}</div>}
      </div>

      {showEndModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" {...backdropProps(() => !busy && setShowEndModal(false))}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg">End visit with {leadName}</div>
              <button onClick={() => setShowEndModal(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold mb-3 cursor-pointer">
              <input type="checkbox" checked={isNoShow} onChange={(e) => setIsNoShow(e.target.checked)} />
              ❌ Client didn't show up (no-show)
            </label>
            <label className="text-xs font-semibold text-gray-600 block">Notes from the visit</label>
            <textarea
              value={endNotes}
              onChange={(e) => setEndNotes(e.target.value)}
              rows={4}
              placeholder={isNoShow ? "What happened? Did they reschedule? How long did you wait?" : "Outcome, objections, next step…"}
              className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm font-mono text-[13px]"
            />
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowEndModal(false)} disabled={busy} className="btn btn-ghost">Cancel</button>
              <button onClick={end} disabled={busy} className="btn btn-primary">
                {busy ? "Ending…" : <><CheckCircle2 className="w-4 h-4" /> Confirm end</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
