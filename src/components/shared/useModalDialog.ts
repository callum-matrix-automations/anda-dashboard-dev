"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Opens a real modal dialog in browsers and supplies deterministic keyboard behavior
 * for test environments that do not implement HTMLDialogElement.showModal().
 */
export function useModalDialog(onDismiss: () => void): RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const hasNativeModal = typeof dialog.showModal === "function";

    const dismiss = (event: Event) => {
      event.preventDefault();
      dismissRef.current();
    };
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !hasNativeModal) {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("cancel", dismiss);
    document.addEventListener("keydown", keepFocusInside);
    document.body.style.overflow = "hidden";
    if (hasNativeModal) dialog.showModal();
    else dialog.setAttribute("open", "");

    return () => {
      dialog.removeEventListener("cancel", dismiss);
      document.removeEventListener("keydown", keepFocusInside);
      document.body.style.overflow = previousOverflow;
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      queueMicrotask(() => {
        // Strict Mode can replay this effect before the queued callback runs.
        if (!dialog.open && trigger?.isConnected) trigger.focus();
      });
    };
  }, []);

  return dialogRef;
}
