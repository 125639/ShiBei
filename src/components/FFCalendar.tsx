"use client";

import { useState } from "react";
import { I18nText } from "@/components/I18nText";

const WEEKDAYS: Array<{ zh: string; en: string }> = [
  { zh: "日", en: "S" },
  { zh: "一", en: "M" },
  { zh: "二", en: "T" },
  { zh: "三", en: "W" },
  { zh: "四", en: "T" },
  { zh: "五", en: "F" },
  { zh: "六", en: "S" }
];

/**
 * Firefly 侧栏日历（可翻月）。
 * 「今天」与「最近发布日」由服务端以纯数字传入：客户端 new Date()
 * 与服务器时区可能差一天，用数字比较可保证 SSR 与水合渲染一致。
 */
export function FFCalendar({
  todayYear,
  todayMonth,
  todayDay,
  publishedYear,
  publishedMonth,
  publishedDay
}: {
  todayYear: number;
  /** 0-based */
  todayMonth: number;
  todayDay: number;
  publishedYear: number | null;
  /** 0-based */
  publishedMonth: number | null;
  publishedDay: number | null;
}) {
  const [view, setView] = useState({ year: todayYear, month: todayMonth });

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const isCurrentMonth = view.year === todayYear && view.month === todayMonth;
  const publishedInView =
    publishedYear === view.year && publishedMonth === view.month ? publishedDay : null;

  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ];

  function shiftMonth(delta: number) {
    setView((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  return (
    <section className="ff-widget ff-calendar-widget">
      <div className="ff-calendar-bar">
        <button
          type="button"
          className="ff-calendar-nav"
          aria-label="上一月 / Previous month"
          onClick={() => shiftMonth(-1)}
        >
          ‹
        </button>
        <h2 className="ff-calendar-title">
          <I18nText
            zh={`${view.year} 年 ${view.month + 1} 月`}
            en={`${view.year}-${String(view.month + 1).padStart(2, "0")}`}
          />
        </h2>
        <button
          type="button"
          className="ff-calendar-nav"
          aria-label="下一月 / Next month"
          onClick={() => shiftMonth(1)}
        >
          ›
        </button>
      </div>
      <div className="ff-calendar" role="presentation">
        {WEEKDAYS.map((day, index) => (
          <span className="ff-calendar-head" key={`h${index}`}>
            <I18nText zh={day.zh} en={day.en} />
          </span>
        ))}
        {cells.map((day, index) => (
          <span
            key={index}
            className={
              isCurrentMonth && day === todayDay
                ? "ff-calendar-day is-today"
                : day !== null && day === publishedInView
                  ? "ff-calendar-day is-published"
                  : day
                    ? "ff-calendar-day"
                    : "ff-calendar-blank"
            }
          >
            {day ?? ""}
          </span>
        ))}
      </div>
      {!isCurrentMonth ? (
        <button
          type="button"
          className="ff-calendar-today"
          onClick={() => setView({ year: todayYear, month: todayMonth })}
        >
          <I18nText zh="回到本月" en="Back to today" />
        </button>
      ) : null}
    </section>
  );
}
