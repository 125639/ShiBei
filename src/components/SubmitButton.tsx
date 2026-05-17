"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  pendingLabel?: ReactNode;
  disabled?: boolean;
  name?: string;
  value?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
};

export function SubmitButton({
  children,
  className = "button",
  pendingLabel,
  disabled,
  name,
  value,
  formAction
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
      name={name}
      value={value}
      formAction={formAction}
    >
      {pending ? (pendingLabel ?? <span className="submit-pending">{children}</span>) : children}
    </button>
  );
}
