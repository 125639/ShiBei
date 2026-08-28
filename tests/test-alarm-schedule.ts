import assert from "node:assert/strict";
import test from "node:test";
import { buildAlarmCron, describeAlarmCron, parseAlarmSchedule } from "../src/lib/alarm-schedule";

test("parses daily alarm schedule without exposing cron details", () => {
  const schedule = parseAlarmSchedule("30 8 * * *");

  assert.equal(schedule.mode, "daily");
  assert.equal(schedule.time, "08:30");
  assert.equal(describeAlarmCron(schedule.cron), "每天 08:30");
});

test("builds weekly alarm schedule from selected weekdays and time", () => {
  const cron = buildAlarmCron({
    mode: "weekly",
    time: "21:15",
    weekdays: [3, 1, 5],
    dayOfMonth: 1,
    intervalHours: 6
  });

  assert.equal(cron, "15 21 * * 1,3,5");
  assert.equal(describeAlarmCron(cron), "周一、周三、周五 21:15");
});

test("keeps legacy cron valid but labels it as legacy", () => {
  const schedule = parseAlarmSchedule("*/20 8-18 * * 1-5");

  assert.equal(schedule.mode, "legacy");
  assert.equal(schedule.cron, "*/20 8-18 * * 1-5");
  assert.equal(describeAlarmCron(schedule.cron), "保留旧版定时规则");
});
