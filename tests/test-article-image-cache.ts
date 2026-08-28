import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cacheArticleImage,
  rewriteRemoteArticleImageSources
} from "../src/lib/article-image-cache";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe("article image cache", () => {
  test("stores a remote image under the configured public prefix", async () => {
    await withTempDir(async (cacheDir) => {
      const cached = await cacheArticleImage("https://example.com/news/image.png", {
        cacheDir,
        publicPathPrefix: "/test-images",
        fetcher: async () => imageResponse(PNG_BYTES, "image/png")
      });

      assert.ok(cached);
      assert.match(cached.url, /^\/test-images\/[a-f0-9]{64}\.png$/);
      assert.equal(await fileExists(cached.filePath), true);
    });
  });

  test("reuses an existing cached file without fetching again", async () => {
    await withTempDir(async (cacheDir) => {
      let fetchCount = 0;
      const fetcher = async () => {
        fetchCount += 1;
        return imageResponse(PNG_BYTES, "image/png");
      };

      const first = await cacheArticleImage("https://example.com/a.png", { cacheDir, fetcher });
      const second = await cacheArticleImage("https://example.com/a.png", { cacheDir, fetcher });

      assert.ok(first);
      assert.ok(second);
      assert.equal(first.url, second.url);
      assert.equal(fetchCount, 1);
    });
  });

  test("rejects unsafe and non-image responses", async () => {
    await withTempDir(async (cacheDir) => {
      let fetchCount = 0;
      const unsafe = await cacheArticleImage("http://127.0.0.1/image.png", {
        cacheDir,
        fetcher: async () => {
          fetchCount += 1;
          return imageResponse(PNG_BYTES, "image/png");
        }
      });
      const html = await cacheArticleImage("https://example.com/not-image", {
        cacheDir,
        fetcher: async () => new Response("<html></html>", { headers: { "content-type": "text/html" } })
      });

      assert.equal(unsafe, null);
      assert.equal(html, null);
      assert.equal(fetchCount, 0);
    });
  });

  test("rejects oversized images from declared length", async () => {
    await withTempDir(async (cacheDir) => {
      const cached = await cacheArticleImage("https://example.com/large.png", {
        cacheDir,
        maxBytes: 4,
        fetcher: async () => imageResponse(PNG_BYTES, "image/png", 10)
      });

      assert.equal(cached, null);
    });
  });

  test("rewrites remote img src attributes to cached local URLs", async () => {
    await withTempDir(async (cacheDir) => {
      const result = await rewriteRemoteArticleImageSources(
        '<figure><img src="https://example.com/a.png" alt="a"></figure>',
        {
          cacheDir,
          publicPathPrefix: "/test-images",
          fetcher: async () => imageResponse(PNG_BYTES, "image/png")
        }
      );

      assert.equal(result.changed, 1);
      assert.match(result.html, /<img src="\/test-images\/[a-f0-9]{64}\.png" alt="a">/);
    });
  });
});

function imageResponse(bytes: Uint8Array, contentType: string, contentLength = bytes.byteLength) {
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": contentType,
      "content-length": String(contentLength)
    }
  });
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shibei-image-cache-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
