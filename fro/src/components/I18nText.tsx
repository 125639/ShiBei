import type { ReactNode } from "react";

export function I18nText({ zh, en, className }: { zh: ReactNode; en: ReactNode; className?: string }) {
  return (
    <>
      <span className={["i18n-zh", className].filter(Boolean).join(" ")}>{zh}</span>
      <span className={["i18n-en", className].filter(Boolean).join(" ")}>{en}</span>
    </>
  );
}
