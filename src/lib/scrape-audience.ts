import { chromium } from "playwright";
import type { SourceType } from "@prisma/client";
import { assertSafeFetchUrl } from "./url-safety";

export async function scrapeAudienceData(url: string, type: SourceType) {
  // 同 scrape.ts：拒绝 SSRF 候选目标。
  assertSafeFetchUrl(url);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    const result = await page.evaluate((sourceType) => {
      function parseAudienceNumber(text: string): number {
        if (!text) return 0;
        const normalized = text.replace(/[,\s]/g, "").toLowerCase();
        const match = normalized.match(/([\d.]+)\s*(万|w|亿|k|m|b)?/i);
        if (!match) return 0;
        const num = parseFloat(match[1]);
        if (isNaN(num)) return 0;
        const unit = match[2];
        if (unit === "亿") return Math.round(num * 100_000_000);
        if (unit === "万" || unit === "w") return Math.round(num * 10_000);
        if (unit === "k") return Math.round(num * 1_000);
        if (unit === "m") return Math.round(num * 1_000_000);
        if (unit === "b") return Math.round(num * 1_000_000_000);
        return Math.round(num);
      }

      const body = document.body;
      if (!body) return { rawMetrics: "", pageText: "", foundExactNumber: undefined as number | undefined };

      body.querySelectorAll("script, style, nav, footer, aside, noscript, iframe, svg").forEach((el) => el.remove());

      const text = (body.textContent || "").replace(/\s+/g, " ").trim();
      const metrics: string[] = [];
      let exactNumber: number | undefined;

      const youtubeSub = document.querySelector("#subscriber-count");
      if (youtubeSub) {
        const subText = youtubeSub.textContent?.trim() || "";
        metrics.push(`YouTube subscribers: ${subText}`);
        const num = parseAudienceNumber(subText);
        if (num > 0) exactNumber = num;
      }

      const bilibiliFan = document.querySelector(".user-info-fans, .fans-count, [class*='fans']");
      if (bilibiliFan) {
        const fanText = bilibiliFan.textContent?.trim() || "";
        metrics.push(`Bilibili fans: ${fanText}`);
        const num = parseAudienceNumber(fanText);
        if (num > 0) exactNumber = num;
      }

      const metaDesc = document.querySelector("meta[name='description']")?.getAttribute("content") || "";
      const ogDesc = document.querySelector("meta[property='og:description']")?.getAttribute("content") || "";
      metrics.push(`Type: ${sourceType}`);
      metrics.push(`Description: ${metaDesc || ogDesc || ""}`);

      const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .map((h) => h.textContent?.trim())
        .filter(Boolean)
        .slice(0, 5);
      metrics.push(`Headings: ${headings.join(" | ")}`);

      const audiencePatterns = /(?:订阅|粉丝|subscribe|follower|subscriber|阅读|read|viewers|member|会员|用户|user)[^\d]{0,20}(\d[\d,.万kKmMbB亿]+)/gi;
      let match: RegExpExecArray | null;
      while ((match = audiencePatterns.exec(text)) !== null) {
        metrics.push(`Found: ${match[0]}`);
        if (exactNumber === undefined) {
          const num = parseAudienceNumber(match[1]);
          if (num > 0) exactNumber = num;
        }
      }

      const rawMetrics = metrics.filter(Boolean).join("\n").slice(0, 2000);
      const pageText = text.slice(0, 8000);

      return { rawMetrics, pageText, foundExactNumber: exactNumber };
    }, type);

    return result;
  } finally {
    await browser.close();
  }
}
