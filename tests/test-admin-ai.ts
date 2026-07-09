import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAdminAiPlan } from "../src/lib/admin-ai";

test("admin AI plan normalization clamps and limits model output", () => {
  const plan = normalizeAdminAiPlan({
    summary: "  生成多组选题  ",
    warnings: ["需要确认时间范围", "", "避免重复角度", "w3", "w4", "w5", "w6"],
    tasks: Array.from({ length: 8 }, (_, index) => ({
      keyword: `AI sustainable development topic ${index + 1}`.repeat(8),
      reason: `reason ${index + 1}`,
      scope: index === 0 ? "mars" : "international",
      depth: index === 1 ? "short" : "deep",
      articleCount: index === 2 ? 99 : 2
    }))
  }, {
    defaultScope: "all",
    defaultDepth: "long",
    defaultArticleCount: 1
  });

  assert.equal(plan.summary, "生成多组选题");
  assert.equal(plan.tasks.length, 6);
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
