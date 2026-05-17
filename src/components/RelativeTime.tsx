"use client";

import { useEffect, useMemo, useState } from "react";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function formatRelative(diffMs: number): string {
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return past ? "刚刚" : "即将";
  if (abs < 3600_000) {
    const mins = Math.round(abs / 60_000);
    return past ? `${mins} 分钟前` : `${mins} 分钟后`;
  }
  if (abs < 24 * 3600_000) {
    const hours = Math.round(abs / 3600_000);
    return past ? `${hours} 小时前` : `${hours} 小时后`;
  }
  const days = Math.round(abs / (24 * 3600_000));
  return past ? `${days} 天前` : `${days} 天后`;
}

export function RelativeTime({ value }: { value: Date | string }) {
  const date = useMemo(() => (typeof value === "string" ? new Date(value) : value), [value]);
  const iso = date.toISOString();
  const absolute = date.toLocaleString("zh-CN");

  const [label, setLabel] = useState(absolute);

  useEffect(() => {
    const update = () => {
      const diff = Date.now() - date.getTime();
      setLabel(Math.abs(diff) < ONE_WEEK_MS ? formatRelative(diff) : absolute);
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [date, absolute]);

  return <time dateTime={iso} title={absolute}>{label}</time>;
}
