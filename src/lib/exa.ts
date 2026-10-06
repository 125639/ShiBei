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

/** 读取站点设置里的 Exa key；未启用/未配置/无法解密一律视为「未配置」。 */
async function loadExaApiKey(): Promise<string | null> {
  const settings = await prisma.siteSettings.findUnique({
    where: { id: "site" },
    select: { exaEnabled: true, exaApiKeyEnc: true }
  });
  const enabled = (settings as { exaEnabled?: boolean } | null)?.exaEnabled;
  const enc = (settings as { exaApiKeyEnc?: string | null } | null)?.exaApiKeyEnc;
  if (!enabled || !enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

/** 调用方用它区分「管理员没开 Exa」和「开了但搜索失败/无结果」。 */
export async function isExaConfigured(): Promise<boolean> {
  return (await loadExaApiKey()) !== null;
}

/**
 * Lightweight Exa search client. Uses the public REST API at api.exa.ai.
 *
 * Requires the admin to enable Exa in site settings and store an API key.
 * Returns [] if the integration is disabled/unconfigured or the query has no
 * results; throws when Exa is configured but the request itself fails, so
 * callers can tell an outage apart from a genuine empty result.
 */
export async function searchWithExa(query: string, opts?: {
  numResults?: number;
  domesticOnly?: boolean;
  internationalOnly?: boolean;
  startPublishedDate?: string;
}): Promise<ExaResult[]> {
  const apiKey = await loadExaApiKey();
  if (!apiKey) return [];

  const numResults = clamp(opts?.numResults ?? 8, 1, 20);
  // International research must be able to discover central banks, government
  // statistics, universities and papers, not just a fixed list of news sites.
  const domainFilter = buildExaDomainFilter(opts);

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
        ...(opts?.startPublishedDate ? { startPublishedDate: opts.startPublishedDate } : {}),
        useAutoprompt: true,
        contents: { text: { maxCharacters: 6000 } },
        ...domainFilter
      })
    });
    if (!res.ok) {
      throw new Error(`Exa 搜索请求失败：HTTP ${res.status}`);
    }
    const data: ExaSearchResponse = await res.json();
    if (!Array.isArray(data?.results)) {
      throw new Error("Exa 返回了无法解析的响应结构");
    }
    return data.results.map((r): ExaResult => ({
      title: r.title || r.url,
      url: r.url,
      text: r.text || "",
      publishedDate: r.publishedDate ? safeDate(r.publishedDate) : null,
      sourceName: hostFromUrl(r.url) || "exa"
    }));
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

/** Region selection is a discovery filter, not a source-trust or egress policy. */
export function buildExaDomainFilter(opts?: { domesticOnly?: boolean; internationalOnly?: boolean }): {
  includeDomains?: string[];
  excludeDomains?: string[];
} {
  if (opts?.domesticOnly) return { includeDomains: [...DOMESTIC_DOMAINS] };
  if (opts?.internationalOnly) return { excludeDomains: [...DOMESTIC_DOMAINS] };
  return {};
}

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
