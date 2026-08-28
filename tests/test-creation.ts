import assert from "node:assert/strict";
import test from "node:test";
import {
  ANON_WORK_LIMIT,
  CREATION_DEPTHS,
  DEFAULT_CREATION_GENRES,
  canPublishWork,
  computeWeightedScore,
  deriveCommunityDescription,
  deriveScoredCommunityDescription,
  isCommunityScoreCurrent,
  isScoredSurfaceCurrent,
  legacyWorkScoreFingerprint,
  ownerExportScoreLabel,
  ownerScorePresentation,
  parseGenreDimensions,
  parseInterview,
  scoreInvalidationData,
  scoredCommunitySummary,
  scoreSurfaceChanged,
  verificationClarificationData,
  workRevisionWhere,
  workRubricFingerprint,
  workScoreFingerprint
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

test("workScoreFingerprint binds title, public summary, and Markdown-significant content", () => {
  const base = workScoreFingerprint({ title: "标题", summary: "摘要", content: "你好，世界" });
  assert.equal(
    workScoreFingerprint({ title: "  标题  ", summary: " 摘要 ", content: "你好，世界" }),
    base
  );
  assert.equal(
    workScoreFingerprint({ title: "标题", summary: "摘要", content: "第一行\r\n第二行" }),
    workScoreFingerprint({ title: "标题", summary: "摘要", content: "第一行\n第二行" })
  );
  assert.notEqual(workScoreFingerprint({ title: "另一个标题", summary: "摘要", content: "你好，世界" }), base);
  assert.notEqual(workScoreFingerprint({ title: "标题", summary: "误导摘要", content: "你好，世界" }), base);
  assert.notEqual(workScoreFingerprint({ title: "标题", summary: "摘要", content: "你好，世界。" }), base);
  assert.notEqual(workScoreFingerprint({ title: "标题", summary: "摘要", content: "    你好，世界" }), base);
  assert.notEqual(workScoreFingerprint({ title: "标题", summary: "摘要", content: "\n你好，世界" }), base);
});

test("community SEO description uses only scored summary/content and strips Markdown markup", () => {
  assert.equal(
    deriveCommunityDescription("  **已评分摘要** [资料](https://example.com) ", "正文"),
    "已评分摘要 资料"
  );
  assert.equal(
    deriveCommunityDescription("", "## 正文标题\n\n这是 **已评分正文**。<script>bad()</script>"),
    "正文标题 这是 已评分正文。"
  );
  assert.equal(deriveCommunityDescription("", "```js\nalert(1)\n```"), null);
});

test("legacy title+content scores cannot certify a public summary for SEO or publishing", () => {
  const work = { title: "标题", summary: "未经旧评分审查的摘要", content: "正文" };
  assert.equal(isScoredSurfaceCurrent({ ...work, scoredHash: workScoreFingerprint(work) }), true);
  assert.equal(isScoredSurfaceCurrent({ ...work, scoredHash: legacyWorkScoreFingerprint(work) }), false);
  assert.equal(scoredCommunitySummary({ ...work, scoredHash: legacyWorkScoreFingerprint(work) }), "");
  assert.equal(scoredCommunitySummary({ ...work, scoredHash: null }), "");
  assert.equal(scoredCommunitySummary({ ...work, scoredHash: "stale" }), "");
  assert.equal(scoredCommunitySummary({ ...work, scoredHash: workScoreFingerprint(work) }), work.summary);
  assert.equal(
    deriveScoredCommunityDescription({ ...work, scoredHash: legacyWorkScoreFingerprint(work) }),
    "正文"
  );
  assert.equal(
    deriveScoredCommunityDescription({ ...work, scoredHash: workScoreFingerprint(work) }),
    "未经旧评分审查的摘要"
  );
  assert.equal(deriveScoredCommunityDescription({ ...work, scoredHash: null }), null);
  assert.equal(deriveScoredCommunityDescription({ ...work, scoredHash: "stale" }), null);
});

test("community score is shown as current only when both V2 surface and rubric match", () => {
  const work = {
    title: "标题",
    summary: "摘要",
    content: "正文",
    depth: "SHORT" as const,
    genre: {
      name: "题材",
      dimensions: JSON.stringify([{ key: "r", label: "严谨", weight: 1, hint: "" }]),
      threshold: 70
    }
  };
  const scoredHash = workScoreFingerprint(work);
  const scoredRubricHash = workRubricFingerprint(work);
  assert.equal(isCommunityScoreCurrent({ ...work, scoredHash, scoredRubricHash }), true);
  assert.equal(isCommunityScoreCurrent({ ...work, scoredHash, scoredRubricHash: null }), false);
  assert.equal(
    isCommunityScoreCurrent({ ...work, scoredHash: legacyWorkScoreFingerprint(work), scoredRubricHash }),
    false
  );
  assert.equal(isCommunityScoreCurrent({ ...work, scoredHash: "stale", scoredRubricHash }), false);
});

test("owner score presentation and export never pair a stale score with the current threshold", () => {
  const work = {
    title: "标题",
    summary: "摘要",
    content: "正文",
    depth: "SHORT" as const,
    genre: {
      name: "题材",
      dimensions: JSON.stringify([{ key: "r", label: "严谨", weight: 1, hint: "" }]),
      threshold: 72
    },
    score: 88
  };
  const scoredHash = workScoreFingerprint(work);
  const scoredRubricHash = workRubricFingerprint(work);
  assert.deepEqual(ownerScorePresentation({ ...work, scoredHash, scoredRubricHash }), {
    current: true,
    score: 88,
    hasHistoricalScore: false
  });
  assert.equal(
    ownerExportScoreLabel({ ...work, scoredHash, scoredRubricHash }),
    "AI 评分：88/72（公开门槛）"
  );

  for (const stale of [
    { scoredHash: legacyWorkScoreFingerprint(work), scoredRubricHash },
    { scoredHash, scoredRubricHash: null },
    { scoredHash: "stale", scoredRubricHash }
  ]) {
    assert.deepEqual(ownerScorePresentation({ ...work, ...stale }), {
      current: false,
      score: null,
      hasHistoricalScore: true
    });
    const label = ownerExportScoreLabel({ ...work, ...stale });
    assert.match(label ?? "", /历史评分已失效/);
    assert.doesNotMatch(label ?? "", /72|公开门槛/);
  }

  assert.deepEqual(
    ownerScorePresentation({ ...work, score: null, scoredHash: null, scoredRubricHash: null }),
    { current: false, score: null, hasHistoricalScore: false }
  );
  assert.equal(
    ownerExportScoreLabel({ ...work, score: null, scoredHash: null, scoredRubricHash: null }),
    null
  );
});

test("canPublishWork enforces score, freshness, and threshold", () => {
  const title = "达标标题";
  const summary = "准确摘要";
  const content = "一篇达标的文章";
  const hash = workScoreFingerprint({ title, summary, content });
  const rubric = { scoredRubricHash: "rubric-v1", currentRubricHash: "rubric-v1" };

  assert.equal(canPublishWork({ score: null, threshold: 70, scoredHash: null, title, summary, content, ...rubric }).ok, false);

  const staleContent = canPublishWork({
    score: 90,
    threshold: 70,
    scoredHash: hash,
    ...rubric,
    title,
    summary,
    content: "评分后改过的内容"
  });
  assert.equal(staleContent.ok, false);
  assert.match(!staleContent.ok ? staleContent.reason : "", /重新评分/);

  const markdownIndentChanged = canPublishWork({
    score: 90,
    threshold: 70,
    scoredHash: hash,
    ...rubric,
    title,
    summary,
    content: `    ${content}`
  });
  assert.equal(markdownIndentChanged.ok, false);
  assert.match(!markdownIndentChanged.ok ? markdownIndentChanged.reason : "", /重新评分/);

  const staleTitle = canPublishWork({
    score: 90,
    threshold: 70,
    scoredHash: hash,
    ...rubric,
    title: "评分后换掉的标题",
    summary,
    content
  });
  assert.equal(staleTitle.ok, false);
  assert.match(!staleTitle.ok ? staleTitle.reason : "", /标题、摘要或正文/);

  const staleSummary = canPublishWork({
    score: 90,
    threshold: 70,
    scoredHash: hash,
    title,
    summary: "评分后塞入的误导摘要",
    content,
    ...rubric
  });
  assert.equal(staleSummary.ok, false);
  assert.match(!staleSummary.ok ? staleSummary.reason : "", /摘要/);

  const low = canPublishWork({ score: 69.9, threshold: 70, scoredHash: hash, title, summary, content, ...rubric });
  assert.equal(low.ok, false);
  assert.match(!low.ok ? low.reason : "", /门槛/);

  assert.equal(canPublishWork({ score: 70, threshold: 70, scoredHash: hash, title, summary, content, ...rubric }).ok, true);
});

test("rubric fingerprint binds genre name, normalized dimensions, threshold, and depth", () => {
  const dimensions = JSON.stringify([
    { key: "rigor", label: "严谨性", weight: 0.6, hint: "  核验事实  " },
    { key: "clarity", label: "清晰度", weight: 0.4, hint: "结构" }
  ]);
  const baseInput = {
    depth: "SHORT" as const,
    genre: { name: " 教程 ", dimensions, threshold: 70 }
  };
  const base = workRubricFingerprint(baseInput);
  assert.equal(workRubricFingerprint({
    ...baseInput,
    genre: { ...baseInput.genre, name: "教程", dimensions: JSON.stringify(JSON.parse(dimensions)) }
  }), base);
  assert.notEqual(workRubricFingerprint({ ...baseInput, depth: "FULL" }), base);
  assert.notEqual(workRubricFingerprint({ ...baseInput, genre: { ...baseInput.genre, name: "指南" } }), base);
  assert.notEqual(workRubricFingerprint({ ...baseInput, genre: { ...baseInput.genre, threshold: 75 } }), base);
  assert.notEqual(workRubricFingerprint({
    ...baseInput,
    genre: { ...baseInput.genre, dimensions: dimensions.replace("0.6", "0.5") }
  }), base);

  const staleRubric = canPublishWork({
    title: "标题",
    summary: "摘要",
    content: "正文",
    score: 90,
    threshold: 70,
    scoredHash: workScoreFingerprint({ title: "标题", summary: "摘要", content: "正文" }),
    scoredRubricHash: base,
    currentRubricHash: workRubricFingerprint({ ...baseInput, genre: { ...baseInput.genre, threshold: 75 } })
  });
  assert.equal(staleRubric.ok, false);
  if (!staleRubric.ok) assert.match(staleRubric.reason, /评分标尺|重新评分/);
});

test("score-relevant edits invalidate every persisted score field", () => {
  const current = { title: "原题", summary: "原摘要", content: "原文" };
  assert.equal(scoreSurfaceChanged(current, { title: "新题" }), true);
  assert.equal(scoreSurfaceChanged(current, { summary: "新摘要" }), true);
  assert.equal(scoreSurfaceChanged(current, { content: "新正文" }), true);
  assert.equal(scoreSurfaceChanged(current, { title: "  原题  ", summary: " 原摘要 " }), false);
  assert.equal(scoreSurfaceChanged(current, { content: "    原文" }), true);
  assert.equal(scoreSurfaceChanged(current, { content: "\n原文\n" }), true);
  assert.equal(
    scoreSurfaceChanged(
      { ...current, content: "第一行\n第二行" },
      { content: "第一行\r\n第二行" }
    ),
    false
  );
  assert.deepEqual(scoreInvalidationData(), {
    score: null,
    scoreDetail: null,
    scoredAt: null,
    scoredHash: null,
    scoredRubricHash: null
  });
});

test("verification clarification returns a draft to interview without overwriting it", () => {
  const update = verificationClarificationData("DRAFT", "请说明事实来源");
  assert.deepEqual(update, {
    status: "INTERVIEWING",
    pendingQuestion: "请说明事实来源",
    score: null,
    scoreDetail: null,
    scoredAt: null,
    scoredHash: null,
    scoredRubricHash: null
  });
  assert.equal("title" in update, false);
  assert.equal("summary" in update, false);
  assert.equal("content" in update, false);

  assert.deepEqual(
    verificationClarificationData("INTERVIEWING", "请补充"),
    { pendingQuestion: "请补充" }
  );
});

test("work revision CAS includes both status and updatedAt", () => {
  const updatedAt = new Date("2026-07-13T12:00:00.000Z");
  assert.deepEqual(
    workRevisionWhere({ id: "work-1", status: "DRAFT", updatedAt }),
    { id: "work-1", status: "DRAFT", updatedAt }
  );
});

test("both interview depths produce articles (2-3 quick, 8-10 deep)", () => {
  assert.equal(CREATION_DEPTHS.SHORT.minQuestions, 2);
  assert.equal(CREATION_DEPTHS.SHORT.maxQuestions, 3);
  assert.equal(CREATION_DEPTHS.SHORT.label, "快速成文");
  assert.match(CREATION_DEPTHS.SHORT.description, /一篇文章/);
  assert.equal(CREATION_DEPTHS.FULL.minQuestions, 8);
  assert.equal(CREATION_DEPTHS.FULL.maxQuestions, 10);
  assert.equal(CREATION_DEPTHS.FULL.label, "深度成文");
  assert.match(CREATION_DEPTHS.FULL.description, /完整文章/);
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
