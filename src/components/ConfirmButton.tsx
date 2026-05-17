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
};

export function ConfirmButton({
  children,
  message,
  className = "danger-button",
  name,
  value,
  formAction,
  formMethod
}: Props) {
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      formAction={formAction}
      formMethod={formMethod}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
