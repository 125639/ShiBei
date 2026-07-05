import assert from "node:assert/strict";
import test from "node:test";
import { classifyTopic, type ClassifiableTopic } from "../src/lib/topic-classify";

const TOPICS: ClassifiableTopic[] = [
  { id: "t-politics", slug: "politics", name: "时政", keywords: "国务院 政策\n外交部" },
  { id: "t-economy", slug: "economy", name: "经济", keywords: "宏观经济\nA股\n央行" },
  { id: "t-tech", slug: "technology", name: "科技", keywords: "人工智能\n芯片" },
  { id: "t-sports", slug: "sports", name: "体育", keywords: "足球\n篮球" },
  { id: "t-ai", slug: "ai", name: "人工智能", keywords: "人工智能" }
];

test("经济类文章按词库归入经济", () => {
  const result = classifyTopic(
    {
      title: "央行宣布下调利率，A股应声上涨",
      summary: "货币政策转向宽松，市场对宏观经济预期改善。",
      content: "多家银行调整了存款利率……"
    },
    TOPICS
  );
  assert.equal(result?.slug, "economy");
});

test("体育文章不会被经济词误吸", () => {
  const result = classifyTopic(
    {
      title: "世界杯预选赛：国家队 2:0 取胜",
      summary: "足球比赛中球员表现出色，球队积分榜上升。",
      content: "比赛第 35 分钟打入首球……"
    },
    TOPICS
  );
  assert.equal(result?.slug, "sports");
});

test("AI 专题优先于泛科技（专有词命中更多）", () => {
  const result = classifyTopic(
    {
      title: "OpenAI 发布新一代大模型",
      summary: "生成式 AI 推理能力大幅提升，训练算力翻倍。",
      content: "该 LLM 在多个基准上……"
    },
    TOPICS
  );
  assert.equal(result?.slug, "ai");
});

test("无关内容返回 null，不乱挂分类", () => {
  const result = classifyTopic(
    { title: "今天天气不错", summary: "适合散步。", content: "……" },
    TOPICS
  );
  assert.equal(result, null);
});

test("词库未命中时用来源模块映射兜底", () => {
  const result = classifyTopic(
    { title: "某公司发布季度更新", summary: "内容平平。", content: "", moduleSlugs: ["finance"] },
    TOPICS
  );
  assert.equal(result?.slug, "economy");
});

test("没有任何信号且无模块提示时返回 null", () => {
  const result = classifyTopic(
    { title: "随笔一则", summary: "", content: "", moduleSlugs: ["general-news"] },
    TOPICS
  );
  assert.equal(result, null);
});

test("英文单词内的 ai 子串不会误归人工智能", () => {
  const result = classifyTopic(
    {
      title: "Maintainers said email is available again",
      summary: "The maintainer said the mailing list is back.",
      content: "against all odds, maintainability improved"
    },
    TOPICS
  );
  assert.notEqual(result?.slug, "ai");
});

test("独立出现的 AI 一词正常计分", () => {
  const result = classifyTopic(
    { title: "AI 编程助手评测：生成式大模型对比", summary: "覆盖训练与推理模型。", content: "" },
    TOPICS
  );
  assert.equal(result?.slug, "ai");
});
