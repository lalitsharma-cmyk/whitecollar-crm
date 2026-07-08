"use client";
import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// backdropProps — the fix for `fixed inset-0` MODAL backdrops that close on click.
//
// The old pattern `<div className="fixed inset-0 …" onClick={onClose}>` closes the
// modal whenever a `click` bubbles to the backdrop. A text-selection drag that
// STARTS inside the modal (e.g. inside a textarea) and ENDS on the backdrop fires
// a `click` on the backdrop (the nearest common ancestor of the down + up targets)
// — so selecting text and releasing near the edge silently closed the box and
// dropped the draft. Inner `onClick={e => e.stopPropagation()}` does NOT help,
// because the click's target IS the backdrop, not the inner content.
//
// backdropProps closes ONLY when the pointer BOTH pressed down AND released on the
// backdrop itself (a real "click the dark area to dismiss"). Any gesture that began
// inside the modal is ignored. Drop-in: replace `onClick={onClose}` on the backdrop
// with `{...backdropProps(onClose)}`. The armed flag lives on the DOM node (dataset)
// so it survives re-renders between the press and the release.
// ─────────────────────────────────────────────────────────────────────────────
export function backdropProps(onClose: () => void) {
  return {
    onMouseDown: (e: ReactMouseEvent<HTMLElement>) => {
      if (e.target === e.currentTarget) e.currentTarget.dataset.bdArmed = "1";
      else delete e.currentTarget.dataset.bdArmed;
    },
    onMouseUp: (e: ReactMouseEvent<HTMLElement>) => {
      const armed = e.currentTarget.dataset.bdArmed === "1";
      delete e.currentTarget.dataset.bdArmed;
      if (armed && e.target === e.currentTarget) onClose();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useDismiss — close a popover / menu / modal / drawer ONLY on a GENUINE outside
// interaction, never on a text-selection gesture that happens to end outside.
//
// THE BUG THIS FIXES (Lalit 2026-07-08): every action box (WhatsApp message,
// Log Call, Note, Remark, template picker, escalate, …) closed the instant you
// tried to select text inside its textarea, dropping the draft. Cause: the old
// pattern
//     useEffect(() => { document.addEventListener("mousedown", e =>
//       ref.current && !ref.current.contains(e.target) && close()); … }, [open]);
// treats the *end* of a drag as an outside click. When you press inside the
// textarea and drag to select, the mouse can travel/settle outside the box, and
// a plain outside-check fires → the box closes mid-selection.
//
// IMPORTANT: a selection INSIDE a <textarea>/<input> is NOT reflected by
// window.getSelection() (that only covers regular DOM / contenteditable), so a
// "selection is active" check alone cannot save form fields. The reliable signal
// is WHERE THE POINTER WENT DOWN: if the gesture began inside the box, it is a
// drag/selection and must never dismiss — regardless of where it ends.
//
// This hook therefore dismisses only when:
//   • the pointer went DOWN outside the box (not a drag that began inside), AND
//   • the pointer came UP outside the box, AND
//   • there is no active document text selection (covers contenteditable), AND
//   • the target isn't the ignored trigger (so the toggle button can close it).
//
// Drop-in for the old mousedown pattern: attach the returned ref to the box.
//   const boxRef = useDismiss(open, () => setOpen(false));
//   return open ? <div ref={boxRef}>…</div> : null;
// ─────────────────────────────────────────────────────────────────────────────
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onDismiss: () => void,
  opts?: {
    /** Trigger/toggle element to ignore, so clicking it isn't treated as "outside". */
    ignore?: React.RefObject<HTMLElement | null>;
    /** Also dismiss on Escape (default true). */
    escape?: boolean;
  },
) {
  const ref = useRef<T>(null);
  // Keep the latest callback without re-subscribing the listeners every render.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    let downInside = false;

    const within = (node: EventTarget | null): boolean => {
      const t = node as Node | null;
      if (!t) return false;
      if (ref.current?.contains(t)) return true;
      const ig = opts?.ignore?.current;
      return !!(ig && ig.contains(t));
    };

    const onDown = (e: Event) => { downInside = within(e.target); };
    const onUp = (e: Event) => {
      const startedInside = downInside;
      downInside = false;
      if (startedInside) return;            // gesture began inside → drag/selection, keep open
      if (within(e.target)) return;         // ended inside → keep open
      // Active document selection (contenteditable / normal DOM) → user is selecting, keep open.
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (sel && !sel.isCollapsed && sel.toString().length > 0) return;
      dismissRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((opts?.escape ?? true) && e.key === "Escape") dismissRef.current();
    };

    // Capture phase: observe the true target before any child stops propagation.
    // Pointer events cover mouse + touch + pen with one code path.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("keydown", onKey);
    };
    // opts is read fresh each fire; only re-subscribe when open toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return ref;
}
