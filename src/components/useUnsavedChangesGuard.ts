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
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
}
