"use client";

import { useEffect, useState } from "react";
import { clampProgress } from "@/lib/task-progress";

type TaskProgressProps = {
  label: string;
  stage?: string;
  value?: number | null;
  max?: number;
  active?: boolean;
  compact?: boolean;
  showElapsed?: boolean;
};

/**
 * 同时覆盖两种真实语义：有可靠计数时展示确定进度；只有一个长 HTTP 请求时
 * 展示不确定进度和等待时间。value=null/undefined 时不会伪造百分比。
 */
export function TaskProgress({
  label,
  stage,
  value,
  max = 100,
  active = false,
  compact = false,
  showElapsed = active
}: TaskProgressProps) {
  const clockKey = `${active ? "active" : "inactive"}\u0000${label}`;
  const [clock, setClock] = useState({ key: "", elapsed: 0 });

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const tick = () => {
      setClock({
        key: clockKey,
        elapsed: Math.max(0, Math.floor((Date.now() - started) / 1_000))
      });
    };
    // 立即清零一次：同一组件复用（如“重新尝试”）时不闪现上一轮的等待秒数。
    const immediate = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1_000);
    return () => {
      window.clearTimeout(immediate);
      window.clearInterval(timer);
    };
  }, [active, clockKey]);

  const determinate = typeof value === "number" && Number.isFinite(value) && max > 0;
  const safeValue = determinate ? clampProgress(value, max) : 0;
  const percent = determinate ? (safeValue / max) * 100 : 0;
  const elapsed = clock.key === clockKey ? clock.elapsed : 0;
  const elapsedLabel = formatElapsed(elapsed);
  const valueText = [stage || label, showElapsed ? `已等待 ${elapsedLabel}` : ""].filter(Boolean).join("，");

  return (
    <span className={`task-progress${compact ? " task-progress-compact" : ""}${active ? " is-active" : ""}`}>
      <span className="task-progress-head">
        <strong>{label}</strong>
        <span className="muted">
          {stage || null}
          {showElapsed ? <>{stage ? " · " : ""}已等待 {elapsedLabel}</> : null}
          {determinate ? <>{stage || showElapsed ? " · " : ""}{Math.round(percent)}%</> : null}
        </span>
      </span>
      <span
        className={`task-progress-track${determinate ? "" : " is-indeterminate"}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? max : undefined}
        aria-valuenow={determinate ? safeValue : undefined}
        aria-valuetext={valueText || undefined}
      >
        <span className="task-progress-fill" style={determinate ? { width: `${percent}%` } : undefined} />
      </span>
    </span>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}
