import { decryptSecret } from "./crypto";
import { hostFromUrl as hostFromUrlOrNull } from "./html";
import { prisma } from "./prisma";

export type ExaResult = {
  title: string;
  url: string;
  text: string;
  publishedDate: Date | null;
  sourceName: string;
};

/**
 * Lightweight Exa search client. Uses the public REST API at api.exa.ai.
 *
 * Requires the admin to enable Exa in site settings and store an API key.
 * Returns [] if the integration is disabled or unconfigured.
 */
export async function searchWithExa(query: string, opts?: {
  numResults?: number;
  domesticOnly?: boolean;
  internationalOnly?: boolean;
}): Promise<ExaResult[]> {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const enabled = (settings as { exaEnabled?: boolean } | null)?.exaEnabled;
  const enc = (settings as { exaApiKeyEnc?: string | null } | null)?.exaApiKeyEnc;
  if (!enabled || !enc) return [];

  let apiKey: string;
  try {
    apiKey = decryptSecret(enc);
  } catch {
    return [];
  }

  const numResults = clamp(opts?.numResults ?? 8, 1, 20);
  // Region scoping for Exa. The previous 7-domain hard whitelist starved the
  // neural search — high-quality results from 36kr / ifanr / sina.cn / qq.com
  // were dropped just because they weren't on the list. We now use a broader
  // curated allowlist that covers the bulk of Chinese / international news +
  // tech outlets Exa actually surfaces for tech and AI queries. The keyword's
  // language already biases neural search toward the right region; the
  // allowlist is a safety net, not the primary mechanism.
  const includeDomains = opts?.domesticOnly
    ? DOMESTIC_DOMAINS
    : opts?.internationalOnly
    ? INTERNATIONAL_DOMAINS
    : undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        query,
        numResults,
        useAutoprompt: true,
        contents: { text: { maxCharacters: 2000 } },
        ...(includeDomains ? { includeDomains } : {})
      })
    });
    if (!res.ok) {
      console.error(`[exa] search failed: ${res.status}`);
      return [];
    }
    const data: ExaSearchResponse = await res.json();
    if (!Array.isArray(data?.results)) return [];
    return data.results.map((r): ExaResult => ({
      title: r.title || r.url,
      url: r.url,
      text: r.text || "",
      publishedDate: r.publishedDate ? safeDate(r.publishedDate) : null,
      sourceName: hostFromUrl(r.url) || "exa"
    }));
  } catch (error) {
    console.error("[exa] error:", error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

type ExaSearchResponse = {
  results?: Array<{
    title: string | null;
    url: string;
    text?: string;
    publishedDate?: string;
  }>;
};

// 中文新闻 / 科技媒体 / 云厂商技术博客。覆盖 Exa 在 AI / 科技选题里实际会返回
// 的主流来源。继续扩充时只追加站点根域名（不要写完整 URL）。
const DOMESTIC_DOMAINS = [
  // 央媒 / 综合
  "news.cn", "xinhuanet.com", "people.com.cn", "cctv.com", "chinanews.com",
  "chinadaily.com.cn", "thepaper.cn", "caixin.com", "caijing.com.cn",
  // 门户
  "sina.cn", "sina.com.cn", "163.com", "sohu.com", "qq.com", "ifeng.com",
  // 科技 / 创投媒体
  "36kr.com", "ifanr.com", "leiphone.com", "jiqizhixin.com", "infoq.cn",
  "cnbeta.com", "ithome.com", "geekpark.net", "huxiu.com", "tmtpost.com",
  // 开发者社区 / 云厂商
  "csdn.net", "juejin.cn", "cloud.tencent.com", "cloud.tencent.com.cn",
  "developer.aliyun.com", "cloud.baidu.com"
];

// 国外新闻 / 科技媒体 / 主要 AI 厂商博客。
const INTERNATIONAL_DOMAINS = [
  // 主流新闻
  "bbc.com", "reuters.com", "apnews.com", "theguardian.com", "npr.org",
  "nytimes.com", "washingtonpost.com", "ft.com", "economist.com",
  "bloomberg.com", "wsj.com", "axios.com",
  // 科技媒体
  "theverge.com", "wired.com", "techcrunch.com", "arstechnica.com",
  "engadget.com", "theinformation.com", "semianalysis.com",
  // AI / 研究博客 + 厂商
  "anthropic.com", "openai.com", "deepmind.google", "ai.googleblog.com",
  "microsoft.com", "meta.com", "huggingface.co", "lesswrong.com",
  "simonwillison.net", "oneusefulthing.org", "newsletter.pragmaticengineer.com"
];

function clamp(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(Math.floor(v), min), max);
}

function safeDate(input: string): Date | null {
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hostFromUrl(url: string): string {
  return hostFromUrlOrNull(url) || "";
}
