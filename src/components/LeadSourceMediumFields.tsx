"use client";

import { useEffect, useState } from "react";
import LocationSelect from "@/components/LocationSelect";
// Source vocabulary is centralised so the New-Lead form, Quick-Add FAB,
// lead-detail inline edit, and Master-Data bulk edit can't drift apart and
// re-introduce a deprecated source value. See src/lib/lead-sources.ts.
import { ALLOWED_SOURCES, SOURCE_LABELS } from "@/lib/lead-sources";

// Self-contained client block for the New-Lead form covering:
//   • Source <select>  (drives conditional fields via React state)
//   • Medium <select> + custom "Other" input (writes hidden inputs the server
//     action reads: name="medium" / name="mediumOther")
//   • Source Detail    (HIDDEN for WCR Event so it never sits between Source and
//     Medium — task 12)
//   • WCR Event fields (shown only when Source = WCR_EVENT) in the exact order
//     Source → Medium → Event Name → Event Country → Event State → Event City
//   • Event Name       = dropdown (Eventbrite/Townscript/BookMyShow/AllEvents/
//     Other) + manual entry; custom names reappear next time (task 13)
//   • Event location   = Country→State→City cascade via LocationSelect (task 14)
//   • Referrer Name    (shown only when Source = REFERRAL)
//
// RSC-safe: marked "use client", no server-only imports. The available source
// list, medium list and event-name list are passed in as serializable string[]
// props from the Server Component page.

const input = "w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm";
const label = "text-xs font-semibold text-gray-600";

// SOURCE_LABELS + ALLOWED_SOURCES now live in @/lib/lead-sources (the single
// source of truth) — imported above. WCR_WEBSITE is dropped (dupe "Website") and
// WHATSAPP / INBOUND_CALL / EMAIL / EVENT are absent (task 11; channel → Medium).

interface Props {
  sources: string[];
  mediums: string[];
  eventNames: string[];
}

export default function LeadSourceMediumFields({ sources, mediums, eventNames }: Props) {
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [mediumOther, setMediumOther] = useState("");
  const [eventNameSel, setEventNameSel] = useState("");
  const [eventNameOther, setEventNameOther] = useState("");

  const showEvent = source === "WCR_EVENT";
  const showReferral = source === "REFERRAL";
  const showCustomMedium = medium === "Other";
  const showCustomEventName = eventNameSel === "Other";

  // The value actually submitted for the event name: the picked option, or the
  // typed custom value when "Other" is selected.
  const eventNameValue = showCustomEventName ? eventNameOther : eventNameSel;

  // Filter + order the source options to the allow-list. Keep only sources the
  // server actually knows about (intersection) so a renamed/removed enum value
  // can't 500 the form; fall back to ALLOWED_SOURCES order.
  const serverSet = new Set(sources);
  const sourceOptions = ALLOWED_SOURCES.filter((s) => serverSet.has(s));

  // When the source switches away from WCR Event, clear the event-name state so
  // a stale custom value isn't silently submitted.
  useEffect(() => {
    if (!showEvent) {
      setEventNameSel("");
      setEventNameOther("");
    }
  }, [showEvent]);

  return (
    <>
      {/* Hidden inputs consumed by createLeadAction */}
      <input type="hidden" name="medium" value={medium} />
      <input type="hidden" name="mediumOther" value={showCustomMedium ? mediumOther : ""} />
      {/* eventName posts the resolved value (selected OR custom). Only meaningful
          when source = WCR_EVENT; the server only reads it then. */}
      <input type="hidden" name="eventName" value={showEvent ? eventNameValue : ""} />

      {/* 1. Source */}
      <div>
        <label className={label}>Source</label>
        <select
          name="source"
          className={input}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">— Select source —</option>
          {sourceOptions.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s] || s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Medium of Source (always second — directly after Source) */}
      <div>
        <label className={label}>Medium of Source</label>
        <select
          className={input}
          value={medium}
          onChange={(e) => setMedium(e.target.value)}
        >
          <option value="">— Select medium —</option>
          {mediums.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {showCustomMedium && (
          <input
            type="text"
            value={mediumOther}
            onChange={(e) => setMediumOther(e.target.value)}
            className={`${input} mt-2`}
          />
        )}
      </div>

      {/* Source Detail — shown for every source EXCEPT WCR Event (task 12: it
          must NOT sit between Source and Medium for WCR Event). */}
      {!showEvent && (
        <div>
          <label className={label}>Source Detail</label>
          <input name="sourceDetail" className={input} />
        </div>
      )}

      {/* WCR Event block — Event Name, then the Country→State→City cascade.
          Rendered AFTER Source + Medium so the on-screen order is exactly
          Source → Medium → Event Name → Event Country → Event State → Event City. */}
      {showEvent && (
        <>
          <div>
            <label className={label}>Event Name</label>
            <select
              className={input}
              value={eventNameSel}
              onChange={(e) => setEventNameSel(e.target.value)}
            >
              <option value="">— Select event —</option>
              {eventNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {showCustomEventName && (
              <input
                type="text"
                value={eventNameOther}
                onChange={(e) => setEventNameOther(e.target.value)}
                className={`${input} mt-2`}
              />
            )}
          </div>

          <LocationSelect
            names={{ country: "eventCountry", state: "eventState", city: "eventCity" }}
            labelPrefix="Event "
          />
        </>
      )}

      {/* Referral conditional field */}
      {showReferral && (
        <div className="md:col-span-3">
          <label className={label}>Referrer Name</label>
          <input name="referralName" className={input} />
        </div>
      )}
    </>
  );
}
