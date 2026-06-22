"use client";

import { useState, useEffect } from "react";

interface MediumSelectProps {
  value: string | null;
  customValue: string | null;
  onChange: (medium: string | null, custom?: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  /**
   * Mediums may be supplied directly (server-fetched and passed as a prop — the
   * preferred pattern). When omitted, the component fetches them from /api/mediums.
   * Either way it NEVER imports getAvailableMediums (that would bundle Prisma into
   * the client and break the server/client boundary).
   */
  availableMediums?: string[];
}

export default function MediumSelect({
  value,
  customValue,
  onChange,
  disabled = false,
  required = false,
  availableMediums,
}: MediumSelectProps) {
  const [mediums, setMediums] = useState<string[]>(availableMediums ?? []);
  const [loading, setLoading] = useState(!availableMediums);
  const [showCustom, setShowCustom] = useState(value === "Other");

  useEffect(() => {
    if (availableMediums) {
      setMediums(availableMediums);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch("/api/mediums")
      .then((r) => (r.ok ? r.json() : { mediums: [] }))
      .then((d: { mediums?: string[] }) => {
        if (!cancelled) setMediums(d.mediums ?? []);
      })
      .catch(() => {
        if (!cancelled) setMediums([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [availableMediums]);

  const handleMediumChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const m = e.target.value || null;
    const isOther = m === "Other";
    setShowCustom(isOther);
    if (isOther) {
      onChange(m, customValue);
    } else {
      onChange(m, null);
    }
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange("Other", e.target.value || null);
  };

  if (loading) {
    return <select disabled className="select select-bordered w-full opacity-50" />;
  }

  return (
    <div className="space-y-2">
      <select
        value={value ?? ""}
        onChange={handleMediumChange}
        disabled={disabled}
        required={required}
        className="select select-bordered w-full"
      >
        <option value="">— Select medium —</option>
        {mediums.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {showCustom && (
        <input
          type="text"
          placeholder="Enter custom medium name"
          value={customValue ?? ""}
          onChange={handleCustomChange}
          disabled={disabled}
          className="input input-bordered w-full text-sm"
        />
      )}
    </div>
  );
}
