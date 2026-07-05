import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  detectVideoType,
  distributeVideoShortcodes,
  insertVideoShortcode,
  normalizeEmbedUrl,
  removePlaceholderVideoSections,
  removeVideoShortcode,
  type VideoForDistribution
} from "../src/lib/video-display";

const ARTICLE = [
  "# 云计算下沉：本地集群成为新战场",
  "",
  "这是一篇讨论云厂商把算力搬进客户机房的文章导语。",
  "",
  "## 腾讯云 CDC 的机柜化交付",
  "",
  "腾讯云 CDC 通过一体化机柜把公有云能力部署到用户机房，支持控制台和 API 管理。",
  "CDC 最小环境只需八台服务器，适合金融和能源行业。",
  "",
  "## 百度智能云 LCC 的组合式资源",
  "",
  "百度智能云 LCC 由多个本地计算机柜组成，强调低时延和数据合规。",
  "云游戏场景对时延要求苛刻，LCC 部署在本地可以显著降低时延。",
  "",
  "## 行业影响与成本结构",
  "",
  "本地部署改变了企业的成本结构，按月付费降低了一次性投入。",
  "",
  "## 参考来源",
  "",
  "- [腾讯云 CDC 产品页](https://cloud.tencent.com.cn/product/cdc)",
  "- [百度智能云 LCC](https://cloud.baidu.com/product/lcc.html)"
].join("\n");

describe("video shortcode distribution", () => {
  test("places each video at the end of its most relevant section", () => {
    const videos: VideoForDistribution[] = [
      { id: "vid-lcc", title: "百度智能云 LCC 低时延实测：云游戏体验", summary: "" },
      { id: "vid-cdc", title: "腾讯云 CDC 机柜部署演示", summary: "从来源页面自动识别到的相关视频链接。" }
    ];

    const result = distributeVideoShortcodes(ARTICLE, videos);
    const lines = result.split("\n");

    const cdcHeading = lines.indexOf("## 腾讯云 CDC 的机柜化交付");
    const lccHeading = lines.indexOf("## 百度智能云 LCC 的组合式资源");
    const impactHeading = lines.indexOf("## 行业影响与成本结构");
    const cdcShortcode = lines.indexOf("[[video:vid-cdc]]");
    const lccShortcode = lines.indexOf("[[video:vid-lcc]]");

    // CDC 视频落在 CDC 章节内（标题之后、下一章节之前）
    assert.ok(cdcShortcode > cdcHeading && cdcShortcode < lccHeading, `CDC 短代码位置错误: ${result}`);
    // LCC 视频落在 LCC 章节内
    assert.ok(lccShortcode > lccHeading && lccShortcode < impactHeading, `LCC 短代码位置错误: ${result}`);
  });

  test("falls back to before-references for videos unrelated to any section", () => {
    const videos: VideoForDistribution[] = [
      { id: "vid-cat", title: "Funny cats compilation", summary: "" }
    ];

    const result = distributeVideoShortcodes(ARTICLE, videos);
    const shortcodeIndex = result.indexOf("[[video:vid-cat]]");
    const referencesIndex = result.indexOf("## 参考来源");

    assert.ok(shortcodeIndex >= 0, "短代码未插入");
    assert.ok(shortcodeIndex < referencesIndex, "不相关视频应插在参考来源之前");
    // 且不应该插进任何正文章节内部（应在最后一个正文章节之后）
    const impactIndex = result.indexOf("按月付费降低了一次性投入");
    assert.ok(shortcodeIndex > impactIndex, "不相关视频应在正文之后");
  });

  test("caps videos per section and is idempotent on re-run", () => {
    const videos: VideoForDistribution[] = [
      { id: "vid-a", title: "腾讯云 CDC 机柜交付讲解", summary: "" },
      { id: "vid-b", title: "腾讯云 CDC 服务器规模分析", summary: "" }
    ];

    const once = distributeVideoShortcodes(ARTICLE, videos);
    const twice = distributeVideoShortcodes(once, videos);
    assert.equal(once, twice, "重复分布应幂等");

    // 每节最多 1 个：两个视频不会都挤进 CDC 章节
    const cdcSection = once.split("## 百度智能云")[0];
    const shortcodesInCdc = (cdcSection.match(/\[\[video:/g) || []).length;
    assert.ok(shortcodesInCdc <= 1, `CDC 章节里短代码过多:\n${once}`);
    assert.equal((once.match(/\[\[video:/g) || []).length, 2, "两个视频都应被插入");
  });

  test("never inserts into reference or heading-less content incorrectly", () => {
    const noHeadings = "只有一段话的正文，没有任何章节标题。";
    const result = distributeVideoShortcodes(noHeadings, [{ id: "v1", title: "任意视频", summary: "" }]);
    assert.ok(result.includes("[[video:v1]]"), "无章节时也要插入（追加到末尾）");
    assert.ok(result.startsWith("只有一段话的正文"), "原文应保留");
  });

  test("ignores headings inside code fences", () => {
    const withFence = [
      "# 标题",
      "",
      "导语。",
      "",
      "```bash",
      "## 这不是标题",
      "```",
      "",
      "## 真实章节：腾讯云 CDC",
      "",
      "腾讯云 CDC 的机柜细节。",
      "",
      "## 参考来源",
      "",
      "- [x](https://example.com)"
    ].join("\n");
    const result = distributeVideoShortcodes(withFence, [
      { id: "v1", title: "腾讯云 CDC 机柜视频", summary: "" }
    ]);
    const fenceBlock = result.split("```")[1];
    assert.ok(!fenceBlock.includes("[[video:"), "短代码不能插进代码块");
    assert.ok(result.includes("[[video:v1]]"));
  });
});

describe("placeholder related-video section removal", () => {
  test("removes an AI placeholder section that claims no videos exist", () => {
    const content = [
      "## 正文章节",
      "",
      "正文内容。",
      "",
      "## 相关视频",
      "",
      "来源资料未提供可核验的相关视频链接，本文不补充未确认视频内容。",
      "",
      "## 参考来源",
      "",
      "- [a](https://example.com)"
    ].join("\n");
    const result = removePlaceholderVideoSections(content);
    assert.ok(!result.includes("相关视频"), `占位小节应被移除:\n${result}`);
    assert.ok(!result.includes("未提供可核验"), "占位说明文字应被移除");
    assert.ok(result.includes("## 正文章节"));
    assert.ok(result.includes("## 参考来源"));
  });

  test("keeps a related-video section that has real content", () => {
    const content = [
      "## 相关视频",
      "",
      "[官方发布会完整回放](https://example.com/video)，时长约 40 分钟，包含 Q&A 环节。",
      "",
      "## 参考来源"
    ].join("\n");
    const result = removePlaceholderVideoSections(content);
    assert.ok(result.includes("## 相关视频"), "有真实链接的小节不能删");
    assert.ok(result.includes("官方发布会完整回放"));
  });

  test("keeps sections that already contain video shortcodes", () => {
    const content = "## 相关视频\n\n[[video:abc]]\n\n## 参考来源";
    const result = removePlaceholderVideoSections(content);
    assert.ok(result.includes("[[video:abc]]"));
    assert.ok(result.includes("## 相关视频"));
  });
});

describe("shortcode insert/remove primitives", () => {
  test("insertVideoShortcode before references then removeVideoShortcode round-trips", () => {
    const base = "# 标题\n\n正文。\n\n## 参考来源\n\n- [a](https://example.com)";
    const inserted = insertVideoShortcode(base, "vid1", "before-references");
    assert.ok(inserted.indexOf("[[video:vid1]]") < inserted.indexOf("## 参考来源"));
    const removed = removeVideoShortcode(inserted, "vid1");
    assert.ok(!removed.includes("[[video:vid1]]"));
  });

  test("detectVideoType and normalizeEmbedUrl handle common platforms", () => {
    assert.equal(detectVideoType("https://cdn.example.com/clip.mp4?sig=1"), "LOCAL");
    assert.equal(detectVideoType("https://www.youtube.com/watch?v=abc123"), "EMBED");
    assert.equal(detectVideoType("https://example.com/page"), "LINK");
    assert.equal(
      normalizeEmbedUrl("https://www.youtube.com/watch?v=abc_12-3"),
      "https://www.youtube.com/embed/abc_12-3"
    );
    assert.equal(
      normalizeEmbedUrl("https://www.bilibili.com/video/BV1xx411c7mD"),
      "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD"
    );
    assert.equal(normalizeEmbedUrl("https://example.com/other"), "https://example.com/other");
  });
});
