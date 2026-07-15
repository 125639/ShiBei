import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { describe, test } from "node:test";
import { chromium } from "playwright";
import {
  closeSafeScrapingResources,
  createSafeScrapingContext,
  SAFE_CHROMIUM_LAUNCH_ARGS
} from "../src/lib/browser-egress";
import { hostMatchesAllowedSuffixes, startPinnedEgressProxy } from "../src/lib/pinned-egress-proxy";
import { safeFetch } from "../src/lib/url-safety";
import { hardenedYtDlpNetworkArgs, trustedVideoDownloadTarget } from "../src/lib/video-download-policy";

function proxyAuthorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function rawProxyRequest(serverUrl: string, request: string) {
  const proxy = new URL(serverUrl);
  return await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host: proxy.hostname, port: Number(proxy.port) });
    let response = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.once("end", () => resolve(response));
    socket.once("connect", () => socket.end(request));
  });
}

describe("outbound SSRF boundary", () => {
  test("proxy cleanup is not blocked by a stuck Chromium context close", { timeout: 2_000 }, async () => {
    let proxyCloseCalls = 0;
    const neverSettles = new Promise<void>(() => undefined);
    const startedAt = Date.now();

    await closeSafeScrapingResources(
      () => neverSettles,
      async () => {
        proxyCloseCalls += 1;
      },
      25
    );

    assert.equal(proxyCloseCalls, 1);
    assert.ok(Date.now() - startedAt < 1_000, "cleanup must return after its deadline");
  });

  test("video downloads only accept explicit trusted watch-page shapes", () => {
    assert.deepEqual(trustedVideoDownloadTarget("https://www.youtube.com/embed/AbCdEf12345")?.platform, "youtube");
    assert.equal(
      trustedVideoDownloadTarget("https://player.bilibili.com/player.html?bvid=BV1AbCdEf123")?.url,
      "https://www.bilibili.com/video/BV1AbCdEf123"
    );
    assert.deepEqual(trustedVideoDownloadTarget("https://vimeo.com/123456789")?.platform, "vimeo");
    assert.deepEqual(trustedVideoDownloadTarget("https://dai.ly/x8abcde")?.platform, "dailymotion");

    const rejected = [
      "http://www.youtube.com/watch?v=AbCdEf12345",
      "https://youtube.com.evil.example/watch?v=AbCdEf12345",
      "https://user:pass@youtube.com/watch?v=AbCdEf12345",
      "https://youtube.com:8443/watch?v=AbCdEf12345",
      "https://youtube.com/redirect?q=http://127.0.0.1/",
      "https://news.example/article/1",
      "https://cdn.example/movie.mp4",
      "https://127.0.0.1/video/AbCdEf12345"
    ];
    for (const url of rejected) assert.equal(trustedVideoDownloadTarget(url), null, url);
  });

  test("hostname allowlists use a label boundary, not a suffix substring", () => {
    assert.equal(hostMatchesAllowedSuffixes("www.youtube.com", ["youtube.com"]), true);
    assert.equal(hostMatchesAllowedSuffixes("youtube.com.evil.example", ["youtube.com"]), false);
    assert.equal(hostMatchesAllowedSuffixes("notyoutube.com", ["youtube.com"]), false);
  });

  test("yt-dlp hardening cannot point at a remote or implicit proxy", () => {
    const args = hardenedYtDlpNetworkArgs("http://shibei:secret@127.0.0.1:32123/");
    assert.ok(args.includes("--ignore-config"));
    assert.ok(args.includes("--no-plugin-dirs"));
    assert.ok(args.includes("--hls-prefer-native"));
    assert.equal(args[args.indexOf("--proxy") + 1], "http://shibei:secret@127.0.0.1:32123/");
    assert.throws(() => hardenedYtDlpNetworkArgs("http://proxy.example:8080/"), /本机固定出站代理/);
  });

  test("pinned proxy requires authentication and rejects private DNS answers", async () => {
    const proxy = await startPinnedEgressProxy({ allowedHostSuffixes: ["localhost"] });
    try {
      const withoutAuth = await rawProxyRequest(
        proxy.serverUrl,
        "CONNECT localhost:443 HTTP/1.1\r\nHost: localhost:443\r\n\r\n"
      );
      assert.match(withoutAuth, /^HTTP\/1\.1 407 /);

      const authorization = proxyAuthorization(proxy.username, proxy.password);
      const privateTarget = await rawProxyRequest(
        proxy.serverUrl,
        `CONNECT localhost:443 HTTP/1.1\r\nHost: localhost:443\r\nProxy-Authorization: ${authorization}\r\n\r\n`
      );
      assert.match(privateTarget, /^HTTP\/1\.1 403 /);
    } finally {
      await proxy.close();
    }
  });

  test("pinned proxy rejects allowlist-confusion hosts before connecting", async () => {
    const proxy = await startPinnedEgressProxy({ allowedHostSuffixes: ["youtube.com"] });
    try {
      const authorization = proxyAuthorization(proxy.username, proxy.password);
      const response = await rawProxyRequest(
        proxy.serverUrl,
        `CONNECT youtube.com.evil.example:443 HTTP/1.1\r\nHost: youtube.com.evil.example:443\r\nProxy-Authorization: ${authorization}\r\n\r\n`
      );
      assert.match(response, /^HTTP\/1\.1 403 /);
    } finally {
      await proxy.close();
    }
  });

  test("safe Chromium context blocks private fetches, popups and WebSockets", { timeout: 20_000 }, async () => {
    let httpHits = 0;
    let upgradeHits = 0;
    const target = http.createServer((_req, res) => {
      httpHits += 1;
      res.end("internal");
    });
    target.on("upgrade", (_req, socket) => {
      upgradeHits += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const address = target.address();
    assert.ok(address && typeof address !== "string");

    const browser = await chromium.launch({ headless: true, args: [...SAFE_CHROMIUM_LAUNCH_ARGS] });
    const safeContext = await createSafeScrapingContext(browser);
    try {
      const page = await safeContext.context.newPage();
      await page.setContent("<main>boundary test</main>");
      const fetchResult = await page.evaluate(async (url) => {
        try {
          await fetch(url);
          return "connected";
        } catch {
          return "blocked";
        }
      }, `http://127.0.0.1:${address.port}/secret`);
      assert.equal(fetchResult, "blocked");

      await page.evaluate((url) => {
        window.open(url, "_blank");
      }, `http://127.0.0.1:${address.port}/popup`);
      await page.waitForTimeout(250);

      await page.evaluate((url) => {
        const ws = new WebSocket(url);
        ws.addEventListener("error", () => undefined);
      }, `ws://127.0.0.1:${address.port}/socket`);
      await page.waitForTimeout(250);

      assert.equal(httpHits, 0);
      assert.equal(upgradeHits, 0);
    } finally {
      await safeContext.close();
      await browser.close();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  test("safe Chromium context reaches public HTTPS through the pinned proxy", { timeout: 30_000 }, async (t) => {
    // CI/build hosts are sometimes intentionally offline. Probe with the
    // separately pinned Node fetch first; once public egress is known to work,
    // any Chromium proxy failure is a real regression and must fail the test.
    try {
      const probe = await safeFetch("https://example.com/", {
        method: "HEAD",
        signal: AbortSignal.timeout(8_000)
      });
      await probe.body?.cancel().catch(() => undefined);
    } catch {
      t.skip("当前测试环境没有公网 HTTPS 出站能力");
      return;
    }

    const browser = await chromium.launch({ headless: true, args: [...SAFE_CHROMIUM_LAUNCH_ARGS] });
    const safeContext = await createSafeScrapingContext(browser);
    try {
      const page = await safeContext.context.newPage();
      const response = await page.goto("https://example.com/", {
        waitUntil: "domcontentloaded",
        timeout: 15_000
      });
      assert.equal(response?.status(), 200);
      assert.equal(await page.title(), "Example Domain");
    } finally {
      await safeContext.close();
      await browser.close();
    }
  });
});
