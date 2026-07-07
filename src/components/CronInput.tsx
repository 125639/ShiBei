"use client";

import { useId, useMemo, useState } from "react";
import {
  buildAlarmCron,
  describeAlarmCron,
  INTERVAL_HOUR_OPTIONS,
  parseAlarmSchedule,
  WEEKDAY_OPTIONS,
  type AlarmScheduleMode
} from "@/lib/alarm-schedule";

type Props = {
  name?: string;
  defaultValue?: string;
  id?: string;
  required?: boolean;
};

const MODE_OPTIONS: Array<{ value: AlarmScheduleMode; label: string }> = [
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "interval", label: "间隔" }
];

export function CronInput({ name = "cron", defaultValue = "0 9 * * *", id, required }: Props) {
  const reactId = useId();
  const inputId = id || reactId;
  const parsed = useMemo(() => parseAlarmSchedule(defaultValue), [defaultValue]);
  const [mode, setMode] = useState<AlarmScheduleMode>(parsed.mode);
  const [time, setTime] = useState(parsed.time);
  const [weekdays, setWeekdays] = useState(parsed.weekdays);
  const [dayOfMonth, setDayOfMonth] = useState(parsed.dayOfMonth);
  const [intervalHours, setIntervalHours] = useState(parsed.intervalHours);
  const legacyCron = parsed.mode === "legacy" ? parsed.cron : undefined;

  const cronValue = buildAlarmCron({
    mode,
    time,
    weekdays,
    dayOfMonth,
    intervalHours,
    legacyCron
  });
  const description = describeAlarmCron(cronValue);
  const summaryBadge = mode === "legacy" ? "--" : mode === "interval" ? `${intervalHours}H` : time.slice(0, 2);
  const selectableModes = parsed.mode === "legacy"
    ? [{ value: "legacy" as const, label: "保留旧定时" }, ...MODE_OPTIONS]
    : MODE_OPTIONS;

  function toggleWeekday(day: number) {
    setWeekdays((current) => {
      if (current.includes(day)) {
        const next = current.filter((value) => value !== day);
        return next.length ? next : current;
      }
      return [...current, day].sort((a, b) => a - b);
    });
  }

  return (
    <div className="alarm-schedule">
      <input type="hidden" name={name} value={cronValue} required={required} />
      <div className="alarm-summary" id={`${inputId}-desc`}>
        <span className="alarm-summary-icon" aria-hidden="true">{summaryBadge}</span>
        <span>
          <strong>{description}</strong>
          <small>像手机闹钟一样选择频率和时间</small>
        </span>
      </div>

      <div className="field-row alarm-controls">
        <div className="field">
          <label htmlFor={`${inputId}-mode`}>频率</label>
          <select
            id={`${inputId}-mode`}
            value={mode}
            onChange={(event) => setMode(event.target.value as AlarmScheduleMode)}
            aria-describedby={`${inputId}-desc`}
          >
            {selectableModes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {mode !== "interval" && mode !== "legacy" ? (
          <div className="field">
            <label htmlFor={`${inputId}-time`}>时间</label>
            <input
              id={`${inputId}-time`}
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value || "09:00")}
            />
          </div>
        ) : null}
      </div>

      {mode === "weekly" ? (
        <div className="field">
          <span className="field-label">重复</span>
          <div className="alarm-weekday-grid" role="group" aria-label="选择每周重复日期">
            {WEEKDAY_OPTIONS.map((day) => (
              <label key={day.value} className="alarm-day-pill" data-selected={weekdays.includes(day.value)}>
                <input
                  type="checkbox"
                  checked={weekdays.includes(day.value)}
                  onChange={() => toggleWeekday(day.value)}
                />
                {day.label.replace("周", "")}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "monthly" ? (
        <div className="field">
          <label htmlFor={`${inputId}-day`}>每月日期</label>
          <input
            id={`${inputId}-day`}
            type="number"
            min="1"
            max="31"
            value={dayOfMonth}
            onChange={(event) => setDayOfMonth(Number(event.target.value) || 1)}
          />
        </div>
      ) : null}

      {mode === "interval" ? (
        <div className="field">
          <label htmlFor={`${inputId}-interval`}>运行间隔</label>
          <select
            id={`${inputId}-interval`}
            value={intervalHours}
            onChange={(event) => setIntervalHours(Number(event.target.value) || 6)}
          >
            {INTERVAL_HOUR_OPTIONS.map((hours) => (
              <option key={hours} value={hours}>
                每 {hours} 小时
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="alarm-quick-actions" role="group" aria-label="常用定时">
        <button type="button" className="cron-preset-pill" onClick={() => { setMode("daily"); setTime("09:00"); }}>
          每天 09:00
        </button>
        <button type="button" className="cron-preset-pill" onClick={() => { setMode("weekdays"); setTime("09:00"); }}>
          工作日 09:00
        </button>
        <button type="button" className="cron-preset-pill" onClick={() => { setMode("interval"); setIntervalHours(6); }}>
          每 6 小时
        </button>
      </div>
    </div>
  );
}
