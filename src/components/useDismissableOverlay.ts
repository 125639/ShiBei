"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

/**
 * 弹层的统一关闭行为：pointerdown / 焦点移动落在弹层外即关闭；
 * Escape 关闭并把焦点还给触发按钮。open=false 时不挂任何监听。
 * QuickStylePanel 与 ThemeQuickSwitch 共用，避免两份逐字相同的
 * 监听器实现在后续修键盘/触摸边界问题时漏改其中一份。
 */
export function useDismissableOverlay(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  restoreFocusRef?: RefObject<HTMLElement | null>
) {
  // onClose 通常是内联箭头函数；Effect Event 让 document 监听器保持稳定，
  // 同时每次触发时仍读取最新的关闭逻辑。
  const closeOverlay = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeOverlay();
    }

    function onFocusIn(event: FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeOverlay();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeOverlay();
      requestAnimationFrame(() => restoreFocusRef?.current?.focus());
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, rootRef, restoreFocusRef]);
}
