import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isDomesticVideoCandidate } from "../src/lib/video-policy";
import { isHlsSegmentUrl, selectVideoLinksForPost } from "../src/lib/video-candidates";
import { isAllowedEmbedUrl } from "../src/lib/video-display";
import { DEFAULT_MODULES, seedDefaultModules } from "../src/lib/source-modules";

describe("video region tagging", () => {
  test("treats CDN media discovered from a domestic source page as domestic", () => {
    assert.equal(
      isDomesticVideoCandidate(
        "https://cdn.example.net/video/news.mp4?token=abc",
        "https://www.thepaper.cn/newsDetail_forward_123"
      ),
      true
    );
  });

  test("recognizes CNTV mobile pages as domestic video sources", () => {
    assert.equal(
      isDomesticVideoCandidate(
        "https://dh5.cntv.cdn20.com/asp/h5e/hls/main/example/main.m3u8",
        "https://m.news.cntv.cn/2020/06/27/example.shtml"
      ),
      true
    );
  });

  test("does not treat known international video delivery hosts as domestic", () => {
    assert.equal(
      isDomesticVideoCandidate(
        "https://rr1---sn.example.googlevideo.com/videoplayback?x=1",
        "https://www.thepaper.cn/newsDetail_forward_123"
      ),
      false
    );
  });
});

describe("video candidate selection", () => {
  test("skips HLS segments and keeps one preferred manifest per stream", () => {
    const selected = selectVideoLinksForPost([
      {
        text: "segment",
        href: "https://dh5.cntv.cdn20.com/asp/h5e/hls/1200/foo/default/bar/0.ts"
      },
      {
        text: "850k",
        href: "https://dh5.cntv.cdn20.com/asp/h5e/hls/850/foo/default/bar/850.m3u8"
      },
      {
        text: "main",
        href: "https://dh5.cntv.cdn20.com/asp/h5e/hls/main/foo/default/bar/main.m3u8"
      },
      {
        text: "450k",
        href: "https://dh5.cntv.cdn20.com/asp/h5e/hls/450/foo/default/bar/450.m3u8"
      }
    ]);

    assert.equal(selected.length, 1);
    assert.equal(selected[0].text, "main");
    assert.equal(isHlsSegmentUrl(selected[0].href), false);
  });

  test("keeps distinct direct video files", () => {
    const selected = selectVideoLinksForPost([
      { text: "one", href: "https://cdn.example.com/video/one.mp4?token=a" },
      { text: "two", href: "https://cdn.example.com/video/two.mp4?token=b" }
    ]);

    assert.deepEqual(
      selected.map((item) => item.text),
      ["one", "two"]
    );
  });

  test("rejects YouTube channel/user/playlist/subscribe pages but keeps watch forms", () => {
    // 实测混进过文章的垃圾形态：频道页 + ?sub_confirmation=1 订阅链接 + /c/ 别名页。
    const selected = selectVideoLinksForPost([
      { text: "sub", href: "https://www.youtube.com/channel/UCcOIZzJgLCyMPILY7-1Vsdg?sub_confirmation=1" },
      { text: "alias", href: "https://youtube.com/c/electrekco" },
      { text: "user", href: "https://www.youtube.com/user/HuaweiEnterprise" },
      { text: "handle", href: "https://www.youtube.com/@somecreator" },
      { text: "playlist", href: "https://www.youtube.com/playlist?list=PLxyz" },
      { text: "bare-watch", href: "https://www.youtube.com/watch" },
      { text: "watch", href: "https://www.youtube.com/watch?v=d6uZiYlb9NE" },
      { text: "embed", href: "https://www.youtube.com/embed/g7Wf9hW9d3Q?playlist=a,b" },
      { text: "short-link", href: "https://youtu.be/ddddddddddd" }
    ]);

    assert.deepEqual(
      selected.map((item) => item.text),
      ["watch", "embed", "short-link"]
    );
  });

  test("skips browser-only blob video URLs", () => {
    const selected = selectVideoLinksForPost([
      { text: "blob", href: "blob:https://m.news.cntv.cn/player-token" },
      { text: "real", href: "https://cdn.example.com/video/real.mp4" }
    ]);

    assert.deepEqual(
      selected.map((item) => item.text),
      ["real"]
    );
  });

  test("deduplicates Guancha HLS variants, prefers concrete playlists, and drops related page links", () => {
    const selected = selectVideoLinksForPost([
      {
        text: "master",
        href: "https://v.guancha.cn/path/to/video/adp.10.m3u8?t=1"
      },
      {
        text: "variant",
        href: "https://v.guancha.cn/path/to/video/video_10_4.m3u8?t=1"
      },
      {
        text: "related",
        href: "https://www.guancha.cn/video/gczvideo/content.html?id=55147"
      }
    ]);

    assert.deepEqual(
      selected.map((item) => item.text),
      ["variant"]
    );
  });

  test("drops URL-merely-contains-video junk links but keeps platforms and media", () => {
    const selected = selectVideoLinksForPost([
      // 抓取器 ANCHOR_RE 命中 "video" 字样的非视频链接：产品控制台、频道导航页
      { text: "混元生视频", href: "https://console.cloud.tencent.com/tokenhub/models/detail?modelId=hy-video-1.5" },
      { text: "技术视频", href: "https://cloud.tencent.com/developer/video" },
      { text: "真视频", href: "https://qcloudimg.tencent-cloud.cn/raw/abc.mp4" },
      { text: "抖音视频", href: "https://www.douyin.com/video/7123456789" },
      { text: "油管视频", href: "https://www.youtube.com/watch?v=abc123" },
      { text: "短链视频", href: "https://youtu.be/abc123" },
      { text: "B站视频索引", href: "https://www.bilibili.com/video/" }
    ]);

    assert.deepEqual(
      selected.map((item) => item.text),
      ["真视频", "抖音视频", "油管视频", "短链视频"]
    );
  });

  test("keeps content-type-verified sniffed streams even without media extension", () => {
    const selected = selectVideoLinksForPost([
      { text: "页面播放器加载的视频流", href: "https://media.example.com/getVideo?id=42", sniffed: true },
      { text: "同形态但未验证", href: "https://media.example.com/getVideo?id=43" }
    ]);

    assert.deepEqual(
      selected.map((item) => item.text),
      ["页面播放器加载的视频流"]
    );
  });
});

describe("video embed allowlist", () => {
  test("allows known player iframe URLs and rejects arbitrary embeds", () => {
    assert.equal(isAllowedEmbedUrl("https://www.youtube.com/embed/abc123"), true);
    assert.equal(isAllowedEmbedUrl("https://player.bilibili.com/player.html?bvid=BV123"), true);
    assert.equal(isAllowedEmbedUrl("https://example.com/embed/abc123"), false);
    assert.equal(isAllowedEmbedUrl("http://www.youtube.com/embed/abc123"), false);
  });
});

describe("default source seeding", () => {
  test("creates default module sources as default sources", async () => {
    const createdSources: Array<Record<string, unknown>> = [];
    const fakePrisma = makeSeedPrisma({
      sourceFindFirst: async () => null,
      sourceCreate: async ({ data }: { data: Record<string, unknown> }) => {
        createdSources.push(data);
        return { id: `source-${createdSources.length}` };
      }
    });

    await seedDefaultModules(fakePrisma);

    assert.ok(createdSources.length >= DEFAULT_MODULES.length, "seed should create the bundled sources");
    assert.equal(createdSources.every((source) => source.isDefault === true), true);
  });

  test("marks existing bundled sources as default on reseed", async () => {
    const updatedSources: Array<Record<string, unknown>> = [];
    const fakePrisma = makeSeedPrisma({
      sourceFindFirst: async (args: unknown) => {
        const { where } = args as { where: { url?: string } };
        if (!where.url) return null;
        return { id: `existing-${where.url}`, modules: [] };
      },
      sourceUpdate: async ({ data }: { data: Record<string, unknown> }) => {
        updatedSources.push(data);
        return { id: `updated-${updatedSources.length}` };
      }
    });

    await seedDefaultModules(fakePrisma);

    assert.ok(updatedSources.length >= DEFAULT_MODULES.length, "seed should revisit bundled sources");
    assert.equal(updatedSources.every((source) => source.isDefault === true), true);
  });
});

function makeSeedPrisma(overrides: {
  sourceFindFirst?: (args: unknown) => Promise<unknown>;
  sourceCreate?: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  sourceUpdate?: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
}) {
  return {
    sourceModule: {
      findFirst: async (args: { where: { OR: Array<{ slug?: string; name?: string }> } }) => {
        const slug = args.where.OR.find((item) => item.slug)?.slug || "module";
        return { id: slug, slug };
      },
      create: async ({ data }: { data: { slug: string } }) => ({ id: data.slug, slug: data.slug })
    },
    source: {
      findFirst: overrides.sourceFindFirst || (async () => null),
      create:
        overrides.sourceCreate ||
        (async ({ data }: { data: Record<string, unknown> }) => ({ id: String(data.url || "source") })),
      update:
        overrides.sourceUpdate ||
        (async ({ where }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id }))
    }
  } as never;
}
