import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml, type VideoForShortcode } from "../src/lib/markdown";
import { EMBED_IFRAME_SANDBOX } from "../src/lib/video-display";

function video(id: string, url: string): VideoForShortcode {
  return { id, title: `video-${id}`, type: "EMBED", url };
}

describe("markdown remote embed boundary", () => {
  test("removes raw iframe/video/object/embed markup, including malformed and case variants", () => {
    const html = markdownToHtml([
      '<iframe src="https://evil.example/phish" allow="camera; microphone"></iframe>',
      '<IFRAME SRC="https://www.youtube.com/embed/raw"></IFRAME>',
      '<iframe/src="https://evil.example/malformed">',
      '<video src="https://evil.example/track.mp4"></video>',
      '<object data="https://evil.example/object"></object>',
      '<embed src="https://evil.example/embed">',
      '&lt;iframe src="https://evil.example/entity"&gt;&lt;/iframe&gt;'
    ].join("\n\n"));

    assert.doesNotMatch(html, /<(?:iframe|video|source|object|embed)\b/i);
    assert.doesNotMatch(html, /allow="camera|allow="microphone/i);
    // 实体编码的文本可以显示，但绝不能还原成可执行节点。
    assert.match(html, /&lt;iframe/);
  });

  test("renders only allowlisted server-generated shortcode players with forced sandbox", () => {
    const videos = new Map<string, VideoForShortcode>([
      ["yt", video("yt", "https://www.youtube.com/embed/abc123?rel=0")],
      ["bili", video("bili", "https://player.bilibili.com/player.html?bvid=BV123")]
    ]);
    const html = markdownToHtml("开头\n\n[[video:yt]]\n\n[[video:bili]]\n\n结尾", { videosById: videos });

    assert.equal((html.match(/<iframe\b/g) || []).length, 2);
    assert.match(html, /src="https:\/\/www\.youtube\.com\/embed\/abc123\?rel=0"/);
    assert.match(html, /src="https:\/\/player\.bilibili\.com\/player\.html\?bvid=BV123"/);
    assert.equal((html.match(new RegExp(`sandbox="${EMBED_IFRAME_SANDBOX}"`, "g")) || []).length, 2);
    assert.doesNotMatch(html, /(?:camera|microphone)/i);
    assert.doesNotMatch(html, /SHIBEI_TRUSTED_VIDEO_/);
  });

  test("video metadata containing replacement patterns cannot corrupt the player slot", () => {
    // `$&`/`$'` 序列在字符串替换里有特殊含义；标题转义后（$ 紧跟 &amp;）曾把
    // 占位符重新注入播放器 HTML 并泄漏内部标记。
    const videos = new Map<string, VideoForShortcode>([
      ["m", { ...video("m", "https://www.youtube.com/embed/xyz789"), title: "价格 A$&B 与 cost$'s 报告" }]
    ]);
    const html = markdownToHtml("前文\n\n[[video:m]]\n\n后文", { videosById: videos });

    assert.equal((html.match(/<iframe\b/g) || []).length, 1);
    assert.doesNotMatch(html, /SHIBEI_TRUSTED_VIDEO_/);
    assert.doesNotMatch(html, /data-shibei-video-slot/);
    assert.match(html, /价格 A\$&amp;B/);
  });

  test("downgrades non-allowlisted embeds and sanitizes dangerous URLs", () => {
    const videos = new Map<string, VideoForShortcode>([
      ["evil", video("evil", "https://youtube.com.evil.example/embed/abc")],
      ["script", { ...video("script", "javascript:alert(1)"), type: "LINK" }]
    ]);
    const html = markdownToHtml("[[video:evil]]\n\n[[video:script]]", { videosById: videos });

    assert.doesNotMatch(html, /<iframe\b/i);
    assert.doesNotMatch(html, /javascript:/i);
    assert.match(html, /打开视频资源|打开视频/);
  });

  test("never expands a shortcode inside attributes, raw HTML, indentation, or code fences", () => {
    const videos = new Map([["yt", video("yt", "https://www.youtube.com/embed/abc123")]]);
    const cases = [
      '[链接]([[video:yt]])',
      '<a href="\n[[video:yt]]\n">链接</a>',
      '<p>\n[[video:yt]]\n</p>',
      '<p>\n\n[[video:yt]]\n\n</p>',
      '<div>\n\n[[video:yt]]\n\n</div>',
      '<!--\n\n[[video:yt]]\n\n-->',
      '<![CDATA[\n\n[[video:yt]]\n\n]]>',
      '<script>\n\n[[video:yt]]\n\n</script>',
      '<style>\n\n[[video:yt]]\n\n</style>',
      '    [[video:yt]]',
      '```html\n[[video:yt]]\n```',
      '~~~\n[[video:yt]]\n~~~'
    ];

    for (const markdown of cases) {
      assert.doesNotMatch(markdownToHtml(markdown, { videosById: videos }), /<iframe\b/i, markdown);
    }
  });

  test("does not accept a user-authored lookalike slot", () => {
    const videos = new Map([["yt", video("yt", "https://www.youtube.com/embed/abc123")]]);
    const html = markdownToHtml(
      "SHIBEI_TRUSTED_VIDEO_fallback_0\n\n[[video:yt]]\n\n<p>SHIBEI_TRUSTED_VIDEO_fallback_0</p>",
      { videosById: videos }
    );

    assert.equal((html.match(/<iframe\b/g) || []).length, 1);
    assert.match(html, /SHIBEI_TRUSTED_VIDEO_fallback_0/);
  });

  test("does not let code tokens forge HTML context, and does not treat autolinks as tags", () => {
    const videos = new Map([["yt", video("yt", "https://www.youtube.com/embed/abc123")]]);
    const legitimate = [
      '```html\n<div>\n```\n\n[[video:yt]]',
      '`<div>`\n\n[[video:yt]]',
      '<https://example.com>\n\n[[video:yt]]'
    ];
    for (const markdown of legitimate) {
      assert.equal((markdownToHtml(markdown, { videosById: videos }).match(/<iframe\b/g) || []).length, 1);
    }

    const forgedClose = [
      '<p>\n\n```html\n</p>\n```\n\n[[video:yt]]\n\n</p>',
      '<div>\n\n`</div>`\n\n[[video:yt]]\n\n</div>'
    ];
    for (const markdown of forgedClose) {
      assert.doesNotMatch(markdownToHtml(markdown, { videosById: videos }), /<iframe\b/i);
    }
  });
});
