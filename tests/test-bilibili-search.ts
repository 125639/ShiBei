import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseBilibiliMetadata, parseBilibiliSearchCandidates } from "../src/lib/bilibili-search";
import { looksLikeNetscapeCookies } from "../src/lib/ytdlp-cookies";
import { normalizeEmbedUrl } from "../src/lib/video-display";

describe("parseBilibiliSearchCandidates", () => {
  // 真实 bilisearch flat 输出形态（2026-07 实测）：entries 只有 av URL，无标题/播放量。
  const flat = JSON.stringify({
    entries: [
      { ie_key: "BiliBili", id: "1802331595", url: "http://www.bilibili.com/video/av1802331595" },
      { ie_key: "BiliBili", id: "1802331595", url: "http://www.bilibili.com/video/av1802331595" },
      { ie_key: "BiliBili", id: "999", url: "https://space.bilibili.com/12345" },
      { ie_key: "BiliBili", id: "116760011349571", url: "http://www.bilibili.com/video/av116760011349571" }
    ]
  });

  test("normalizes to canonical watch URLs, dedupes, rejects non-video pages", () => {
    const out = parseBilibiliSearchCandidates(flat, 10);
    assert.deepEqual(out, [
      "https://www.bilibili.com/video/av1802331595",
      "https://www.bilibili.com/video/av116760011349571"
    ]);
  });

  test("honours max and survives malformed input", () => {
    assert.equal(parseBilibiliSearchCandidates(flat, 1).length, 1);
    assert.deepEqual(parseBilibiliSearchCandidates("not json", 5), []);
    assert.deepEqual(parseBilibiliSearchCandidates(JSON.stringify({}), 5), []);
  });
});

describe("parseBilibiliMetadata", () => {
  const meta = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: "BV1ot421g7Ks",
      title: "小米SU7 视频",
      view_count: 135821,
      duration: 139.775,
      uploader: "UP主",
      ...over
    });

  test("builds a canonical BV watch URL with views and rounded duration", () => {
    const out = parseBilibiliMetadata(meta());
    assert.equal(out?.watchUrl, "https://www.bilibili.com/video/BV1ot421g7Ks");
    assert.equal(out?.viewCount, 135821);
    assert.equal(out?.durationSec, 140);
    assert.equal(out?.channel, "UP主");
  });

  test("rejects non-BV ids and sub-minute shorts, keeps unknown durations", () => {
    assert.equal(parseBilibiliMetadata(meta({ id: "av123" })), null);
    assert.equal(parseBilibiliMetadata(meta({ duration: 45 })), null);
    assert.equal(parseBilibiliMetadata(meta({ duration: null }))?.durationSec, null);
    assert.equal(parseBilibiliMetadata("broken"), null);
  });
});

describe("normalizeEmbedUrl bilibili forms", () => {
  test("BV goes to bvid=, av goes to aid= (av inside bvid never loads)", () => {
    assert.equal(
      normalizeEmbedUrl("https://www.bilibili.com/video/BV1ot421g7Ks"),
      "https://player.bilibili.com/player.html?bvid=BV1ot421g7Ks"
    );
    assert.equal(
      normalizeEmbedUrl("https://www.bilibili.com/video/av1802331595"),
      "https://player.bilibili.com/player.html?aid=1802331595"
    );
  });
});

describe("looksLikeNetscapeCookies", () => {
  test("accepts the standard header or 7-field tab lines", () => {
    assert.equal(looksLikeNetscapeCookies("# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc"), true);
    assert.equal(
      looksLikeNetscapeCookies(".youtube.com\tTRUE\t/\tTRUE\t1900000000\tSID\tabc"),
      true
    );
  });

  test("rejects JSON, HTML, empty, and oversized payloads", () => {
    assert.equal(looksLikeNetscapeCookies("{\"cookies\":[]}"), false);
    assert.equal(looksLikeNetscapeCookies("<html><body>login</body></html>"), false);
    assert.equal(looksLikeNetscapeCookies(""), false);
    assert.equal(looksLikeNetscapeCookies("#\n" + "x".repeat(300 * 1024)), false);
  });
});
