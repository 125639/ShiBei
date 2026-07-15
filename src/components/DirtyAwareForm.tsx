"use client";

import { useState, type ReactNode } from "react";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

type Props = {
  children: ReactNode;
  action: string;
  method?: "post" | "POST";
  id?: string;
  className?: string;
  encType?: string;
};

/**
 * 包裹 admin form 的 client wrapper:
 * - 检测内部字段变更,挂 beforeunload 警告
 * - submit 时清除 dirty 标记(submit 成功后页面会跳转,自然不再 dirty)
 *
 * 当 form 内部还有更精细的 client logic(autosave 等)时,可以替换为更专门
 * 的 wrapper;此组件只解决"误关页面丢稿"这一条最关键的体验问题。
 */
export function DirtyAwareForm({
  children,
  action,
  method = "post",
  id,
  className,
  encType
}: Props) {
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);

  return (
    <form
      id={id}
      action={action}
      method={method}
      className={className}
      encType={encType}
      onInputCapture={() => setDirty(true)}
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
    >
      {children}
    </form>
  );
}
