"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  pendingLabel?: ReactNode;
  disabled?: boolean;
  name?: string;
  value?: string;
  style?: React.CSSProperties;
  formAction?: (formData: FormData) => void | Promise<void>;
};

/**
 * 带提交中反馈的按钮。两种表单都支持：
 * - React 函数型 action：走 useFormStatus。
 * - 传统 HTML action="/api/..." POST（本项目的主流形态）：useFormStatus 不会变化，
 *   这里监听所在 form 的 submit 事件自己置 pending，浏览器整页跳转前保持
 *   「提交中 + 禁用」，防止重复点击。bfcache 回退时通过 pageshow 复位。
 */
export function SubmitButton({
  children,
  className = "button",
  pendingLabel,
  disabled,
  name,
  value,
  style,
  formAction
}: Props) {
  const { pending: actionPending } = useFormStatus();
  const [nativePending, setNativePending] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const form = buttonRef.current?.form;
    if (!form) return;
    const onSubmit = () => setNativePending(true);
    // 从 bfcache 恢复（用户按返回键）时页面状态被原样保留，需要手动复位。
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setNativePending(false);
    };
    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const pending = actionPending || nativePending;

  return (
    <button
      ref={buttonRef}
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
      name={name}
      value={value}
      style={style}
      formAction={formAction}
    >
      {pending ? (pendingLabel ?? <span className="submit-pending">{children}</span>) : children}
    </button>
  );
}
