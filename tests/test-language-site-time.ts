import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPPORTED_LANGUAGES,
  isLanguageKey,
  languageFromPath,
  negotiateLanguage,
  stripLanguagePrefix,
  withLanguagePrefix
} from "../src/lib/language";
import {
  siteDayBucket,
  siteDayKey,
  siteDayParts,
  siteDayStart,
  siteHourOf
} from "../src/lib/site-time";

test("supported languages stay in sync with the type guard", () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES], ["zh", "en"]);
  for (const language of SUPPORTED_LANGUAGES) {
    assert.equal(isLanguageKey(language), true);
  }
});

test("language path segments are read and stripped without matching lookalike words", () => {
  assert.equal(languageFromPath("/zh"), "zh");
  assert.equal(languageFromPath("/en/posts/x"), "en");
  // 同前缀单词绝不能被当成语言段，否则 /enigma 会被误改写
  assert.equal(languageFromPath("/enigma"), null);
  assert.equal(languageFromPath("/zhuanti/x"), null);
  assert.equal(languageFromPath("/posts/en"), null);

  assert.equal(stripLanguagePrefix("/zh/posts/x"), "/posts/x");
  assert.equal(stripLanguagePrefix("/en"), "/");
  assert.equal(stripLanguagePrefix("/zh"), "/");
  assert.equal(stripLanguagePrefix("/posts/x"), "/posts/x");
  assert.equal(stripLanguagePrefix("/enigma"), "/enigma");
});

test("adding a language prefix is idempotent and never doubles the segment", () => {
  assert.equal(withLanguagePrefix("zh", "/posts/x"), "/zh/posts/x");
  assert.equal(withLanguagePrefix("en", "/"), "/en");
  assert.equal(withLanguagePrefix("en", "posts/x"), "/en/posts/x");
  // 已带前缀时替换而不是叠加
  assert.equal(withLanguagePrefix("en", "/zh/posts/x"), "/en/posts/x");
  assert.equal(withLanguagePrefix("zh", "/zh"), "/zh");
});

test("Accept-Language negotiation defaults to Chinese unless English is preferred", () => {
  assert.equal(negotiateLanguage(null), "zh");
  assert.equal(negotiateLanguage(""), "zh");
  assert.equal(negotiateLanguage("zh-CN,zh;q=0.9,en;q=0.8"), "zh");
  assert.equal(negotiateLanguage("en-US,en;q=0.9"), "en");
  assert.equal(negotiateLanguage("en;q=0.9,zh;q=0.8"), "en");
  assert.equal(negotiateLanguage("zh;q=0.8,en;q=0.9"), "en");
  // 无法识别的语种回落中文，而不是留空
  assert.equal(negotiateLanguage("de,fr;q=0.7"), "zh");
  // q=0 表示明确拒绝，不应被选中
  assert.equal(negotiateLanguage("en;q=0"), "zh");
});

test("site day key and bucket follow the configured offset, not the process timezone", () => {
  // UTC 2026-07-09 17:00 = 北京 2026-07-10 01:00
  const late = new Date("2026-07-09T17:00:00.000Z");
  const early = new Date("2026-07-09T15:59:59.000Z");
  assert.equal(siteDayKey(late), "2026-07-10");
  assert.equal(siteDayKey(early), "2026-07-09");

  // @db.Date 的桶值是该日期的 UTC 零点
  assert.equal(siteDayBucket(late).toISOString(), "2026-07-10T00:00:00.000Z");
});

test("day bucket and day start are deliberately different instants", () => {
  const at = new Date("2026-07-10T03:00:00.000Z"); // 北京 7/10 11:00
  // 桶值：日期标签的 UTC 零点
  assert.equal(siteDayBucket(at).toISOString(), "2026-07-10T00:00:00.000Z");
  // 起点：北京 7/10 00:00 在真实时间轴上的位置 = UTC 7/9 16:00
  assert.equal(siteDayStart(at).toISOString(), "2026-07-09T16:00:00.000Z");
  // 两者互换就是这次要修的那类 bug，断言它们确实不相等
  assert.notEqual(siteDayBucket(at).getTime(), siteDayStart(at).getTime());
});

test("day parts and hour are reported in site time", () => {
  // 北京 2026-07-10 01:00
  const at = new Date("2026-07-09T17:00:00.000Z");
  assert.deepEqual(siteDayParts(at), { year: 2026, month: 6, day: 10 });
  assert.equal(siteHourOf(at), 1);

  // 北京 2026-07-09 23:59
  const before = new Date("2026-07-09T15:59:00.000Z");
  assert.deepEqual(siteDayParts(before), { year: 2026, month: 6, day: 9 });
  assert.equal(siteHourOf(before), 23);
});
