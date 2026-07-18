import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { videoShortcodeHtml, type VideoForShortcode } from "../src/lib/markdown";

const base: VideoForShortcode = {
  id: "v1",
  title: "测试视频",
  type: "EMBED",
  url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  displayMode: "embed",
  sourcePageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
};

describe("videoShortcodeHtml (article-body shortcode renderer)", () => {
  test("embed mode renders a sandboxed iframe", () => {
    const html = videoShortcodeHtml(base);
    assert.match(html, /<iframe[^>]*sandbox=/);
    assert.match(html, /youtube\.com\/embed\/dQw4w9WgXcQ/);
  });

  test("link display of an EMBED video links to the watch page, not the bare /embed/ player", () => {
    const html = videoShortcodeHtml({ ...base, displayMode: "link" });
    assert.match(html, /video-link-card/);
    assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
    assert.doesNotMatch(html, /<iframe/);
  });

  test("javascript:/data: URLs never become clickable hrefs", () => {
    const evil = videoShortcodeHtml({
      ...base,
      type: "LINK",
      displayMode: "link",
      url: "javascript:alert(1)",
      sourcePageUrl: "data:text/html,<script>alert(2)</script>"
    });
    assert.doesNotMatch(evil, /href="javascript:/);
    assert.doesNotMatch(evil, /href="data:/);
    // 降级为不可点击卡片，标题仍在
    assert.match(evil, /video-link-card/);
  });

  test("LOCAL video renders local player plus the HD source CTA when sourcePageUrl exists", () => {
    const html = videoShortcodeHtml({
      ...base,
      type: "LOCAL",
      url: "/uploads/video/dl-abc.mp4"
    });
    assert.match(html, /<video[^>]*src="\/uploads\/video\/dl-abc\.mp4"/);
    assert.match(html, /video-hd-cta/);
    assert.match(html, /到源站看高清完整报道/);
  });

  test("LOCAL video without sourcePageUrl has no CTA", () => {
    const html = videoShortcodeHtml({
      ...base,
      type: "LOCAL",
      url: "/uploads/video/dl-abc.mp4",
      sourcePageUrl: null
    });
    assert.doesNotMatch(html, /video-hd-cta/);
  });
});
