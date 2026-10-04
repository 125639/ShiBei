import Link from "next/link";
import type { ReactNode } from "react";

export type MetricTone = "normal" | "accent" | "warn" | "danger";

type MetricCardProps = {
  value: ReactNode;
  label: ReactNode;
  icon?: ReactNode;
  tone?: MetricTone;
  action?: { href: string; label: ReactNode };
};

export function MetricCard({ value, label, icon, tone = "normal", action }: MetricCardProps) {
  const toneClass = tone === "normal" ? "" : `metric-${tone}`;
  return (
    <div className={`metric-card${toneClass ? ` ${toneClass}` : ""}`}>
      {icon ? <span className="metric-icon" aria-hidden="true">{icon}</span> : null}
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      {action ? (
        <Link className="text-link metric-card-action" href={action.href} prefetch={action.href.startsWith("/admin") ? false : undefined}>
          {action.label} →
        </Link>
      ) : null}
    </div>
  );
}
