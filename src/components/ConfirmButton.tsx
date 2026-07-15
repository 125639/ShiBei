"use client";

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  message: string;
  className?: string;
  name?: string;
  value?: string;
  formAction?: string;
  formMethod?: "post" | "get";
  formNoValidate?: boolean;
};

export function ConfirmButton({
  children,
  message,
  className = "danger-button",
  name,
  value,
  formAction,
  formMethod,
  formNoValidate
}: Props) {
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      formAction={formAction}
      formMethod={formMethod}
      formNoValidate={formNoValidate}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
