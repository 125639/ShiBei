import { chromium } from "playwright";
import TurndownService from "turndown";
import { assertSafeFetchUrl } from "./url-safety";
import { VIDEO_MEDIA_URL_RE } from "./video-policy";

const MEDIA_CONTENT_TYPE_RE = /^(video\/|application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml|octet-stream))/i;

type SniffedMedia = { href: string; bytes: number; contentType: string };

function sniffedMediaScore(media: SniffedMedia) {
  if (/\.m3u8(?:[?#]|$)/i.test(media.href) || /mpegurl/i.test(media.contentType)) {
    if (/\/hls\/main\//i.test(media.href) || /\/main\.m3u8(?:[?#]|$)/i.test(media.href)) return 1000;
    if (/\/video_[^/]+\.m3u8(?:[?#]|$)/i.test(media.href)) return 980;
    if (/\/adp\.[^/]+\.m3u8(?:[?#]|$)|\/(?:master|index|playlist)[^/]*\.m3u8(?:[?#]|$)/i.test(media.href)) return 900;
    const bitrate = media.href.match(/\/hls\/(\d{2,5})\//i)?.[1] || media.href.match(/\/(\d{2,5})\.m3u8(?:[?#]|$)/i)?.[1];
    return 900 + Math.min(Number(bitrate || 0) / 100, 80);
  }
  if (/\.mp4(?:[?#]|$)/i.test(media.href)) return 900;
  if (/\.(webm|mov|flv)(?:[?#]|$)/i.test(media.href)) return 850;
  return 100;
}

export async function scrapeWebPage(url: string) {
  // 拒绝 file://、loopback、私网、云 metadata 等，避免 SSRF 通过 Playwright 触达内部服务。
  assertSafeFetchUrl(url);
  const browser = await chromium.launch({ headless: true });
  const sniffed = new Map<string, SniffedMedia>();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

    // 被动嗅探网络响应：现代新闻站把视频 URL 放在 JS-注入的播放器配置里,DOM 扫不到。
    // 这里在页面加载过程中收集所有 content-type 是 video/* 或 URL 命中 .mp4/.m3u8 的请求,
    // 真正下载视频的环节(video-downloader)再决定要不要拉。Content-Length < 100KB 的过滤掉,
    // 防止把封面/海报/poster.mp4 之类的 placeholder 误认为正片。
    page.on("response", (resp) => {
      try {
        const respUrl = resp.url();
        if (sniffed.has(respUrl)) return;
        if (!/^https?:/i.test(respUrl)) return;
        const ct = (resp.headers()["content-type"] || "").toLowerCase();
        const matchesUrl = VIDEO_MEDIA_URL_RE.test(respUrl);
        const matchesCt = MEDIA_CONTENT_TYPE_RE.test(ct);
        if (!matchesUrl && !matchesCt) return;
        const lenStr = resp.headers()["content-length"];
        const bytes = lenStr ? Number(lenStr) : 0;
        // m3u8 / 分段 m4s 自身体积小,但是是合法的视频清单 → 不要按大小过滤。
        // 单文件 mp4/flv/webm:小于 100KB 几乎肯定不是正片。
        const isManifest = /\.(m3u8|m4s|mpd)(?:[?#]|$)/i.test(respUrl) || /mpegurl|dash/i.test(ct);
        if (!isManifest && bytes > 0 && bytes < 100_000) return;
        sniffed.set(respUrl, { href: respUrl, bytes, contentType: ct });
      } catch {
        /* response listener must not throw */
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
    // 视频站常有长轮询/流媒体连接，networkidle 等不到不应拖垮整次抓取。
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(3_000);

    // 抓 page.url() 而不是入参 url：Google News / 短链 等场景下浏览器会被跳转到
    // 真实文章页，下游用这个去做"国内 CDN 直链按来源页推断为国内"的判定，否则
    // sourcePageUrl 始终是聚合页/短链域，CDN URL 会被错误识别为非国内。
    const finalUrl = page.url();

    const result = await page.evaluate(() => {
      const selectors = [
        "article",
        "main",
        "[role='main']",
        ".article",
        ".article-content",
        ".post",
        ".post-content",
        ".entry-content",
        ".content",
        ".content-main",
        ".main",
        ".w800"
      ];
      const clutterSelector = [
        "script",
        "style",
        "nav",
        "footer",
        "aside",
        "noscript",
        "form",
        ".playerv",
        ".video-js",
        ".recommend",
        ".recommend_video",
        ".related",
        ".content_more",
        ".content_look",
        ".details",
        ".gc-comment",
        ".comment",
        ".comments",
        ".share",
        ".social",
        ".sidebar",
        ".ad",
        ".advert",
        ".breadcrumb",
        "[class*='comment']",
        "[id*='comment']",
        "[class*='recommend']",
        "[class*='related']",
        "[class*='share']"
      ].join(",");
      const root = pickContentRoot(selectors);
      const cleanRoot = root.cloneNode(true) as HTMLElement;
      cleanRoot.querySelectorAll(clutterSelector).forEach((node) => node.remove());

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
        title: bestTitle(root),
        html: cleanRoot.innerHTML,
        text: cleanRoot.textContent?.replace(/\s+/g, " ").trim() || "",
        videos,
        images: collectImages(cleanRoot)
      };

      function pickContentRoot(candidateSelectors: string[]): HTMLElement {
        const seen = new Set<Element>();
        const candidates: HTMLElement[] = [];
        for (const selector of candidateSelectors) {
          for (const el of Array.from(document.querySelectorAll(selector))) {
            if (seen.has(el) || el === document.body) continue;
            seen.add(el);
            candidates.push(el as HTMLElement);
          }
        }
        const viable = candidates
          .map((el) => ({ el, score: scoreContentRoot(el) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score);
        return viable[0]?.el || document.body;
      }

      function scoreContentRoot(el: HTMLElement): number {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        const textLen = text.length;
        const mediaCount = el.querySelectorAll("video, iframe, img").length;
        if (textLen < 80 && mediaCount === 0) return -1;
        const linkTextLen = Array.from(el.querySelectorAll("a"))
          .reduce((sum, a) => sum + ((a.textContent || "").trim().length), 0);
        const linkDensity = textLen > 0 ? linkTextLen / textLen : 1;
        const marker = `${el.id} ${String(el.className)} ${el.tagName}`.toLowerCase();
        const semantic =
          /article|content|post|entry|main|w800/.test(marker) ? 260 : 0;
        const clutter =
          /comment|recommend|related|nav|footer|sidebar|share|advert|login/.test(marker) ? 1000 : 0;
        return Math.min(textLen, 2600) + mediaCount * 140 + semantic - linkDensity * 900 - clutter;
      }

      function bestTitle(rootEl: HTMLElement): string {
        const metaTitle =
          document.querySelector<HTMLMetaElement>("meta[property='og:title']")?.content ||
          document.querySelector<HTMLMetaElement>("meta[name='twitter:title']")?.content ||
          "";
        return (
          rootEl.querySelector("h1")?.textContent?.trim() ||
          rootEl.querySelector("#content")?.textContent?.trim() ||
          metaTitle.trim() ||
          document.title ||
          location.href
        );
      }

      function collectImages(rootEl: HTMLElement): Array<{ src: string; alt: string; width: number | null; height: number | null }> {
        const out: Array<{ src: string; alt: string; width: number | null; height: number | null }> = [];
        const seen = new Set<string>();
        for (const img of Array.from(rootEl.querySelectorAll("img"))) {
          const src = imageSrc(img);
          if (!src || seen.has(src) || shouldSkipImage(img, src)) continue;
          seen.add(src);
          const width = img.naturalWidth || numberAttr(img, "width");
          const height = img.naturalHeight || numberAttr(img, "height");
          out.push({
            src,
            alt: (img.getAttribute("alt") || img.getAttribute("title") || "").replace(/\s+/g, " ").trim(),
            width: width || null,
            height: height || null
          });
          if (out.length >= 4) break;
        }
        return out;
      }

      function imageSrc(img: HTMLImageElement): string {
        const attrs = [
          "src",
          "data-src",
          "data-original",
          "data-url",
          "data-actualsrc",
          "data-lazy-src",
          "data-original-src"
        ];
        let raw = "";
        for (const attr of attrs) {
          const value = img.getAttribute(attr);
          if (value && value.trim()) {
            raw = value.trim();
            break;
          }
        }
        if (!raw) {
          raw = pickFromSrcset(img.getAttribute("srcset") || img.getAttribute("data-srcset") || "");
        }
        if (!raw || /^data:/i.test(raw)) return "";
        try {
          return new URL(raw, document.baseURI).toString();
        } catch {
          return "";
        }
      }

      function pickFromSrcset(srcset: string): string {
        const parts = srcset.split(",").map((part) => part.trim()).filter(Boolean);
        return parts.at(-1)?.split(/\s+/)[0] || "";
      }

      function shouldSkipImage(img: HTMLImageElement, src: string): boolean {
        const marker = `${src} ${img.alt || ""} ${img.title || ""} ${img.id || ""} ${String(img.className || "")}`.toLowerCase();
        if (/logo|icon|sprite|avatar|qrcode|qr-|wechat|weixin|share|blank|loading|vip|diamond|advert|ad-|banner/.test(marker)) {
          return true;
        }
        const width = img.naturalWidth || numberAttr(img, "width");
        const height = img.naturalHeight || numberAttr(img, "height");
        if (width && width < 160) return true;
        if (height && height < 100) return true;
        return false;
      }

      function numberAttr(el: Element, name: string): number {
        const raw = el.getAttribute(name);
        const value = raw ? Number.parseInt(raw, 10) : 0;
        return Number.isFinite(value) ? value : 0;
      }
    });

    // 把网络嗅探到的真实视频 URL 合并进 videos[],排在 DOM-扫到的源前面
    // (DOM 扫到的常常是 iframe 容器/播放器壳,真要下载还得拿到底层流;嗅探到的
    // 多半就是底层流本身)。按 Content-Length 降序——最大的那条最可能是正片。
    const sniffedSorted = Array.from(sniffed.values())
      .filter((m) => !/\.(ts|m4s)(?:[?#]|$)/i.test(m.href))
      .sort((a, b) => sniffedMediaScore(b) - sniffedMediaScore(a) || b.bytes - a.bytes)
      .map((m) => ({ text: "页面播放器加载的视频流", href: m.href }));

    const seen = new Set<string>();
    const merged: Array<{ text: string; href: string }> = [];
    for (const item of [...sniffedSorted, ...result.videos]) {
      if (!item.href || seen.has(item.href)) continue;
      seen.add(item.href);
      merged.push(item);
      if (merged.length >= 12) break;
    }

    const turndown = new TurndownService({ headingStyle: "atx" });
    return {
      title: result.title.trim(),
      content: result.text,
      markdown: turndown.turndown(result.html),
      videos: merged,
      images: result.images,
      finalUrl
    };
  } finally {
    await browser.close();
  }
}
