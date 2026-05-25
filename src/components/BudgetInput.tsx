"use client";
import { useEffect, useState } from "react";
import { parseBudget, formatBudget } from "@/lib/budgetParse";

interface Props {
  name: string;
  defaultValue?: number | string;
  currency: "AED" | "INR";
  placeholder?: string;
}

/**
 * Smart budget input — accepts "2.5M", "30L", "3Cr", "500K" etc. and shows a
 * live preview of the parsed numeric value.
 *
 * Outputs a hidden number field with the parsed value (under the same `name`)
 * so existing server actions / form handlers don't need to change.
 *
 *   AED currency → K / M / Bn suffixes recognised
 *   INR currency → K / L / Cr suffixes recognised
 *
 * Lalit asked: "Allow K (thousand), M (Million) in Dubai. and Cr and Lakh in India".
 */
export default function BudgetInput({ name, defaultValue, currency, placeholder }: Props) {
  const [raw, setRaw] = useState(() => {
    if (defaultValue == null || defaultValue === "") return "";
    return String(defaultValue);
  });
  const [parsed, setParsed] = useState<number | null>(() => parseBudget(defaultValue));

  useEffect(() => { setParsed(parseBudget(raw)); }, [raw]);

  const exampleHint = currency === "INR"
    ? "type 30L · 3Cr · 500K · or full number"
    : "type 2.5M · 500K · or full number";

  return (
    <div>
      <div className="flex items-stretch border border-[#e5e7eb] rounded-lg overflow-hidden">
        <span className="bg-[#f5f6fa] border-r border-[#e5e7eb] px-3 py-2 text-xs font-mono text-gray-600 flex items-center min-h-11">
          {currency}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={placeholder ?? (currency === "INR" ? "e.g. 3 Cr or 30000000" : "e.g. 2.5M or 2500000")}
          className="flex-1 min-w-0 px-3 py-2 text-sm outline-none min-h-11"
        />
      </div>
      {/* Hidden numeric value submitted with the form */}
      <input type="hidden" name={name} value={parsed ?? ""} />
      <p className="text-[10px] text-gray-500 mt-1 leading-snug">
        {raw && parsed != null && (
          <span className="text-emerald-700">
            ✓ {currency} {parsed.toLocaleString(currency === "INR" ? "en-IN" : "en-US")}
            {parsed > 0 && <> · <b>{formatBudget(parsed, currency)}</b></>}
          </span>
        )}
        {raw && parsed == null && (
          <span className="text-red-600">⚠ Couldn&apos;t parse — try 2.5M, 30L, 3Cr, or just digits</span>
        )}
        {!raw && <span>{exampleHint}</span>}
      </p>
    </div>
  );
}
