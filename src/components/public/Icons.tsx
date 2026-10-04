import type { SVGProps } from "react";

export type IconName =
  | "arrow"
  | "search"
  | "close"
  | "menu"
  | "sun"
  | "moon"
  | "grid"
  | "list"
  | "clock"
  | "copy"
  | "check"
  | "up"
  | "pause"
  | "play"
  | "rss"
  | "pen"
  | "spark";

const paths: Record<IconName, React.ReactNode> = {
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  list: <path d="M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  up: <path d="M12 20V4m-6 6 6-6 6 6" />,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="m8 4 12 8-12 8Z" />,
  rss: (
    <>
      <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </>
  ),
  pen: (
    <>
      <path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15Z" />
      <path d="M13 20h7" />
    </>
  ),
  spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 3v4m-2-2h4" />
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export function ShellMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="36" height="36" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 42 7 29C-2 21 5 6 14 10 14-1 34-1 34 10c9-4 16 11 7 19L24 42Z" fill="currentColor" />
      <path
        d="m24 36-12-17m12 17L19 12m5 24 5-24m-5 24 12-17M24 8v28"
        stroke="var(--shell-mark-line, white)"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
