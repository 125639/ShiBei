"use client";

import { useEffect, useRef } from "react";

/**
 * 给表单挂 beforeunload 警告:只有用户改过(dirty=true)时浏览器才会拦截关闭/刷新。
 *
 * 用法:
 *   <form ref={formRef} onChange={() => setDirty(true)} onSubmit={() => setDirty(false)}>
 * 然后:
 *   useUnsavedChangesGuard(dirty);
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const ref = useRef(dirty);
  ref.current = dirty;

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!ref.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const onDocumentClick = (event: MouseEvent) => {
      if (!ref.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      if (window.confirm("有未保存的修改，确定离开当前页面吗？")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("beforeunload", handler);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handler);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, []);
}
