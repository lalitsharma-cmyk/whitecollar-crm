"use client";
import { useState, useMemo } from "react";
import { COUNTRIES, defaultDialForTeam } from "@/lib/phone";

interface Props {
  name: string;            // form field name — value submitted is full E.164 (e.g. "+971501234567")
  defaultValue?: string;   // existing E.164 to pre-fill
  defaultDial?: string;    // override (used when team is known)
  required?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Country-code-aware phone field. Stores E.164 in a hidden input under `name`;
 * the visible input is just the local part.
 *
 * The Dubai team WhatsApp problem was that agents typed "0501234567" — that
 * stripped to "0501234567" which WhatsApp rejects. With this picker the user
 * picks 🇦🇪 +971 once and types "501234567"; we always submit "+971501234567".
 */
export default function PhoneInput({ name, defaultValue, defaultDial, required, placeholder, className }: Props) {
  // Parse defaultValue → (dial, local)
  const [dial, local] = useMemo(() => splitE164(defaultValue, defaultDial), [defaultValue, defaultDial]);
  const [dialState, setDialState] = useState(dial);
  const [localState, setLocalState] = useState(local);
  const e164 = (dialState + localState.replace(/[^\d]/g, "").replace(/^0+/, "")) || "";

  return (
    <div className={`flex items-stretch border border-[#e5e7eb] rounded-lg overflow-hidden ${className ?? ""}`}>
      <select
        value={dialState}
        onChange={(e) => setDialState(e.target.value)}
        aria-label="Country code"
        className="bg-[#f5f6fa] border-r border-[#e5e7eb] px-2 text-xs font-mono outline-none min-w-[88px]"
      >
        {COUNTRIES.map((c) => (
          <option key={c.iso} value={c.dial}>{c.flag} {c.dial} {c.name}</option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={localState}
        onChange={(e) => setLocalState(e.target.value)}
        placeholder={placeholder ?? "50 123 4567"}
        className="flex-1 px-3 py-2 text-sm outline-none"
        required={required}
      />
      {/* Hidden field — what the server reads */}
      <input type="hidden" name={name} value={e164} />
    </div>
  );
}

function splitE164(raw: string | undefined, fallbackDial?: string): [string, string] {
  const dial = fallbackDial ?? defaultDialForTeam(null);
  if (!raw) return [dial, ""];
  // Find the longest dial code that matches the start of `raw`
  const dialOptions = COUNTRIES.map(c => c.dial).sort((a, b) => b.length - a.length);
  for (const d of dialOptions) {
    if (raw.startsWith(d)) return [d, raw.slice(d.length)];
  }
  // No match — just use raw as local part
  return [dial, raw.replace(/^\+/, "")];
}
