"use client";
// VoiceGuidancePin — a compact mic button pinned in the Lead-View header action
// row. Clicking it smooth-scrolls to the "Manager Voice Guidance" card and flashes
// it, so the feature is instantly discoverable (Lalit's "small mic icon on Lead
// View"). Admin sees it to record; everyone with guidance sees it to jump + listen.
import { Mic } from "lucide-react";

export default function VoiceGuidancePin({ count = 0 }: { count?: number }) {
  function jump() {
    const el = document.getElementById("lead-voice-guidance");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-[#c9a24b]", "ring-offset-2");
    setTimeout(() => el.classList.remove("ring-2", "ring-[#c9a24b]", "ring-offset-2"), 1800);
  }
  return (
    <button
      type="button"
      onClick={jump}
      title="Manager Voice Guidance — record / play voice notes for this lead"
      aria-label="Manager Voice Guidance"
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[#0b1a33] text-white hover:bg-[#0b1a33]/90 dark:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
    >
      <Mic className="w-4 h-4" /> Voice Guidance
      {count > 0 && <span className="text-[10px] bg-white/25 rounded px-1 font-mono">{count}</span>}
    </button>
  );
}
