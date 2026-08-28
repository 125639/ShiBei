import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PLAN_RECURRING,
  MAX_PLAN_TASKS,
  MAX_PLAN_TOTAL_ARTICLES,
  compileKindFromRecurringMode,
  cronFromCadence,
  normalizeAdminAiPlan,
  planArticleTotal
} from "../src/lib/admin-ai";
import { enqueueBatchContinuing } from "../src/lib/batch-queue";

test("admin AI plan normalization clamps and limits model output", () => {
  const plan = normalizeAdminAiPlan({
    summary: "  生成多组选题  ",
    warnings: ["需要确认时间范围", "", "避免重复角度", "w3", "w4", "w5", "w6"],
    tasks: Array.from({ length: MAX_PLAN_TASKS + 4 }, (_, index) => ({
      keyword: `AI sustainable development topic ${index + 1}`.repeat(8),
      reason: `reason ${index + 1}`,
      scope: index === 0 ? "mars" : "international",
      depth: index === 1 ? "short" : "deep",
      articleCount: index === 2 ? 99 : 1
    }))
  }, {
    defaultScope: "all",
    defaultDepth: "long",
    defaultArticleCount: 1
  });

  assert.equal(plan.summary, "生成多组选题");
  assert.equal(plan.tasks.length, MAX_PLAN_TASKS);
  assert.equal(plan.warnings.length, 6);
  assert.equal(plan.tasks[0].scope, "all");
  assert.equal(plan.tasks[1].depth, "long");
  assert.equal(plan.tasks[2].articleCount, 5);
  assert.equal(plan.tasks[0].keyword.length, 180);
});

test("admin AI plan normalization drops malformed tasks and uses safe defaults", () => {
  const plan = normalizeAdminAiPlan({
    summary: "",
    warnings: [1, "保守执行"],
    tasks: [
      null,
      { keyword: " " },
      { keyword: "AI 智能体 企业落地", reason: 123, articleCount: "3" },
      { keyword: "绿色技术 供应链减排", scope: "domestic", depth: "standard", articleCount: -4 }
    ]
  }, {
    defaultScope: "international",
    defaultDepth: "deep",
    defaultArticleCount: 2
  });

  assert.equal(plan.summary, "已生成内容生产计划。");
  assert.deepEqual(plan.warnings, ["保守执行"]);
  assert.deepEqual(plan.tasks.map((task) => task.keyword), ["AI 智能体 企业落地", "绿色技术 供应链减排"]);
  assert.equal(plan.tasks[0].scope, "international");
  assert.equal(plan.tasks[0].depth, "deep");
  assert.equal(plan.tasks[0].articleCount, 2);
  assert.equal(plan.tasks[0].topicId, null);
  assert.equal(plan.tasks[1].scope, "domestic");
  assert.equal(plan.tasks[1].depth, "standard");
  assert.equal(plan.tasks[1].articleCount, 1);
});

test("admin AI plan normalization removes duplicate keyword tasks before limiting", () => {
  const plan = normalizeAdminAiPlan({
    tasks: [
      { keyword: "AI 智能体 企业落地", reason: "first" },
      { keyword: " AI 智能体   企业落地 ", reason: "duplicate" },
      { keyword: "可持续发展 绿色技术", reason: "second" }
    ]
  }, {
    defaultScope: "all",
    defaultDepth: "long",
    defaultArticleCount: 1
  });

  assert.deepEqual(plan.tasks.map((task) => task.keyword), ["AI 智能体 企业落地", "可持续发展 绿色技术"]);
});

test("admin AI plan keeps valid topicId and nulls unknown or missing ones", () => {
  const plan = normalizeAdminAiPlan({
    tasks: [
      { keyword: "日本央行 加息 影响", topicId: "topic-finance" },
      { keyword: "欧洲央行 2026 降息", topicId: "made-up-id" },
      { keyword: "欧元区 通胀 走势" }
    ]
  }, {
    defaultScope: "all",
    defaultDepth: "long",
    defaultArticleCount: 1,
    validTopicIds: new Set(["topic-finance", "topic-ai"])
  });

  assert.deepEqual(plan.tasks.map((task) => task.topicId), ["topic-finance", null, null]);
});

test("admin AI plan enforces the total article budget and warns when trimming", () => {
  const plan = normalizeAdminAiPlan({
    tasks: Array.from({ length: 6 }, (_, index) => ({
      keyword: `topic ${index + 1} 深度选题`,
      articleCount: 4
    }))
  }, {
    defaultScope: "all",
    defaultDepth: "long",
    defaultArticleCount: 1
  });

  assert.equal(planArticleTotal(plan.tasks), MAX_PLAN_TOTAL_ARTICLES);
  assert.equal(plan.tasks.length, 5);
  assert.ok(plan.warnings.some((warning) => warning.includes("总量上限")));
});

test("admin AI plan under budget adds no trim warning", () => {
  const plan = normalizeAdminAiPlan({
    tasks: [
      { keyword: "日本 财经 2026 展望", articleCount: 1 },
      { keyword: "欧洲 能源市场 改革", articleCount: 3 }
    ]
  }, {
    defaultScope: "all",
    defaultDepth: "long",
    defaultArticleCount: 1
  });

  assert.equal(planArticleTotal(plan.tasks), 4);
  assert.deepEqual(plan.warnings, []);
});

test("admin AI plan keeps valid styleId and nulls unknown ones", () => {
  const plan = normalizeAdminAiPlan({
    tasks: [
      { keyword: "欧洲央行 2026 政策", styleId: "style-serious" },
      { keyword: "AI 智能体 落地", styleId: "made-up" }
    ]
  }, {
    defaultScope: "all",
    defaultDepth: "long",
    defaultArticleCount: 1,
    validStyleIds: new Set(["style-serious"])
  });

  assert.deepEqual(plan.tasks.map((task) => task.styleId), ["style-serious", null]);
});

test("admin AI recurring normalization clamps fields and drops unknown cadence", () => {
  const plan = normalizeAdminAiPlan({
    recurring: [
      { name: "AI 周报", keywords: "AI 动态, 大模型", cadence: "weekly", weekday: 1, hour: 9, mode: "weekly_roundup", articleCount: 1 },
      { name: "AI 周报", keywords: "重复名字", cadence: "weekly", weekday: 2, hour: 10 },
      { name: "月度盘点", cadence: "monthly" },
      { name: "早报", cadence: "daily", weekday: 99, hour: 40, mode: "bogus-mode", articleCount: 99 },
      { name: "x", cadence: "daily" }
    ]
  }, {
    defaultScope: "all",
    defaultDepth: "long",
    defaultArticleCount: 1
  });

  assert.equal(plan.recurring.length, 2);
  assert.equal(plan.recurring[0].name, "AI 周报");
  assert.equal(plan.recurring[0].mode, "weekly_roundup");
  assert.equal(plan.recurring[1].name, "早报");
  assert.equal(plan.recurring[1].hour, 23);
  assert.equal(plan.recurring[1].weekday, 7);
  assert.equal(plan.recurring[1].mode, "single");
  assert.equal(plan.recurring[1].articleCount, 5);
  assert.equal(plan.recurring[1].keywords, "早报");
  assert.ok(plan.warnings.some((warning) => warning.includes("节奏无法识别")));
});

test("admin AI recurring respects the max recurring cap", () => {
  const plan = normalizeAdminAiPlan({
    recurring: Array.from({ length: MAX_PLAN_RECURRING + 2 }, (_, index) => ({
      name: `周期主题 ${index + 1}`,
      cadence: "daily"
    }))
  }, {
    defaultScope: "all",
    defaultDepth: "long",
    defaultArticleCount: 1
  });

  assert.equal(plan.recurring.length, MAX_PLAN_RECURRING);
});

test("cron whitelist builds standard expressions and never trusts raw cron", () => {
  assert.equal(cronFromCadence({ cadence: "daily", weekday: 1, hour: 8 }), "0 8 * * *");
  assert.equal(cronFromCadence({ cadence: "weekdays", weekday: 1, hour: 7 }), "0 7 * * 1-5");
  assert.equal(cronFromCadence({ cadence: "weekly", weekday: 1, hour: 9 }), "0 9 * * 1");
  assert.equal(cronFromCadence({ cadence: "weekly", weekday: 7, hour: 9 }), "0 9 * * 0");
  // 越界值钳到边界(99→23 点、周日),非数字才回落默认
  assert.equal(cronFromCadence({ cadence: "weekly", weekday: 99, hour: 99 }), "0 23 * * 0");
  assert.equal(cronFromCadence({ cadence: "weekly", weekday: Number.NaN, hour: Number.NaN }), "0 9 * * 1");
});

test("recurring mode maps to compile kind", () => {
  assert.equal(compileKindFromRecurringMode("single"), "SINGLE_ARTICLE");
  assert.equal(compileKindFromRecurringMode("daily_digest"), "DAILY_DIGEST");
  assert.equal(compileKindFromRecurringMode("weekly_roundup"), "WEEKLY_ROUNDUP");
});

test("admin AI batch dispatch keeps all 10 tasks when a middle enqueue fails", async () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    jobId: `job-${index + 1}`,
    task: { keyword: `选题 ${index + 1}` }
  }));
  const enqueueAttempts: string[] = [];
  const failedRows = new Map<string, string>();

  const outcomes = await enqueueBatchContinuing(items, {
    enqueue: async (jobId) => {
      enqueueAttempts.push(jobId);
      if (jobId === "job-6") throw new Error("Redis temporary unavailable");
    },
    markFailed: async (jobId, error) => {
      failedRows.set(jobId, error);
    }
  });

  assert.equal(outcomes.length, 10);
  assert.deepEqual(enqueueAttempts, items.map((item) => item.jobId));
  assert.equal(outcomes[5].status, "FAILED");
  assert.match(outcomes[5].error || "", /Redis temporary unavailable/);
  assert.equal(failedRows.size, 1);
  assert.match(failedRows.get("job-6") || "", /任务入队失败/);
  assert.deepEqual(
    outcomes.filter((item) => item.status === "QUEUED").map((item) => item.jobId),
    ["job-1", "job-2", "job-3", "job-4", "job-5", "job-7", "job-8", "job-9", "job-10"]
  );
});
