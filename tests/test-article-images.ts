import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildArticleImageFigureHtml,
  insertArticleImageFiguresIntoMarkdown,
  saveUploadedArticleImage,
  selectArticleImages,
  type ArticleImageCandidate
} from "../src/lib/article-images";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

describe("article image mounting", () => {
  test("selects useful article images and filters tiny or tracking assets", () => {
    const candidates: ArticleImageCandidate[] = [
      {
        src: "https://tracker.example.com/pixel.gif",
        alt: "pixel",
        width: 1,
        height: 1,
        parentMarker: "article content",
        sourcePageUrl: "https://example.com/story"
      },
      {
        src: "https://example.com/logo.png",
        alt: "logo",
        width: 180,
        height: 80,
        parentMarker: "header",
        sourcePageUrl: "https://example.com/story"
      },
      {
        src: "https://example.com/story/hero.jpg?utm=1",
        alt: "新能源政策发布现场",
        width: 1200,
        height: 675,
        parentMarker: "article main content",
        sourcePageUrl: "https://example.com/story"
      },
      {
        src: "https://example.com/story/hero.jpg?utm=2",
        alt: "新能源政策发布现场 高清",
        width: 1600,
        height: 900,
        parentMarker: "article main content",
        sourcePageUrl: "https://example.com/story"
      }
    ];

    const selected = selectArticleImages(candidates, 2, ["新能源", "政策"]);

    assert.equal(selected.length, 1);
    assert.equal(selected[0].width, 1600);
  });

  test("prefers the page's og:image over an off-topic inline diagram", () => {
    const candidates: ArticleImageCandidate[] = [
      {
        // 历史事故形态：来源页深处一张与本文无关的大尺寸内联插图。
        src: "https://example.com/deep/robotics-diagram.png",
        alt: "Deutsche Robotik Fabrik Diagramm Automatisierung",
        width: 1400,
        height: 900,
        parentMarker: "article main content",
        documentIndex: 6,
        sourcePageUrl: "https://example.com/privacy-rules"
      },
      {
        // 页面自己的社交卡片主题图：无 alt、无尺寸也应胜出。
        src: "https://example.com/cards/privacy-hero.jpg",
        alt: "",
        width: null,
        height: null,
        parentMarker: "og-image",
        documentIndex: 0,
        sourcePageUrl: "https://example.com/privacy-rules"
      }
    ];

    const selected = selectArticleImages(candidates, 1, ["隐私", "新规", "数据"]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].src, "https://example.com/cards/privacy-hero.jpg");
  });

  test("duplicate og and inline candidates merge into one og-marked entry with inline dimensions", () => {
    const candidates: ArticleImageCandidate[] = [
      {
        src: "https://example.com/hero.jpg",
        alt: "",
        width: null,
        height: null,
        parentMarker: "og-image",
        documentIndex: 0,
        sourcePageUrl: "https://example.com/story"
      },
      {
        src: "https://example.com/hero.jpg",
        alt: "现场照片",
        width: 1280,
        height: 720,
        parentMarker: "article main content",
        documentIndex: 1,
        sourcePageUrl: "https://example.com/story"
      }
    ];

    const selected = selectArticleImages(candidates, 2, []);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].parentMarker, "og-image");
    assert.equal(selected[0].width, 1280);
    assert.equal(selected[0].alt, "现场照片");
  });

  test("builds escaped figure html and inserts it after the intro paragraph", () => {
    const figure = buildArticleImageFigureHtml({
      src: "/uploads/image/manual-a.png",
      caption: "A < B",
      sourcePageUrl: "https://example.com/source?x=1"
    });
    const markdown = "# 标题\n\n第一段导语。\n\n## 参考来源\n- source";
    const next = insertArticleImageFiguresIntoMarkdown(markdown, [figure], "after-intro");

    assert.match(figure, /A &lt; B/);
    assert.match(figure, /href="https:\/\/example.com\/source\?x=1"/);
    assert.match(next, /第一段导语。\n\n<figure class="article-media article-image">/);
  });

  test("stores uploaded images by content hash and rejects non-image data", async () => {
    await withTempDir(async (imageDir) => {
      const first = await saveUploadedArticleImage(new File([PNG_BYTES], "first.png", { type: "image/png" }), {
        imageDir,
        publicPathPrefix: "/test-images"
      });
      const second = await saveUploadedArticleImage(new File([PNG_BYTES], "second.png", { type: "image/png" }), {
        imageDir,
        publicPathPrefix: "/test-images"
      });
      const bad = await saveUploadedArticleImage(new File(["not an image"], "bad.png", { type: "image/png" }), {
        imageDir,
        publicPathPrefix: "/test-images"
      });

      assert.ok(first);
      assert.ok(second);
      assert.equal(first.url, second.url);
      assert.equal(bad, null);
      assert.equal((await fs.readdir(imageDir)).length, 1);
    });
  });
});

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shibei-article-images-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
