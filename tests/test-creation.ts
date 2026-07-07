import assert from "node:assert/strict";
import test from "node:test";
import {
  ANON_WORK_LIMIT,
  CREATION_DEPTHS,
  DEFAULT_CREATION_GENRES,
  canPublishWork,
  computeWeightedScore,
  contentFingerprint,
  parseGenreDimensions,
  parseInterview
} from "../src/lib/creation";

test("parseGenreDimensions keeps valid entries and drops malformed ones", () => {
  const parsed = parseGenreDimensions(
    JSON.stringify([
      { key: "rigor", label: "严谨性", weight: 0.5, hint: "论证" },
      { key: "", label: "无键", weight: 0.3, hint: "" },
      { key: "bad-weight", label: "坏权重", weight: 0, hint: "" },
      "not-an-object"
    ])
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].key, "rigor");

  assert.deepEqual(parseGenreDimensions("not json"), []);
  assert.deepEqual(parseGenreDimensions("{}"), []);
});

test("parseInterview only accepts question/answer string pairs", () => {
  const parsed = parseInterview(
    JSON.stringify([
      { question: "问", answer: "答" },
      { question: "缺答案" },
      42
    ])
  );
  assert.deepEqual(parsed, [{ question: "问", answer: "答" }]);
  assert.deepEqual(parseInterview("oops"), []);
});

test("computeWeightedScore applies S = Σw·score with normalization and clamping", () => {
  const dims = [
    { key: "r", label: "R", weight: 0.3, hint: "" },
    { key: "p", label: "P", weight: 0.25, hint: "" },
    { key: "t", label: "T", weight: 0.45, hint: "" }
  ];
  // 0.3*80 + 0.25*60 + 0.45*90 = 24 + 15 + 40.5 = 79.5
  assert.equal(computeWeightedScore(dims, { r: 80, p: 60, t: 90 }), 79.5);

  // 权重和不为 1 时按权重和归一化
  const lopsided = [
    { key: "a", label: "A", weight: 2, hint: "" },
    { key: "b", label: "B", weight: 2, hint: "" }
  ];
  assert.equal(computeWeightedScore(lopsided, { a: 70, b: 90 }), 80);

  // 超界分数被钳到 0-100
  assert.equal(computeWeightedScore(lopsided, { a: 150, b: -10 }), 50);

  // 没有任何有效分数时为 0
  assert.equal(computeWeightedScore(dims, {}), 0);
});

test("contentFingerprint ignores surrounding whitespace but tracks edits", () => {
  const base = contentFingerprint("你好，世界");
  assert.equal(contentFingerprint("  你好，世界  \n"), base);
  assert.notEqual(contentFingerprint("你好，世界。"), base);
});

test("canPublishWork enforces score, freshness, and threshold", () => {
  const content = "一篇达标的文章";
  const hash = contentFingerprint(content);

  assert.equal(canPublishWork({ score: null, threshold: 70, scoredHash: null, content }).ok, false);

  const stale = canPublishWork({ score: 90, threshold: 70, scoredHash: hash, content: "评分后改过的内容" });
  assert.equal(stale.ok, false);
  assert.match(!stale.ok ? stale.reason : "", /重新评分/);

  const low = canPublishWork({ score: 69.9, threshold: 70, scoredHash: hash, content });
  assert.equal(low.ok, false);
  assert.match(!low.ok ? low.reason : "", /门槛/);

  assert.equal(canPublishWork({ score: 70, threshold: 70, scoredHash: hash, content }).ok, true);
});

test("interview depths match the product spec (3 for short, 8-10 for full)", () => {
  assert.equal(CREATION_DEPTHS.SHORT.minQuestions, 3);
  assert.equal(CREATION_DEPTHS.SHORT.maxQuestions, 3);
  assert.equal(CREATION_DEPTHS.FULL.minQuestions, 8);
  assert.equal(CREATION_DEPTHS.FULL.maxQuestions, 10);
  assert.equal(ANON_WORK_LIMIT, 2);
});

test("default genres carry per-genre rubrics with weights summing to 1", () => {
  assert.ok(DEFAULT_CREATION_GENRES.length >= 4);
  const slugs = new Set(DEFAULT_CREATION_GENRES.map((genre) => genre.slug));
  assert.equal(slugs.size, DEFAULT_CREATION_GENRES.length);

  for (const genre of DEFAULT_CREATION_GENRES) {
    assert.ok(genre.dimensions.length >= 2, `${genre.slug} 至少两个维度`);
    const sum = genre.dimensions.reduce((total, dim) => total + dim.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${genre.slug} 权重和应为 1，实际 ${sum}`);
    assert.ok(genre.threshold > 0 && genre.threshold <= 100);
  }

  // 时评类时效性权重最高；教程类实效性权重最高
  const commentary = DEFAULT_CREATION_GENRES.find((genre) => genre.slug === "commentary")!;
  const timely = commentary.dimensions.find((dim) => dim.key === "timely")!;
  assert.ok(commentary.dimensions.every((dim) => dim.key === "timely" || dim.weight < timely.weight));

  const tutorial = DEFAULT_CREATION_GENRES.find((genre) => genre.slug === "tutorial")!;
  const practical = tutorial.dimensions.find((dim) => dim.key === "practical")!;
  assert.ok(tutorial.dimensions.every((dim) => dim.key === "practical" || dim.weight < practical.weight));

  // 个人叙事用情感真实度/细节具体性取代严谨性
  const story = DEFAULT_CREATION_GENRES.find((genre) => genre.slug === "personal-story")!;
  assert.ok(!story.dimensions.some((dim) => dim.key === "rigor"));
  assert.ok(story.dimensions.some((dim) => dim.key === "authenticity"));
  assert.ok(story.dimensions.some((dim) => dim.key === "detail"));
});
