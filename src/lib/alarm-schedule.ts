export type AlarmScheduleMode = "daily" | "weekdays" | "weekly" | "monthly" | "interval" | "legacy";

export type ParsedAlarmSchedule = {
  mode: AlarmScheduleMode;
  cron: string;
  time: string;
  weekdays: number[];
  dayOfMonth: number;
  intervalHours: number;
};

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" }
] as const;

export const INTERVAL_HOUR_OPTIONS = [1, 2, 3, 4, 6, 8, 12] as const;

const DEFAULT_SCHEDULE: ParsedAlarmSchedule = {
  mode: "daily",
  cron: "0 9 * * *",
  time: "09:00",
  weekdays: [1],
  dayOfMonth: 1,
  intervalHours: 6
};

function toInt(value: string) {
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

function inRange(value: number | null, min: number, max: number) {
  return value !== null && Number.isInteger(value) && value >= min && value <= max;
}

function toTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTime(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour: 9, minute: 0 };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!inRange(hour, 0, 23) || !inRange(minute, 0, 59)) return { hour: 9, minute: 0 };
  return { hour, minute };
}

function uniqueSortedWeekdays(values: number[]) {
  const valid = values.filter((value) => inRange(value, 0, 6));
  return [...new Set(valid)].sort((a, b) => a - b);
}

function parseDow(value: string) {
  if (value === "1-5") return [1, 2, 3, 4, 5];
  const parts = value.split(",");
  if (parts.length === 0) return null;
  const days = parts.map(toInt);
  if (days.some((day) => !inRange(day, 0, 6))) return null;
  return uniqueSortedWeekdays(days as number[]);
}

export function isValidCronExpression(value: string) {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((part) => /^[\d*/,-]+$/.test(part));
}

export function parseAlarmSchedule(value?: string | null): ParsedAlarmSchedule {
  const cron = (value || DEFAULT_SCHEDULE.cron).trim();
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return { ...DEFAULT_SCHEDULE, cron: DEFAULT_SCHEDULE.cron };

  const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;
  const minute = toInt(minutePart);
  const hour = toInt(hourPart);
  const time = inRange(hour, 0, 23) && inRange(minute, 0, 59)
    ? toTime(hour as number, minute as number)
    : DEFAULT_SCHEDULE.time;

  if (inRange(minute, 0, 59) && inRange(hour, 0, 23) && dayPart === "*" && monthPart === "*" && weekdayPart === "*") {
    return { ...DEFAULT_SCHEDULE, mode: "daily", cron, time };
  }

  if (inRange(minute, 0, 59) && inRange(hour, 0, 23) && dayPart === "*" && monthPart === "*") {
    const weekdays = parseDow(weekdayPart);
    if (weekdays?.length) {
      const mode = weekdays.length === 5 && weekdays.every((day, index) => day === index + 1) ? "weekdays" : "weekly";
      return { ...DEFAULT_SCHEDULE, mode, cron, time, weekdays };
    }
  }

  const dayOfMonth = toInt(dayPart);
  if (inRange(minute, 0, 59) && inRange(hour, 0, 23) && inRange(dayOfMonth, 1, 31) && monthPart === "*" && weekdayPart === "*") {
    return { ...DEFAULT_SCHEDULE, mode: "monthly", cron, time, dayOfMonth: dayOfMonth as number };
  }

  const intervalMatch = hourPart.match(/^\*\/(\d+)$/);
  const intervalHours = intervalMatch ? Number(intervalMatch[1]) : null;
  if (minutePart === "0" && inRange(intervalHours, 1, 23) && dayPart === "*" && monthPart === "*" && weekdayPart === "*") {
    return { ...DEFAULT_SCHEDULE, mode: "interval", cron, intervalHours: intervalHours as number };
  }

  if (isValidCronExpression(cron)) {
    return { ...DEFAULT_SCHEDULE, mode: "legacy", cron };
  }

  return { ...DEFAULT_SCHEDULE, cron: DEFAULT_SCHEDULE.cron };
}

export function buildAlarmCron(input: {
  mode: AlarmScheduleMode;
  time: string;
  weekdays: number[];
  dayOfMonth: number;
  intervalHours: number;
  legacyCron?: string;
}) {
  if (input.mode === "legacy") return input.legacyCron || DEFAULT_SCHEDULE.cron;

  const { hour, minute } = parseTime(input.time);
  if (input.mode === "interval") {
    const interval = inRange(input.intervalHours, 1, 23) ? input.intervalHours : DEFAULT_SCHEDULE.intervalHours;
    return `0 */${interval} * * *`;
  }

  if (input.mode === "monthly") {
    const day = inRange(input.dayOfMonth, 1, 31) ? input.dayOfMonth : DEFAULT_SCHEDULE.dayOfMonth;
    return `${minute} ${hour} ${day} * *`;
  }

  if (input.mode === "weekdays") {
    return `${minute} ${hour} * * 1-5`;
  }

  if (input.mode === "weekly") {
    const weekdays = uniqueSortedWeekdays(input.weekdays);
    return `${minute} ${hour} * * ${(weekdays.length ? weekdays : DEFAULT_SCHEDULE.weekdays).join(",")}`;
  }

  return `${minute} ${hour} * * *`;
}

export function describeAlarmCron(value?: string | null) {
  const schedule = parseAlarmSchedule(value);
  if (schedule.mode === "legacy") return "保留旧版定时规则";
  if (schedule.mode === "interval") return `每 ${schedule.intervalHours} 小时运行一次`;
  if (schedule.mode === "monthly") return `每月 ${schedule.dayOfMonth} 号 ${schedule.time}`;
  if (schedule.mode === "weekdays") return `工作日 ${schedule.time}`;
  if (schedule.mode === "weekly") {
    const labels = schedule.weekdays
      .map((day) => WEEKDAY_OPTIONS.find((option) => option.value === day)?.label || `周${day}`)
      .join("、");
    return `${labels} ${schedule.time}`;
  }
  return `每天 ${schedule.time}`;
}
