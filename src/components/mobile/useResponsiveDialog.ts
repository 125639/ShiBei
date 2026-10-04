"use client";

import { useEffect, useEffectEvent, type RefObject, type MouseEvent } from "react";

const MOBILE_DIALOG = "(max-width: 720px), (max-height: 520px) and (pointer: coarse)";

/** The native top layer escapes transformed/backdrop-filter header ancestors.
 * On phones it also gives us focus trapping, an inert background and Escape.
 */
export function useResponsiveDialog(
  open: boolean,
  dialogRef: RefObject<HTMLDialogElement | null>,
  onClose: () => void,
  mode: "always" | "mobile" = "always",
  triggerRef?: RefObject<HTMLElement | null>
) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const media = window.matchMedia(MOBILE_DIALOG);
    const trigger = triggerRef?.current;
    let previousOverflow: string | null = null;
    let currentModal: boolean | null = null;
    const unlock = () => {
      if (previousOverflow !== null) {
        document.documentElement.style.overflow = previousOverflow;
        previousOverflow = null;
      }
    };
    const sync = () => {
      const modal = mode === "always" || media.matches;
      if (dialog.open && currentModal === modal) return;
      dialog.close();
      unlock();
      currentModal = modal;
      if (modal) {
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = "hidden";
        dialog.showModal();
        dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus({ preventScroll: true });
      } else dialog.show();
    };
    const closed = () => {
      // Changing breakpoint closes then reopens the same dialog. Its queued
      // close event must not close the freshly reconfigured panel.
      if (dialog.open) return;
      unlock();
      close();
    };
    dialog.addEventListener("close", closed);
    media.addEventListener("change", sync);
    sync();
    return () => {
      dialog.removeEventListener("close", closed);
      media.removeEventListener("change", sync);
      dialog.close();
      unlock();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open, dialogRef, mode, triggerRef]);
}

export function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>, close: () => void) {
  if (event.target !== event.currentTarget) return;
  const box = event.currentTarget.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
    close();
}
