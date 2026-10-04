import { test } from "node:test";
import assert from "node:assert/strict";
import { coverVariant, readingMinutes, readingProgress } from "../src/lib/reading-time";
import { buildPostsHref, parsePostFilters } from "../src/lib/public-post-filters";

test("reading estimates support Chinese, English and mixed content", () => {
  assert.equal(readingMinutes(""), 1);
  assert.equal(readingMinutes(null), 1);
  assert.equal(readingMinutes("读".repeat(701)), 3);
  assert.equal(readingMinutes("word ".repeat(440)), 2);
  assert.equal(readingMinutes(`${"读".repeat(350)} ${"word ".repeat(220)}`), 2);
});

test("reading estimates ignore code blocks, markup and image URLs", () => {
  const content = `\`\`\`js\n${"code ".repeat(1000)}\n\`\`\`\n![image](https://example.com/a.jpg)\n<a href="https://example.com">link</a>\n[read](https://example.com)`;
  assert.equal(readingMinutes(content), 1);
});

test("cover decoration is deterministic and bounded, including non-Latin slugs", () => {
  for (const slug of ["a", "新闻与设计", "", "🚀", "long".repeat(100)]) {
    assert.equal(coverVariant(slug), coverVariant(slug));
    assert.ok(coverVariant(slug) >= 0 && coverVariant(slug) < 4);
  }
});

test("reading progress is based on the article, not related posts or footer", () => {
  assert.equal(readingProgress(1000, 1800, 800), 0);
  assert.equal(readingProgress(100, 1800, 800), 0);
  assert.equal(readingProgress(-450, 1800, 800), 50);
  assert.equal(readingProgress(-1000, 1800, 800), 100);
  assert.equal(readingProgress(-4000, 1800, 800), 100);
});

test("short and invalid article dimensions do not generate NaN progress", () => {
  assert.equal(readingProgress(200, 200, 800), 100);
  assert.equal(readingProgress(900, 200, 800), 0);
  assert.equal(readingProgress(10, 0, 800), 0);
  assert.equal(readingProgress(NaN, 100, 800), 0);
  assert.equal(readingProgress(10, 100, 0), 0);
});

test("query filters normalize repeated, empty and oversized query params", () => {
  assert.deepEqual(parsePostFilters({ q: ["  design  ", "ignored"], topic: ["ai"], page: ["2", "3"] }), {
    query: "design",
    topic: "ai",
    page: 2
  });
  assert.deepEqual(parsePostFilters({ q: "  ", topic: [], page: "-1" }), { query: "", topic: null, page: 1 });
  assert.equal(parsePostFilters({ q: "a".repeat(200) }).query.length, 120);
  assert.equal(parsePostFilters({ topic: "a".repeat(300) }).topic?.length, 200);
});

test("filter links preserve search when changing topic or page and encode values", () => {
  assert.equal(buildPostsHref(null, ""), "/posts");
  assert.equal(buildPostsHref(null, "", 1), "/posts");
  const url = new URL(buildPostsHref("科技 & 设计", "AI / ideas?", 3), "https://example.com");
  assert.equal(url.searchParams.get("topic"), "科技 & 设计");
  assert.equal(url.searchParams.get("q"), "AI / ideas?");
  assert.equal(url.searchParams.get("page"), "3");
});
