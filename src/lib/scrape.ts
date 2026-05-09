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

      // 三类视频源:
      //   <video src=> / <video><source>      — 页面内嵌 HTML5 视频
      //   <iframe src=>(平台白名单)            — YouTube/Bilibili/优酷/v.qq.com 等嵌入
      //   <a href>(平台域名或直链 mp4/m3u8)    — 兜底；现代媒体站很少用此形式
      // 老逻辑只扫 <a>,导致主流新闻站(它们几乎全部用 <video>/<iframe>)抓不到任何视频源。
      const ANCHOR_RE = /video|youtube|youtu\.be|bilibili|vimeo|youku|iqiyi|qq\.com\/x|dailymotion|\.mp4(?:$|\?)|\.m3u8(?:$|\?)/i;
      const IFRAME_RE = /youtube\.com\/embed|youtu\.be|player\.bilibili|bilibili\.com\/blackboard|player\.vimeo|player\.youku|v\.qq\.com\/iframe|dailymotion\.com\/embed|player\.iqiyi|jx\.iqiyi/i;

      const fromVideo = Array.from(root.querySelectorAll("video"))
        .map((v) => {
          // IDL .src 在空字符串时会被 resolve 成 base URL(页面 URL),所以
          // 必须先用 getAttribute 拿到属性原值,trim 后非空才用 .src 拿到
          // 已 resolve 的绝对 URL。否则 <video><source src=""></video> 会
          // 把页面自身 URL 误当成视频源。
          const directRaw = v.getAttribute("src");
          const direct = directRaw && directRaw.trim() ? v.src : "";
          const source = v.querySelector("source") as HTMLSourceElement | null;
          const sourceRaw = source?.getAttribute("src");
          const sourceUrl = source && sourceRaw && sourceRaw.trim() ? source.src : "";
          const candidate = direct || sourceUrl;
          const title = v.getAttribute("title") || v.getAttribute("aria-label");
          return { href: candidate, text: (title || "页面内嵌视频").trim() };
        })
        .filter((item) => Boolean(item.href));

      const fromIframe = Array.from(root.querySelectorAll("iframe"))
        .map((f) => {
          // 同 <video>:空 src 会被 IDL resolve 成 base URL,先 getAttribute 判空。
          const raw = f.getAttribute("src");
          const src = raw && raw.trim() ? f.src : "";
          const title = f.getAttribute("title") || f.getAttribute("aria-label");
          return { href: src, text: (title || "页面内嵌视频").trim() };
        })
        .filter((item) => Boolean(item.href) && IFRAME_RE.test(item.href));

      const fromAnchor = Array.from(root.querySelectorAll("a"))
        .map((a) => ({ text: (a.textContent || "").trim(), href: a.href }))
        .filter((link) => Boolean(link.href) && ANCHOR_RE.test(link.href));

      const seen = new Set<string>();
      const videos: Array<{ text: string; href: string }> = [];
      for (const item of [...fromVideo, ...fromIframe, ...fromAnchor]) {
        if (!item.href || seen.has(item.href)) continue;
        seen.add(item.href);
        videos.push(item);
        if (videos.length >= 12) break;
      }

      return {
        title: document.title || root.querySelector("h1")?.textContent?.trim() || location.href,
        html: root.innerHTML,
        text: root.textContent?.replace(/\s+/g, " ").trim() || "",
        videos
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
