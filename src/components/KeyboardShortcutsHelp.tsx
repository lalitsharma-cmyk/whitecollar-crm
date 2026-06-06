"use client";
// Global keyboard shortcuts cheatsheet — press `?` (Shift+/) to toggle.
// Mounts once at the shell. Listens for ? when no input/textarea is focused,
// implements a tiny "g X" 2-key navigation state machine (resets after 1s),
// and renders a centered modal with grouped shortcut sections.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Shortcut {
  keys: string[];
  label: string;
}
interface Section {
  title: string;
  shortcuts: Shortcut[];
}

const SECTIONS: Section[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["?"], label: "Show this help" },
      { keys: ["Cmd/Ctrl", "K"], label: "Quick search" },
      { keys: ["g", "h"], label: "Home (dashboard)" },
      { keys: ["g", "l"], label: "Leads" },
      { keys: ["g", "p"], label: "Pipeline" },
      { keys: ["g", "c"], label: "Cold calls" },
      { keys: ["g", "a"], label: "Action list" },
      { keys: ["g", "v"], label: "Vault" },
    ],
  },
  {
    title: "Cold call session",
    shortcuts: [
      { keys: ["1"], label: "Connected" },
      { keys: ["2"], label: "Not picked" },
      { keys: ["3"], label: "Callback" },
      { keys: ["4"], label: "Wrong number" },
      { keys: ["5"], label: "Interested" },
      { keys: ["6"], label: "Not interested" },
      { keys: ["→", "or", "s"], label: "Skip" },
    ],
  },
  {
    title: "Lead detail",
    shortcuts: [
      { keys: ["c"], label: "Click \"Call\" if phone exists" },
      { keys: ["w"], label: "Click \"WhatsApp\"" },
      { keys: ["n"], label: "Open Notes composer" },
      { keys: ["Esc"], label: "Close modal" },
    ],
  },
];

// Routes triggered by the 2-key `g X` sequences. Lives at module scope so
// the keydown handler effect doesn't churn on every render.
const G_NAV: Record<string, string> = {
  h: "/dashboard",
  l: "/leads",
  p: "/leads",
  c: "/cold-calls",
  a: "/action-list",
  v: "/vault",
};

/** Return true when the active element is a text input we should not hijack. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export default function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Two-key sequence state: when the user presses `g`, we arm the machine for
  // up to 1s waiting for the next key. Stored in a ref so the keydown handler
  // can read/write without re-binding.
  const gArmed = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function disarmG() {
      gArmed.current = false;
      if (gTimer.current) {
        clearTimeout(gTimer.current);
        gTimer.current = null;
      }
    }

    function onKey(e: KeyboardEvent) {
      // Never hijack keystrokes while the user is typing in a field.
      if (isTypingTarget(e.target)) return;
      // Ignore when modifier keys (other than Shift for `?`) are held.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // `?` (Shift+/) toggles the cheatsheet.
      if (e.key === "?") {
        e.preventDefault();
        disarmG();
        setOpen((o) => !o);
        return;
      }

      // Esc closes the cheatsheet (only when ours is open — other modals
      // handle their own Esc).
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
        return;
      }

      // While the cheatsheet is open, don't fire navigation shortcuts.
      if (open) return;

      // Two-key `g X` navigation.
      if (gArmed.current) {
        const target = G_NAV[e.key.toLowerCase()];
        disarmG();
        if (target) {
          e.preventDefault();
          router.push(target);
        }
        return;
      }
      if (e.key === "g" || e.key === "G") {
        gArmed.current = true;
        gTimer.current = setTimeout(disarmG, 1000);
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      disarmG();
    };
  }, [open, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-start justify-center px-4"
      style={{ paddingTop: "8vh" }}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-full max-w-2xl bg-white rounded-xl border-2 border-[#c9a24b] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-[#fdfaf2]">
          <div>
            <h2 className="text-lg font-bold text-[#0b1a33]">Keyboard shortcuts</h2>
            <p className="text-xs text-gray-500 mt-0.5">Press <Kbd>?</Kbd> anytime to toggle this help</p>
          </div>
          <button
            onClick={close}
            aria-label="Close shortcuts"
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none p-1"
          >
            &times;
          </button>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 max-h-[70vh] overflow-y-auto">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#c9a24b] mb-3">
                {section.title}
              </h3>
              <ul className="space-y-2">
                {section.shortcuts.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-700 flex-1">{s.label}</span>
                    <span className="flex items-center gap-1 flex-none">
                      {s.keys.map((k, j) =>
                        k === "or" ? (
                          <span key={j} className="text-[10px] text-gray-400 px-0.5">or</span>
                        ) : (
                          <Kbd key={j}>{k}</Kbd>
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Monospace key cap pill. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1.5 text-[11px] font-mono font-semibold text-gray-700 bg-gray-100 border border-gray-300 rounded shadow-[0_1px_0_rgba(0,0,0,0.08)]">
      {children}
    </kbd>
  );
}
