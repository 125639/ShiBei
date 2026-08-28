"use client";

import { useEffect, useMemo, useState } from "react";
import { I18nText } from "./I18nText";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function formatRelative(diffMs: number): { zh: string; en: string } {
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return past ? { zh: "刚刚", en: "just now" } : { zh: "即将", en: "soon" };
  if (abs < 3600_000) {
    const mins = Math.round(abs / 60_000);
    return past ? { zh: `${mins} 分钟前`, en: `${mins} min ago` } : { zh: `${mins} 分钟后`, en: `in ${mins} min` };
  }
  if (abs < 24 * 3600_000) {
    const hours = Math.round(abs / 3600_000);
    return past ? { zh: `${hours} 小时前`, en: `${hours} h ago` } : { zh: `${hours} 小时后`, en: `in ${hours} h` };
  }
  const days = Math.round(abs / (24 * 3600_000));
  return past ? { zh: `${days} 天前`, en: `${days} d ago` } : { zh: `${days} 天后`, en: `in ${days} d` };
}

// 列表页可能同时渲染几十个 RelativeTime；共享一个 30s 定时器，
// 而不是每个实例各起一个 setInterval。最后一个订阅者退出时停表。
const subscribers = new Set<() => void>();
let sharedTimer: ReturnType<typeof setInterval> | null = null;

function subscribeTick(fn: () => void) {
  subscribers.add(fn);
  if (!sharedTimer) {
    sharedTimer = setInterval(() => {
      subscribers.forEach((cb) => cb());
    }, 30_000);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && sharedTimer) {
      clearInterval(sharedTimer);
      sharedTimer = null;
    }
  };
}

export function RelativeTime({ value }: { value: Date | string }) {
  const date = useMemo(() => (typeof value === "string" ? new Date(value) : value), [value]);
  const iso = date.toISOString();
  // 服务端与首次水合渲染必须逐字节一致。toLocaleString 的结果取决于
  // 运行环境的时区与 ICU（Node/UTC vs 各家浏览器），直接用会触发
  // React #418 文本水合错误；初始只渲染确定性的 UTC 日期，挂载后
  // 在 effect 里换成相对时间 / 本地格式。
  const fallback = iso.slice(0, 10);

  const [label, setLabel] = useState<{ zh: string; en: string; title: string }>({
    zh: fallback,
    en: fallback,
    title: fallback
  });

  useEffect(() => {
    const absolute = date.toLocaleString("zh-CN");
    const update = () => {
      const diff = Date.now() - date.getTime();
      const relative = Math.abs(diff) < ONE_WEEK_MS ? formatRelative(diff) : { zh: absolute, en: absolute };
      setLabel({ ...relative, title: absolute });
    };
    update();
    return subscribeTick(update);
  }, [date]);

  return <time dateTime={iso} title={label.title}><I18nText zh={label.zh} en={label.en} /></time>;
}
