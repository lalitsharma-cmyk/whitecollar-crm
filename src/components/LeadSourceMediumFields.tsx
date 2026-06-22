"use client";

import { useState } from "react";

// Self-contained client block for the New-Lead form covering:
//   • Source <select>  (drives conditional fields via React state)
//   • Source Detail
//   • Medium <select> + custom "Other" input (writes to hidden inputs the
//     server action reads: name="medium" / name="mediumOther")
//   • WCR Event fields  (shown only when Source = WCR_EVENT)
//   • Referrer Name     (shown only when Source = REFERRAL)
//
// This replaces (a) the old <script dangerouslySetInnerHTML> show/hide hack and
// (b) the MediumSelect instance that received a non-serializable onChange arrow
// from the Server Component — both of which crashed the RSC render.

const input = "w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm";
const label = "text-xs font-semibold text-gray-600";

const SOURCE_LABELS: Record<string, string> = {
  WEBSITE: "Website",
  WCR_WEBSITE: "Website",
  WCR_EVENT: "WCR Event",
  LANDING_PAGE: "Landing Page",
  WHATSAPP: "WhatsApp",
  CSV_IMPORT: "CSV Import",
  EVENT: "Event",
  REFERRAL: "Referral",
  INBOUND_CALL: "Call",
  FACEBOOK_ADS: "Facebook Ads",
  GOOGLE_ADS: "Google Ads",
  PORTAL_99ACRES: "Portal 99acres",
  PORTAL_MAGICBRICKS: "Portal MagicBricks",
  PORTAL_HOUSING: "Portal Housing",
  OTHER: "Other",
};

interface Props {
  sources: string[];
  mediums: string[];
}

export default function LeadSourceMediumFields({ sources, mediums }: Props) {
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [mediumOther, setMediumOther] = useState("");

  const showEvent = source === "WCR_EVENT";
  const showReferral = source === "REFERRAL";
  const showCustomMedium = medium === "Other";

  return (
    <>
      {/* Hidden inputs consumed by createLeadAction */}
      <input type="hidden" name="medium" value={medium} />
      <input type="hidden" name="mediumOther" value={showCustomMedium ? mediumOther : ""} />

      <div>
        <label className={label}>Source</label>
        <select
          name="source"
          className={input}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">— Select source —</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s] || s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={label}>Source Detail</label>
        <input name="sourceDetail" placeholder="e.g. campaign code, event name" className={input} />
      </div>

      <div>
        <label className={label}>Medium</label>
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
            placeholder="Enter custom medium name"
            value={mediumOther}
            onChange={(e) => setMediumOther(e.target.value)}
            className={`${input} mt-2`}
          />
        )}
      </div>

      {/* WCR Event conditional fields */}
      {showEvent && (
        <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <div><label className={label}>Event Name</label><input name="eventName" className={input} /></div>
          <div><label className={label}>Event Country</label><input name="eventCountry" className={input} /></div>
          <div><label className={label}>Event State</label><input name="eventState" className={input} /></div>
          <div><label className={label}>Event City</label><input name="eventCity" className={input} /></div>
        </div>
      )}

      {/* Referral conditional field */}
      {showReferral && (
        <div className="md:col-span-3">
          <label className={label}>Referrer Name</label>
          <input name="referralName" placeholder="Name of the person who referred this lead" className={input} />
        </div>
      )}
    </>
  );
}
