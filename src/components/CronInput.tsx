"use client";

import { useId, useState } from "react";

type Props = {
  name?: string;
  defaultValue?: string;
  id?: string;
  required?: boolean;
};

const PRESETS: Array<{ label: string; value: string }> = [
  { label: "每天 09:00", value: "0 9 * * *" },
  { label: "每 6 小时", value: "0 */6 * * *" },
  { label: "每周一 09:00", value: "0 9 * * 1" },
  { label: "每月 1 号 09:00", value: "0 9 1 * *" }
];

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function describeField(value: string, kind: "minute" | "hour" | "dom" | "month" | "dow"): string | null {
  if (value === "*") return null;
  const stepMatch = value.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (kind === "minute") return `每 ${step} 分钟`;
    if (kind === "hour") return `每 ${step} 小时`;
    if (kind === "dom") return `每 ${step} 天`;
    if (kind === "month") return `每 ${step} 个月`;
    if (kind === "dow") return `每 ${step} 个工作日`;
  }
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    if (kind === "minute") return `${n} 分`;
    if (kind === "hour") return `${n} 时`;
    if (kind === "dom") return `${n} 号`;
    if (kind === "month") return `${n} 月`;
    if (kind === "dow") return WEEKDAY_NAMES[n] || `周 ${n}`;
  }
  return value;
}

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "需要 5 个字段:分 时 日 月 周";
  const [minute, hour, dom, month, dow] = parts;
  // 优先识别常见的"X 时 Y 分 + 频率"模式。
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*" && dow === "*") {
    return `每天 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*" && /^\d+$/.test(dow)) {
    return `每${WEEKDAY_NAMES[Number(dow)] || `周${dow}`} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && month === "*" && dow === "*") {
    return `每月 ${dom} 号 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  if (minute === "0" && hour.startsWith("*/")) {
    return `每 ${hour.slice(2)} 小时整点`;
  }
  const segments = [
    describeField(minute, "minute"),
    describeField(hour, "hour"),
    describeField(dom, "dom"),
    describeField(month, "month"),
    describeField(dow, "dow")
  ].filter(Boolean);
  return segments.length ? segments.join(" / ") : "每分钟运行";
}

function isValidCronShape(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => /^[\d*/,-]+$/.test(p));
}

export function CronInput({ name = "cron", defaultValue = "0 9 * * *", id, required }: Props) {
  const reactId = useId();
  const inputId = id || reactId;
  const [value, setValue] = useState(defaultValue);
  const valid = isValidCronShape(value);
  const description = valid ? describeCron(value) : "请按「分 时 日 月 周」5 字段填写";

  return (
    <div className="cron-input">
      <input
        id={inputId}
        name={name}
        required={required}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        aria-describedby={`${inputId}-desc`}
        aria-invalid={!valid}
      />
      <div id={`${inputId}-desc`} className="cron-input-desc">
        {description}
      </div>
      <div className="cron-input-presets" role="group" aria-label="常用预设">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className="cron-preset-pill"
            onClick={() => setValue(preset.value)}
            aria-pressed={value === preset.value}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
