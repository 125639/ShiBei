import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PLAN_TASKS,
  MAX_PLAN_TOTAL_ARTICLES,
  normalizeAdminAiPlan,
  planArticleTotal
} from "../src/lib/admin-ai";

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
