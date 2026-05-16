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
  const includeDomains = opts?.domesticOnly
    ? ["news.cn", "people.com.cn", "cctv.com", "thepaper.cn", "caixin.com", "163.com", "sohu.com"]
    : opts?.internationalOnly
    ? ["bbc.com", "reuters.com", "apnews.com", "theguardian.com", "npr.org", "theverge.com", "wired.com"]
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
