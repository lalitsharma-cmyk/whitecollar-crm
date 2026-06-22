"use client";

import { useState, useEffect } from "react";
import { getAvailableMediums } from "@/lib/mediumManager";

interface MediumSelectProps {
  value: string | null;
  customValue: string | null;
  onChange: (medium: string | null, custom?: string | null) => void;
  disabled?: boolean;
  required?: boolean;
}

export default function MediumSelect({
  value,
  customValue,
  onChange,
  disabled = false,
  required = false,
}: MediumSelectProps) {
  const [mediums, setMediums] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCustom, setShowCustom] = useState(value === "Other");

  useEffect(() => {
    getAvailableMediums()
      .then(setMediums)
      .finally(() => setLoading(false));
  }, []);

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
