"use client";
import { useEffect } from "react";

/**
 * Lock background body scroll while a modal/sheet/drawer is mounted.
 *
 * Without this, opening a modal on mobile causes the underlying page to keep
 * its momentum scroll — momentary jumps & shifts that read as "form UI got
 * distorted when the popup opened". Adding `body.modal-open` flips overflow:hidden
 * (CSS rule in globals.css) and the page sits still under the modal.
 *
 * Multiple modals can be open at once (a picker over a sheet over the page).
 * A reference counter handles the nesting: we only release the lock when the
 * LAST consumer unmounts.
 *
 * Usage:
 *   useBodyScrollLock(showModal);   // boolean — locks while true
 */
let lockCount = 0;

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    if (lockCount === 1) {
      document.body.classList.add("modal-open");
    }
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.classList.remove("modal-open");
      }
    };
  }, [active]);
}
