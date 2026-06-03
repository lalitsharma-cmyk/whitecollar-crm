"use client";
import { useState } from "react";

interface Props { phone: string }
export default function CopyPhoneButton({ phone }: Props) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: select text
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-xs text-gray-400 hover:text-gray-600 px-1"
      title="Copy phone number"
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}
