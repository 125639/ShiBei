import { chromium } from "playwright";
import TurndownService from "turndown";

export async function scrapeWebPage(url: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    const result = await page.evaluate(() => {
      const selectors = ["article", "main", "[role='main']", ".article", ".post", "body"];
      const root = selectors
        .map((selector) => document.querySelector(selector))
        .find((node) => node && (node.textContent || "").trim().length > 500) || document.body;

      root.querySelectorAll("script, style, nav, footer, aside, noscript").forEach((node) => node.remove());

      const links = Array.from(root.querySelectorAll("a"))
        .map((anchor) => ({ text: anchor.textContent?.trim() || "", href: anchor.href }))
        .filter((link) => link.href && /video|youtube|youtu\.be|bilibili|vimeo|mp4/i.test(link.href));

      return {
        title: document.title || root.querySelector("h1")?.textContent?.trim() || location.href,
        html: root.innerHTML,
        text: root.textContent?.replace(/\s+/g, " ").trim() || "",
        videos: links.slice(0, 8)
      };
    });

    const turndown = new TurndownService({ headingStyle: "atx" });
    return {
      title: result.title.trim(),
      content: result.text,
      markdown: turndown.turndown(result.html),
      videos: result.videos
    };
  } finally {
    await browser.close();
  }
}
