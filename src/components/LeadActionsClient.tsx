"use client";
import type { ReactNode } from "react";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Phone, AlertCircle, Mic } from "lucide-react";
import { whatsappLink, telLink, hasDialableNumber } from "@/lib/phone";
// The ALT-number Call uses the dial beacon. The PRIMARY Call keeps its existing
// /call-initiated post (which now writes the CallLog too) — see logCallClick.
import { useDialBeacon } from "@/components/useDialBeacon";
import TemplatePickerButton from "./TemplatePickerButton";
import { ActionButton } from "@/components/actions/ActionButton";
import { backdropProps } from "@/lib/useDismiss";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { showXpToast } from "./XPToast";
import FollowupNextPopup from "./FollowupNextPopup";

interface OutcomeOption { key: string; v: string; label: string; }

// Phone-specific outcomes. `v` = CallOutcome DB enum value sent to the API.
// Multiple labels can map to the same DB value (e.g. "Call Disconnected" and
// "Not Answered" both map to NOT_PICKED — distinct UX, same storage bucket).
const PHONE_OUTCOMES: OutcomeOption[] = [
  { key: "PHONE_CONNECTED",      v: "CONNECTED",      label: "✅ Connected" },
  { key: "PHONE_NOT_PICKED",     v: "NOT_PICKED",     label: "📵 Not Answered" },
  { key: "PHONE_BUSY",           v: "BUSY",           label: "⏳ Busy" },
  { key: "PHONE_SWITCHED_OFF",   v: "SWITCHED_OFF",   label: "📴 Switched Off" },
  { key: "PHONE_DISCONNECTED",   v: "NOT_PICKED",     label: "🔌 Call Disconnected" },
  { key: "PHONE_CALLBACK",       v: "CALLBACK",       label: "🔁 Call Back Later" },
  { key: "PHONE_WRONG_NUMBER",   v: "WRONG_NUMBER",   label: "🚫 Wrong Number" },
  { key: "PHONE_INVALID",        v: "WRONG_NUMBER",   label: "❌ Invalid Number" },
  { key: "PHONE_NOT_REACHABLE",  v: "SWITCHED_OFF",   label: "📡 Number Not Reachable" },
  { key: "PHONE_NOT_INTERESTED", v: "NOT_INTERESTED", label: "🛑 Not Interested" },
  { key: "PHONE_FOLLOWUP",       v: "CALLBACK",       label: "🔔 Follow-up Required" },
];

// WhatsApp outbound outcomes (We Sent) — agent initiated the message.
const WA_OUTBOUND_OUTCOMES: OutcomeOption[] = [
  { key: "WA_SENT",           v: "NOT_PICKED",     label: "✅ WhatsApp Message Sent" },
  { key: "WA_DELIVERED",      v: "NOT_PICKED",     label: "✅ WhatsApp Delivered" },
  { key: "WA_SEEN",           v: "NOT_PICKED",     label: "✅ WhatsApp Read" },
  { key: "WA_REPLIED",        v: "CONNECTED",      label: "✅ Client Replied" },
  { key: "WA_DROPPED",        v: "NOT_PICKED",     label: "📵 Dropped WA (no response)" },
  { key: "WA_FAILED",         v: "NOT_PICKED",     label: "❌ Failed to Deliver" },
];

// WhatsApp inbound outcomes (Client Sent) — client initiated the message.
// Never show "Message Sent" here — that describes outbound, not inbound.
const WA_INBOUND_OUTCOMES: OutcomeOption[] = [
  { key: "WA_RECEIVED",       v: "CONNECTED",      label: "✅ Message Received" },
  { key: "WA_CLIENT_REPLIED", v: "CONNECTED",      label: "✅ Client Replied" },
  { key: "WA_SHARED_REQ",     v: "INTERESTED",     label: "✅ Client Shared Requirement" },
  { key: "WA_REQ_CALLBACK",   v: "CALLBACK",       label: "✅ Client Requested Callback" },
  { key: "WA_REQ_MEETING",    v: "CALLBACK",       label: "✅ Client Requested Meeting" },
];

interface Agent { id: string; name: string; role: string; team: string | null; avatarColor: string | null; }

interface Props {
  leadId: string;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  currentOwnerId: string | null;
  canReassign: boolean;
  agents: Agent[];
  phoneMasked: string | null;
  altPhoneMasked: string | null;
  leadName: string;
  agentName: string;
  acefoneEnabled?: boolean;        // server flag — hide button if false
  acefoneMappedForUser?: boolean;  // current user has acefoneAgentId set
  // When true, suppress the inline reassign dropdown — the page renders a
  // standalone <LeadReassignClient> on the right column instead (Lalit's ask:
  // "Reassignment move to Right side").
  hideReassign?: boolean;
  // Extra action buttons rendered INSIDE the primary action row, after Note.
  // The page passes <LeadFollowupActions> here so Complete / Snooze / Escalate
  // sit on the same line as Call / WhatsApp / Email / Log Call / Note instead of
  // on a separate stacked row below (UI compaction — saves vertical space).
  extraActions?: React.ReactNode;
}

// Phone helpers — now in src/lib/phone.ts. Kept as thin wrappers for compatibility.
const telUrl = (p: string | null) => telLink(p);
const waUrl = (p: string | null) => whatsappLink(p);

export default function LeadActionsClient({ leadId, phone, altPhone, email, currentOwnerId, canReassign, agents, phoneMasked, altPhoneMasked, leadName, agentName, acefoneEnabled, acefoneMappedForUser, hideReassign, extraActions }: Props) {
  const waGreeting = `Hi ${leadName}, this is ${agentName} from White Collar Realty. I'll be your dedicated property advisor. May I know a convenient time to call you today?`;
  const waUrlWithDraft = (p: string | null) => whatsappLink(p, waGreeting);

  // Fire-and-forget — log every WhatsApp link click so admin sees it in the
  // lead timeline + the daily report counts it under "WhatsApp touches".
  function logWaClick(kind: "click" | "send", message?: string) {
    fetch("/api/whatsapp/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true, // survives even if the new tab steals focus
      body: JSON.stringify({ leadId, kind, message }),
    }).catch(() => {});
  }
  // PRIMARY Call button. Deliberately NOT the dial beacon: this endpoint now
  // delegates to startCall() (so the tap writes a CallLog at INITIATED, exactly
  // like the beacon does) AND keeps writing its "📞 Call initiated" timeline
  // Activity, which only this button has ever produced. Pointing it at
  // /api/calls/dial instead would create a SECOND CallLog row for one dial and
  // silently drop that timeline entry. One dial = one row.
  function logCallClick() {
    fetch(`/api/leads/${leadId}/call-initiated`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }
  const router = useRouter();
  // Used by the ALT-number Call (the primary Call uses logCallClick above).
  const dial = useDialBeacon();
  const [showCall, setShowCall] = useState(false);
  // Post-log "What next?" prompt — opens after a successful Log Call so the agent
  // closes the follow-up (Complete / Snooze / Escalate) instead of leaving it open.
  const [showNextPrompt, setShowNextPrompt] = useState(false);
  // Lock background scroll while the Log Call modal is open — prevents the
  // underlying lead-detail form from jumping/shifting when the modal mounts.
  useBodyScrollLock(showCall);
  const [busy, setBusy] = useState(false);
  // outcomeKey tracks which specific option the agent selected (unique per option).
  // currentOutcomeV is the CallOutcome DB enum value derived from it.
  // Default is BLANK ("") — shown as "-- Select Outcome --". A not-yet-picked
  // conversation must NOT silently save as "Connected" (Lalit's ask). The agent
  // has to consciously choose the outcome; save is blocked until they do.
  const [outcomeKey, setOutcomeKey] = useState("");
  // Channel + direction for Log Call modal. Lalit's ask: "From where should I
  // log a whatsapp message client sent me remarks to get it recorded in call?"
  // — answer: in the same Log Call modal, toggle channel = WhatsApp and
  // direction = Inbound. Defaults to Phone + Outbound (most common).
  const [logChannel, setLogChannel] = useState<"PHONE" | "WHATSAPP">("PHONE");
  const [logDirection, setLogDirection] = useState<"OUTBOUND" | "INBOUND">("OUTBOUND");
  const [remarks, setRemarks] = useState("");
  const [duration, setDuration] = useState("");
  // Refs so a failed validation can focus / scroll the first missing field.
  const outcomeRef = useRef<HTMLSelectElement>(null);
  const remarksRef = useRef<HTMLTextAreaElement>(null);

  // Derive current outcome list and DB value from channel + selected key.
  // When no outcome is picked yet (outcomeKey === ""), currentOutcomeV is ""
  // (NOT a defaulted "NOT_PICKED") so the save guard can block on a blank outcome.
  const currentOutcomeOptions = logChannel === "PHONE" ? PHONE_OUTCOMES
    : logDirection === "OUTBOUND" ? WA_OUTBOUND_OUTCOMES
    : WA_INBOUND_OUTCOMES;
  const currentOutcomeV = currentOutcomeOptions.find((o) => o.key === outcomeKey)?.v ?? "";

  // Follow-up date is intentionally NOT part of logging a conversation anymore
  // (Lalit's rule: an agent must NEVER set/edit the follow-up while logging a
  // call or WhatsApp — the follow-up changes ONLY via Complete / Snooze /
  // Escalate / Reschedule / Admin). After a successful save we open the "What
  // next?" popup so the agent closes the follow-up through those shared actions.
  // Duration only makes sense for phone calls that actually connected. Hidden
  // for WhatsApp (no measurable duration) and for not-picked / switched-off.
  const showDurationField = logChannel === "PHONE" && (currentOutcomeV === "CONNECTED" || currentOutcomeV === "CALLBACK");
  const [err, setErr] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [acefoneBusy, setAcefoneBusy] = useState(false);
  const [acefoneMsg, setAcefoneMsg] = useState<string | null>(null);

  // Voice dictation for the Remarks field (spec §9.2 + §14 "reduce typing on
  // mobile"). Uses the browser-native Web Speech API — no npm package, no
  // external dependency. Hidden entirely when the browser doesn't support it
  // (most desktop Safari + some Android browsers). Indian English locale since
  // the team operates out of Dubai + India.
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<unknown>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR =
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (SR) setSpeechSupported(true);
  }, []);

  function stopDictation() {
    const rec = recognitionRef.current as { stop?: () => void } | null;
    if (rec && typeof rec.stop === "function") {
      try { rec.stop(); } catch { /* already stopped */ }
    }
    recognitionRef.current = null;
    setListening(false);
  }

  function toggleDictation() {
    if (listening) { stopDictation(); return; }
    if (typeof window === "undefined") return;
    const SR =
      (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR() as {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      let chunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        chunk += event.results[i][0].transcript;
      }
      const piece = chunk.trim();
      if (!piece) return;
      setRemarks((prev) => (prev ? `${prev} ${piece}` : piece));
    };
    rec.onerror = () => { stopDictation(); };
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }

  // Stop dictation whenever the Log Call modal closes — prevents the mic
  // staying hot after the user cancels or saves.
  useEffect(() => {
    if (!showCall && listening) stopDictation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCall]);

  async function callViaAcefone() {
    if (acefoneBusy) return;
    setAcefoneBusy(true); setAcefoneMsg(null);
    try {
      const r = await fetch(`/api/acefone/click-to-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const j = await r.json();
      if (!r.ok) { setAcefoneMsg(j.error ?? "Failed"); return; }
      setAcefoneMsg(`📞 Your phone will ring in a few seconds. Answer it — the lead is then dialled automatically.`);
    } catch (e) {
      setAcefoneMsg(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setAcefoneBusy(false); }
  }

  async function submitCall() {
    setErr(null);
    // ── MANDATORY FIELDS (Lalit's policy) ────────────────────────────────────
    // Every logged conversation must carry: Outcome + Remarks. The follow-up date
    // is intentionally NOT collected here — it is set only via Complete / Snooze /
    // Escalate / Reschedule / Admin (the "What next?" popup opens after save).
    // Validate in the order they appear; on the FIRST miss, show the message,
    // focus that field, and abort (no save). The server enforces the same two so
    // a tampered request can't bypass them.
    // 1) Outcome — must be a real picked value, never the blank placeholder.
    if (!outcomeKey || !currentOutcomeV) {
      setErr("Please select an outcome before saving.");
      outcomeRef.current?.focus();
      return;
    }
    // 2) Remarks — must be non-empty / non-whitespace. Validate the RAW text the
    //    user typed (not the channel-prefixed finalRemarks, which is never blank).
    if (!remarks.trim()) {
      setErr("Please add remarks before saving.");
      remarksRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      // Duration only matters for connected-style outcomes on PHONE calls.
      // WhatsApp text exchanges don't have a measurable duration → always 0.
      // The duration field is entered in MINUTES; store seconds (×60) so all
      // reporting / talk-time (which read durationSec in seconds) stay correct.
      const durationToSend = logChannel === "WHATSAPP" ? 0
                          : (showDurationField ? Math.round((Number(duration) || 0) * 60) : 0);
      // Prefix the remarks so Call History can show the right icon + the
      // channel/direction context. Backend stores everything in notes.
      const remarksPrefix = logChannel === "WHATSAPP"
        ? (logDirection === "INBOUND" ? "💬 WA in — " : "💬 WA out — ")
        : (logDirection === "INBOUND" ? "📞 They called — " : "");
      const finalRemarks = remarksPrefix
        ? (remarks ? `${remarksPrefix}${remarks}` : remarksPrefix.replace(/ — $/, ""))
        : remarks;
      const r = await fetch(`/api/leads/${leadId}/log-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: currentOutcomeV,
          remarks: finalRemarks,
          durationSec: durationToSend,
          direction: logDirection,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed"); return; }
      setShowCall(false); setRemarks(""); setDuration("");
      setLogChannel("PHONE"); setLogDirection("OUTBOUND"); setOutcomeKey("");
      // Gamification — show toast if the server credited XP for this call.
      // Pattern: read `awardedXp` from the JSON response, fire the toast,
      // then refresh. Never blocks UI — toast is fire-and-forget.
      if (j.awardedXp) {
        showXpToast({
          amount: j.awardedXp.amount,
          label: j.awardedXp.label,
          leveledUp: !!j.awardedXp.leveledUp,
          newLevel: j.awardedXp.newLevel,
        });
      }
      router.refresh();
      // Force the agent to close the follow-up now that a contact attempt is
      // logged: open the "What next?" prompt (Complete / Snooze / Escalate).
      setShowNextPrompt(true);
    } finally { setBusy(false); }
  }

  async function onReassign(userId: string) {
    if (!userId || userId === currentOwnerId) return;
    setAssignBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (r.ok) router.refresh();
    } finally { setAssignBusy(false); }
  }

  return (
    // A single block div is required here — the parent mounts LeadActionsClient
    // inside a flex container alongside BestCallTimeChip. A bare fragment would
    // unwrap all children into flex items, causing the buttons grid and the alt-
    // phone section to lay out horizontally instead of stacking vertically. The
    // w-full ensures the block spans the container width on every viewport.
    <div className="w-full min-w-0">
      {/* Primary phone masked display REMOVED per Lalit's ask. The tap-to-call
          action lives in the action grid below — the masked-number line was
          duplicative noise. Real number is still used when the agent taps Call. */}

      {/* Primary action bar — in-flow grid under the chips + email/company
          sub-line in the lead-detail header card, both on mobile and desktop.
          Channel buttons are OMITTED entirely (not faded/disabled) when the
          channel is unavailable. */}
      {!phone && (
        <div className="mt-3 mb-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <Phone className="w-3.5 h-3.5 flex-none" />
          No phone number saved — add one in the Qualification panel to enable Call &amp; WhatsApp.
        </div>
      )}
      {/* Primary action row — flex-wrap (was a fixed 3/5-col grid) so the
          follow-up actions (Complete / Snooze / Escalate, injected via
          `extraActions`) sit on the SAME line as Call / WhatsApp / Email /
          Log Call / Note instead of a separate stacked row below it. Every
          direct child (primary buttons + the injected follow-up buttons) gets
          `flex-1 basis-28` so they size uniformly and wrap gracefully on narrow
          widths — compact, above-the-fold, no overlap. */}
      <div className="flex flex-wrap gap-1.5 mt-2 [&>*]:grow [&>*]:basis-24">
        {/* Call / Log Call / Note now render from the central Action Design System
            (src/lib/actionDesign.ts) — same icon+colour everywhere. WhatsApp &
            Email stay as TemplatePickerButton (they open the template/gallery
            picker, not a plain link) but use the same WA/Email token colours.
            Handlers/hrefs are unchanged. The Note token bakes in the dark-navy-
            on-amber contrast fix (no global rule can hijack `bg-[#fcd34d]`).
            size="sm" = the shared compact density (Lalit's detail-view density
            rule) — smaller height + padding, icons + labels kept. */}
        {phone && (
          <ActionButton action="call" size="sm" href={telUrl(phone)} onClick={logCallClick} />
        )}
        {phone && (
          <TemplatePickerButton lead={{ id: leadId, name: leadName, phone, email }} kind="WHATSAPP" compact />
        )}
        {email && (
          <TemplatePickerButton lead={{ id: leadId, name: leadName, phone, email }} kind="EMAIL" compact />
        )}
        <ActionButton action="logCall" size="sm" onClick={() => setShowCall(true)} />
        <ActionButton
          action="note"
          size="sm"
          onClick={() => window.dispatchEvent(new CustomEvent(`open-sticky-${leadId}`))}
        />
        {/* Follow-up actions (Complete / Snooze / Escalate) — injected by the
            lead-detail page. Rendered here so they share this same flex row.
            The component's root is `display:contents`, so its three buttons
            become direct children of this row and inherit the sizing above. */}
        {extraActions}
      </div>

      {/* Alt-phone (2nd number from MIS). Lalit's ask: "WA alt, call alt
          should only display after primary ones, and only when there are 2
          entries". So: render AFTER the primary bar, and only when BOTH
          primary + alt phones exist (a lone alt with no primary makes no
          sense — it'd just BE the primary). hasDialableNumber() additionally
          rejects a blank / whitespace / bare-dial-prefix alt (e.g. "+91" left
          over from normalization) so the Call-alt / WhatsApp-alt buttons only
          show when there is a genuinely dialable second number. */}
      {hasDialableNumber(phone) && hasDialableNumber(altPhone) && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">
            📱 Alternate number
          </div>
          <div className="grid grid-cols-2 gap-1.5 [&>*]:w-full">
            {/* Same Call / WhatsApp actions, on the 2nd number — rendered from the
                shared tokens (compact size) so they match the primary ones. */}
            <ActionButton action="call" size="sm" href={telUrl(altPhone)} label="Call alt" onClick={dial({ leadId, phone: altPhone })} />
            <ActionButton
              action="whatsapp"
              size="sm"
              href={waUrl(altPhone)}
              label="WA alt"
              external
              onClick={() => logWaClick("click")}
            />
          </div>
        </div>
      )}

      {/* Acefone click-to-call — rings agent first, then dials lead. Hidden when not configured. */}
      {phone && acefoneEnabled && (
        <button
          onClick={callViaAcefone}
          disabled={acefoneBusy || !acefoneMappedForUser}
          title={acefoneMappedForUser ? "Acefone will call your phone, then connect the lead automatically" : "Ask admin to set your Acefone agent id in Team & Roles"}
          className="w-full flex items-center justify-center gap-2 mt-2 py-2 rounded-xl bg-[#0b1a33] text-white text-sm font-semibold hover:bg-[#0f2347] transition disabled:opacity-50 min-h-11"
        >
          <Phone className="w-4 h-4" />
          {acefoneBusy ? "Connecting…" : acefoneMappedForUser ? "📞 Call via Acefone (auto-record)" : "📞 Acefone — admin needs to map your agent id"}
        </button>
      )}
      {acefoneMsg && (
        <div className={`mt-2 text-xs p-2 rounded-lg ${acefoneMsg.startsWith("📞") ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>{acefoneMsg}</div>
      )}
      {canReassign && !hideReassign && (
        <div className="mt-3 flex items-center gap-2 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
          <span className="text-xs text-gray-500 font-semibold">REASSIGN TO:</span>
          <select
            defaultValue={currentOwnerId ?? ""}
            disabled={assignBusy}
            onChange={(e) => onReassign(e.target.value)}
            className="text-sm border-0 bg-transparent outline-none flex-1"
          >
            <option value="">— pick agent —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>
            ))}
          </select>
        </div>
      )}

      {showCall && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4" {...backdropProps(() => setShowCall(false))}>
          {/* Mobile: bottom-sheet (full-width, slides up from bottom, scrollable).
              Desktop / iPad: centered card. Both cap height at 90vh so the form
              scrolls internally instead of overflowing off-screen. */}
          <div
            className="bg-white sm:rounded-xl rounded-t-2xl max-w-lg w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold mb-3 text-lg">Log conversation</div>

            {/* Channel toggle — Phone or WhatsApp. Direction is only
                relevant for WhatsApp (to distinguish "we sent" vs "client
                sent"); phone calls are always agent-initiated (outbound). */}
            <div className="mb-3">
              <label className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">Channel</label>
              <div className="grid grid-cols-2 gap-1 mt-1 border border-[#e5e7eb] rounded-lg p-1">
                <button type="button" onClick={() => { setLogChannel("PHONE"); setLogDirection("OUTBOUND"); setOutcomeKey(""); }}
                  className={`py-1.5 rounded text-xs font-semibold transition ${logChannel === "PHONE" ? "bg-[#0b1a33] text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                  📞 Phone
                </button>
                <button type="button" onClick={() => { setLogChannel("WHATSAPP"); setOutcomeKey(""); }}
                  className={`py-1.5 rounded text-xs font-semibold transition ${logChannel === "WHATSAPP" ? "bg-emerald-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                  💬 WhatsApp
                </button>
              </div>
            </div>

            {/* Direction — only shown when WhatsApp is selected */}
            {logChannel === "WHATSAPP" && (
              <div className="mb-3">
                <label className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">Direction</label>
                <div className="grid grid-cols-2 gap-1 mt-1 border border-[#e5e7eb] rounded-lg p-1">
                  <button type="button" onClick={() => { setLogDirection("OUTBOUND"); setOutcomeKey(""); }}
                    className={`py-1.5 rounded text-xs font-semibold transition ${logDirection === "OUTBOUND" ? "bg-[#0b1a33] text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                    📤 Outbound (We Sent)
                  </button>
                  <button type="button" onClick={() => { setLogDirection("INBOUND"); setOutcomeKey(""); }}
                    className={`py-1.5 rounded text-xs font-semibold transition ${logDirection === "INBOUND" ? "bg-[#0b1a33] text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                    📥 Inbound (Client Sent)
                  </button>
                </div>
              </div>
            )}

            <label className="text-xs font-semibold text-gray-600">Outcome <span className="text-red-600">*</span></label>
            <select
              ref={outcomeRef}
              value={outcomeKey}
              onChange={(e) => { setOutcomeKey(e.target.value); if (err) setErr(null); }}
              className={`w-full mt-1 mb-3 border rounded-lg px-3 py-2 text-sm ${outcomeKey ? "border-[#e5e7eb]" : "border-red-300 text-gray-500"}`}
            >
              <option value="" disabled>-- Select Outcome --</option>
              {currentOutcomeOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            {/* Duration only shown when the call could have lasted measurable
                time — connected, interested, not-interested (heard them out),
                or a callback agreement. Hidden for not-picked / switched-off /
                busy / wrong-number where duration is always 0. */}
            {showDurationField && (
              <>
                <label className="text-xs font-semibold text-gray-600">Duration (minutes, optional)</label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^\d]/g, "");
                    setDuration(cleaned);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "-" || e.key === "e" || e.key === "E" || e.key === "+" || e.key === ".") {
                      e.preventDefault();
                    }
                  }}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (!isFinite(n) || n < 0) setDuration("");
                  }}
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="e.g. 4"
                  className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm min-h-11"
                />
              </>
            )}

            {/* Follow-up scheduler intentionally REMOVED from logging (Lalit's rule:
                the follow-up is set only via Complete / Snooze / Escalate /
                Reschedule / Admin). After Save, the "What next?" popup opens so the
                agent closes the follow-up there. */}

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-600">Remarks <span className="text-red-600">*</span> <span className="text-gray-400 font-normal">(what did the client say?)</span></label>
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleDictation}
                  title={listening ? "Stop dictation" : "Tap to dictate remarks"}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition border ${
                    listening
                      ? "bg-red-50 border-red-300 text-red-600 animate-pulse"
                      : "bg-red-50 border-red-200 text-red-500 hover:bg-red-100"
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  {listening ? "Stop" : "Dictate"}
                </button>
              )}
            </div>
            <textarea ref={remarksRef} value={remarks} onChange={(e) => { setRemarks(e.target.value); if (err) setErr(null); }} rows={4}
              placeholder="Be specific: client's exact concern, budget mentioned, next step agreed…"
              className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm font-mono text-[13px] ${remarks.trim() ? "border-[#e5e7eb]" : "border-red-300"}`} />
            {err && <div className="text-xs text-red-600 mt-2 flex gap-1 items-center"><AlertCircle className="w-3 h-3" /> {err}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCall(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={submitCall} disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save Call"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Post-log "What next?" prompt — opens after a successful Log Call so the
          agent closes the follow-up. Reuses the shared action endpoints. */}
      <FollowupNextPopup
        open={showNextPrompt}
        leadId={leadId}
        leadName={leadName}
        onClose={() => setShowNextPrompt(false)}
      />
    </div>
  );
}
